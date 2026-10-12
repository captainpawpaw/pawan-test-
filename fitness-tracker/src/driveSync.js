// Optional backup and sync of the logbook to the user's own Google Drive.
//
// Uses Google Identity Services for sign-in and the Drive "appDataFolder": a
// hidden, per-app folder in the user's Drive. The drive.appdata scope lets
// this app see only the files it created there, nothing else in the Drive.
//
// This browser's storage stays the working copy. A sync downloads the Drive
// copy, merges it with the local one (see merge.js), saves the result locally
// and uploads it back. Needs VITE_GOOGLE_CLIENT_ID at build time; without it,
// or inside a claude.ai artifact (whose sandbox blocks Google), it stays off.

import { storage } from "./storage";
import { mergeBooks, mergeExercises, mergeMonth, mergeMyFoods, mergeProfile, mergeTags, mergeTombstones, sameMonth } from "./merge";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILE_NAME = "training-ledger.json";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const CONNECTED_FLAG = "fitness-tracker:drive-connected";
const DELETED_KEY = "deleted";
const TAGS_KEY = "tags";
const EXERCISES_KEY = "exercises";
const PROFILE_KEY = "profile";
const MYFOODS_KEY = "myfoods";
const DEBOUNCE_MS = 1500;

export const driveSupported = () => Boolean(CLIENT_ID) && typeof window !== "undefined" && !window.claude;

/* ---------- status ---------- */
// state: "off" | "connecting" | "syncing" | "synced" | "needs-auth" | "error"
let status = { state: "off", lastSynced: null, message: "" };
const listeners = new Set();
const monthListeners = new Set();

function setStatus(patch) {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn(status));
  if (status.state === "needs-auth") armAutoSync();
}

/* ---------- automatic sync ---------- */
// Google's sign-in window only opens from a tap, so when Drive is connected
// but this visit isn't signed in yet, the next tap anywhere signs in (no
// permission screen, just a window that closes itself) and syncs.
let armed = false;
function onFirstTap() {
  if (!window.google?.accounts?.oauth2) return; // sign-in script still loading; wait for the next tap
  disarmAutoSync();
  if (status.state === "needs-auth" && flag.get()) connect();
}
function armAutoSync() {
  if (armed || typeof window === "undefined" || !flag.get()) return;
  armed = true;
  window.addEventListener("click", onFirstTap, true);
}
function disarmAutoSync() {
  armed = false;
  window.removeEventListener("click", onFirstTap, true);
}

// While signed in, pull the latest when the app comes back into view, so
// entries made on another device appear without a tap.
let lastPull = 0;
function onVisible() {
  if (document.visibilityState !== "visible" || !flag.get()) return;
  if (!tokenValid()) { if (status.state !== "connecting") setStatus({ state: "needs-auth" }); return; }
  if (Date.now() - lastPull < 30_000) return;
  lastPull = Date.now();
  runSync();
}
export function subscribe(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}
// fn(keys[]) is called when a sync changed data in this browser: month keys
// like "2026-09", plus "tags", "exercises", "profile" or "myfoods" when those changed.
export function onMonthsChanged(fn) {
  monthListeners.add(fn);
  return () => monthListeners.delete(fn);
}

const flag = {
  get() { try { return window.localStorage.getItem(CONNECTED_FLAG) === "1"; } catch { return false; } },
  set(on) { try { on ? window.localStorage.setItem(CONNECTED_FLAG, "1") : window.localStorage.removeItem(CONNECTED_FLAG); } catch { /* ignore */ } },
};

/* ---------- deletions ---------- */
// Recorded whether or not Drive is connected, so a later first sync doesn't
// bring deleted entries back from another device.
export async function recordDeletion(id) {
  const res = await storage.get(DELETED_KEY).catch(() => null);
  const current = res ? JSON.parse(res.value) : {};
  await storage.set(DELETED_KEY, JSON.stringify(mergeTombstones(current, { [id]: Date.now() })));
}

/* ---------- Google sign-in ---------- */
let gisPromise = null;
let tokenClient = null;
let token = null; // { access, expiresAt }
let pending = null; // { resolve, reject } for the in-flight token request

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisPromise = null; reject(new Error("Couldn't load Google sign-in. Check your connection.")); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (resp) => {
      const p = pending; pending = null;
      if (!p) return;
      if (resp.error || !resp.access_token) {
        p.reject(new Error(resp.error_description || "Google sign-in was cancelled."));
      } else if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
        p.reject(new Error("Allow access to the app's Drive folder to turn on sync."));
      } else {
        token = { access: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
        p.resolve();
      }
    },
    error_callback: (err) => {
      const p = pending; pending = null;
      if (!p) return;
      p.reject(new Error(err?.type === "popup_failed_to_open"
        ? "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again."
        : "Google sign-in was cancelled."));
    },
  });
  return tokenClient;
}

const tokenValid = () => token && token.expiresAt - 60_000 > Date.now();

/* ---------- Drive API ---------- */
class NeedsAuth extends Error {}

async function api(url, opts = {}) {
  if (!tokenValid()) throw new NeedsAuth();
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token.access}` } });
  if (res.status === 401) { token = null; throw new NeedsAuth(); }
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}.`);
  return res;
}

async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await api(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id)&orderBy=modifiedTime desc`);
  const { files } = await res.json();
  return files && files.length ? files[0].id : null;
}

async function download(id) {
  const res = await api(`${API}/files/${id}?alt=media`);
  const text = await res.text();
  try {
    const book = JSON.parse(text);
    return { months: book.months || {}, deleted: book.deleted || {}, tags: book.tags || {}, exercises: book.exercises || {}, profile: book.profile || {}, myfoods: book.myfoods || {} };
  } catch {
    throw new Error("The Drive copy is damaged. Nothing was changed.");
  }
}

async function upload(id, book) {
  const body = JSON.stringify({ app: "training-ledger", version: 1, updatedAt: new Date().toISOString(), ...book });
  if (id) {
    await api(`${UPLOAD}/files/${id}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
    return id;
  }
  const boundary = "tl" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" });
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return (await res.json()).id;
}

/* ---------- local copy ---------- */
async function readJson(key) {
  const res = await storage.get(key);
  return res ? JSON.parse(res.value) : null;
}

async function readLocalBook() {
  const listed = await storage.list("month:");
  const months = {};
  for (const k of listed?.keys || []) {
    const m = await readJson(k);
    if (m) months[k.slice("month:".length)] = m;
  }
  return {
    months,
    deleted: (await readJson(DELETED_KEY)) || {},
    tags: (await readJson(TAGS_KEY)) || {},
    exercises: (await readJson(EXERCISES_KEY)) || {},
    profile: (await readJson(PROFILE_KEY)) || {},
    myfoods: (await readJson(MYFOODS_KEY)) || {},
  };
}

// Saves the merged book locally. Re-reads each month just before writing and
// merges again, so an entry logged while the sync was running isn't lost.
async function writeLocalBook(book, localKeys) {
  const changed = [];
  const keys = new Set([...Object.keys(book.months), ...localKeys]);
  for (const k of keys) {
    const now = (await readJson(`month:${k}`)) || {};
    const next = mergeMonth(now, book.months[k] || {}, book.deleted);
    if (!sameMonth(now, next)) {
      const ok = await storage.set(`month:${k}`, JSON.stringify(next));
      if (!ok) throw new Error("Couldn't save to this browser's storage.");
      changed.push(k);
    }
  }
  const deletedNow = (await readJson(DELETED_KEY)) || {};
  await storage.set(DELETED_KEY, JSON.stringify(mergeTombstones(deletedNow, book.deleted)));
  for (const [key, merge] of [[TAGS_KEY, mergeTags], [EXERCISES_KEY, mergeExercises], [PROFILE_KEY, mergeProfile], [MYFOODS_KEY, mergeMyFoods]]) {
    const now = (await readJson(key)) || {};
    const next = merge(now, book[key]);
    if (JSON.stringify(next) !== JSON.stringify(now)) {
      await storage.set(key, JSON.stringify(next));
      changed.push(key);
    }
  }
  return changed;
}

/* ---------- sync ---------- */
let fileId = null;
let running = null;
let again = false;
let timer = null;

async function syncOnce() {
  if (!fileId) fileId = await findFile();
  const remote = fileId ? await download(fileId) : { months: {}, deleted: {}, tags: {}, exercises: {}, profile: {}, myfoods: {} };
  const local = await readLocalBook();
  const merged = mergeBooks(local, remote);
  const changed = await writeLocalBook(merged, Object.keys(local.months));
  // Upload what's stored now, which includes anything logged mid-sync.
  const latest = mergeBooks(await readLocalBook(), merged);
  try {
    fileId = await upload(fileId, latest);
  } catch (err) {
    fileId = null; // the file may have been removed; look it up again next time
    throw err;
  }
  if (changed.length) monthListeners.forEach((fn) => fn(changed));
}

function runSync() {
  if (running) { again = true; return running; }
  setStatus({ state: "syncing", message: "" });
  running = (async () => {
    try {
      do { again = false; await syncOnce(); } while (again);
      setStatus({ state: "synced", lastSynced: new Date(), message: "" });
    } catch (err) {
      if (err instanceof NeedsAuth) setStatus({ state: "needs-auth", message: "" });
      else setStatus({ state: "error", message: err.message || "Sync failed." });
    } finally {
      running = null;
    }
  })();
  return running;
}

// Call after any local change. Syncs shortly after, if Drive is connected.
export function scheduleSync() {
  if (!driveSupported() || !flag.get()) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!tokenValid()) setStatus({ state: "needs-auth" });
    else runSync();
  }, DEBOUNCE_MS);
}

// Must be called straight from a click, so the Google window isn't blocked.
export function connect() {
  if (!driveSupported()) return Promise.resolve();
  if (tokenValid()) return runSync();
  if (!window.google?.accounts?.oauth2) {
    setStatus({ state: "error", message: "Google sign-in is still loading. Try again in a moment." });
    loadGis().catch(() => {});
    return Promise.resolve();
  }
  const wasConnected = flag.get();
  setStatus({ state: "connecting", message: "" });
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    ensureTokenClient().requestAccessToken({ prompt: wasConnected ? "" : "consent" });
  }).then(
    () => { flag.set(true); return runSync(); },
    (err) => setStatus({ state: wasConnected ? "needs-auth" : "off", message: err.message }),
  );
}

export function disconnect() {
  clearTimeout(timer);
  disarmAutoSync();
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.access, () => {});
  token = null;
  fileId = null;
  flag.set(false);
  setStatus({ state: "off", lastSynced: null, message: "" });
}

/* ---------- export / import ---------- */
// Everything this browser holds, as one JSON-ready object.
export async function exportBook() {
  const book = await readLocalBook();
  return { app: "training-ledger", version: 1, exportedAt: new Date().toISOString(), ...book };
}

// Merges a backup into this browser's data (nothing is overwritten: entries
// are combined and the newest tags, exercises and settings win), then syncs.
export async function importBook(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.months !== "object") {
    throw new Error("That file isn't a Training Ledger backup.");
  }
  const incoming = { months: raw.months || {}, deleted: raw.deleted || {}, tags: raw.tags || {}, exercises: raw.exercises || {}, profile: raw.profile || {}, myfoods: raw.myfoods || {} };
  const local = await readLocalBook();
  const merged = mergeBooks(local, incoming);
  const changed = await writeLocalBook(merged, Object.keys(local.months));
  if (changed.length) monthListeners.forEach((fn) => fn(changed));
  scheduleSync();
  return { months: Object.keys(incoming.months).length, changed: changed.length };
}

export function initDriveSync() {
  if (!driveSupported()) return;
  loadGis().catch(() => {});
  if (flag.get() && status.state === "off") setStatus({ state: "needs-auth" });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}
