import React, { useEffect, useState } from "react";
import { exportBook, importBook } from "./driveSync";
import { C } from "./theme";

const ink = C.ink;
const inkFaint = C.inkFaint;
const raised = C.raised;
const line = C.line;
const teal = C.teal;
const rust = C.rust;
const mono = "'IBM Plex Mono', monospace";

// Saving a file: inside a claude.ai artifact through the `downloads`
// capability (the sandbox blocks plain download links), elsewhere a link.
let downloadsPromise = null;
const getDownloads = () => {
  if (!downloadsPromise) {
    downloadsPromise = (async () => {
      try { return window.claude?.use ? await window.claude.use("downloads") : null; } catch { return null; }
    })();
  }
  return downloadsPromise;
};

async function saveFile(filename, text) {
  if (window.claude) {
    const dl = await getDownloads();
    if (!dl) throw { code: "unavailable" };
    await dl.save({ filename, data: text });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Backup() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [canSave, setCanSave] = useState(!window.claude);
  const [pending, setPending] = useState(null); // parsed file waiting for confirmation

  useEffect(() => {
    if (window.claude) getDownloads().then((d) => setCanSave(Boolean(d)));
  }, []);

  const doExport = async () => {
    setStatus({ kind: "busy", text: "Preparing your backup…" });
    try {
      const book = await exportBook();
      const date = new Date().toISOString().slice(0, 10);
      await saveFile(`training-ledger-${date}.json`, JSON.stringify(book, null, 1));
      const days = Object.values(book.months).reduce((n, m) => n + Object.keys(m || {}).length, 0);
      setStatus({ kind: "done", text: `Saved a backup of ${days} logged day${days === 1 ? "" : "s"}.` });
    } catch (e) {
      setStatus({ kind: "error", text: e?.code === "declined" ? "Backup not saved." : e?.code === "unavailable" ? "Saving files isn't available here." : "Couldn't make the backup. Try again." });
    }
  };

  const pickFile = async (file) => {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (!raw || typeof raw.months !== "object") throw new Error("not a backup");
      const days = Object.values(raw.months).reduce((n, m) => n + Object.keys(m || {}).length, 0);
      setPending({ raw, days, name: file.name });
      setStatus(null);
    } catch {
      setStatus({ kind: "error", text: "That file isn't a Training Ledger backup." });
    }
  };

  const doImport = async () => {
    try {
      setStatus({ kind: "busy", text: "Importing…" });
      const r = await importBook(pending.raw);
      setPending(null);
      setStatus({ kind: "done", text: r.changed ? "Imported. Your log now includes everything from the backup." : "Nothing new: everything in the backup was already here." });
    } catch (e) {
      setStatus({ kind: "error", text: e?.message || "Couldn't import that file." });
    }
  };

  return (
    <section style={st.box} aria-label="Back up or move your data">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={st.toggle}>
        {open ? "▾" : "▸"} Back up or move your data
      </button>
      {open && (
        <div style={st.body}>
          <p style={st.p}>
            Export saves everything (workouts, food, tags, imported exercises and settings) as one file. Import adds a backup's
            entries to what's here; nothing already logged is removed. Use it to move between this link and the website version.
          </p>
          <div style={st.row}>
            {canSave && <button type="button" onClick={doExport} disabled={status?.kind === "busy"} style={st.primary}>Export backup</button>}
            <label style={st.fileBtn}>
              Import a backup
              <input type="file" accept=".json,application/json" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} style={st.hidden} aria-label="Import a backup file" />
            </label>
          </div>
          {pending && (
            <div style={st.confirm}>
              <span>{pending.name}: {pending.days} logged day{pending.days === 1 ? "" : "s"}. Add them to this log?</span>
              <div style={st.row}>
                <button type="button" onClick={doImport} style={st.primary}>Import</button>
                <button type="button" onClick={() => setPending(null)} style={st.secondary}>Cancel</button>
              </div>
            </div>
          )}
          {status && <span role={status.kind === "error" ? "alert" : "status"} style={{ ...st.status, color: status.kind === "error" ? rust : status.kind === "done" ? teal : inkFaint }}>{status.text}</span>}
        </div>
      )}
    </section>
  );
}

const st = {
  box: { marginTop: 28, borderTop: `1px solid ${line}`, paddingTop: 12 },
  toggle: { fontFamily: mono, fontSize: 12, color: inkFaint, background: "none", border: "none", padding: 0 },
  body: { display: "flex", flexDirection: "column", gap: 10, marginTop: 10 },
  p: { margin: 0, fontSize: 13, lineHeight: 1.5, color: ink, maxWidth: "62ch" },
  row: { display: "flex", flexWrap: "wrap", gap: 8 },
  primary: { fontFamily: mono, fontSize: 12, color: C.onFill, background: ink, border: `1px solid ${ink}`, borderRadius: 3, padding: "7px 12px" },
  secondary: { fontFamily: mono, fontSize: 12, color: ink, background: "transparent", border: `1px solid ${line}`, borderRadius: 3, padding: "7px 12px" },
  fileBtn: { position: "relative", fontFamily: mono, fontSize: 12, color: ink, border: `1px solid ${ink}`, borderRadius: 3, padding: "7px 12px", cursor: "pointer" },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", pointerEvents: "none" },
  confirm: { display: "flex", flexDirection: "column", gap: 8, fontSize: 13, background: raised, border: `1px solid ${line}`, borderRadius: 4, padding: 10 },
  status: { fontSize: 13 },
};
