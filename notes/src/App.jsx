import { useEffect, useMemo, useRef, useState } from "react";
import {
  allTags, createNote, filterNotes, formatDate, mergeNotes, previewOf, sortNotes,
  titleOf, validateImport,
} from "./notes.js";
import { loadNotes, saveNotes } from "./storage.js";
import { applySnapshot, connectCloud } from "./cloud.js";

// Inside claude.ai, notes sync to the viewer's private cloud space; elsewhere, localStorage.
const inViewer = !!window.claude?.use;

export default function App() {
  const [mode, setMode] = useState(inViewer ? "connecting" : "local"); // local | connecting | cloud
  const [notes, setNotes] = useState(() => (inViewer ? [] : loadNotes()));
  const [activeId, setActiveId] = useState(() => sortNotes(notes)[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [showEditor, setShowEditor] = useState(false); // which pane is visible on narrow screens
  const [saveFailed, setSaveFailed] = useState(false);
  const [undo, setUndo] = useState(null); // { note, timer }
  const [message, setMessage] = useState(null); // { text, error }
  const [downloads, setDownloads] = useState(null);
  const syncRef = useRef(null);
  const flashTimer = useRef(null);
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const focusEditor = useRef(false);

  // Focus right after the new note's editor commits, so the first keystrokes aren't dropped.
  useEffect(() => {
    if (focusEditor.current) { focusEditor.current = false; editorRef.current?.focus(); }
  }, [activeId]);

  // Local mode: save immediately (no debounce) so closing the tab right after typing never loses an edit.
  useEffect(() => {
    if (mode === "local") setSaveFailed(!saveNotes(notes));
  }, [notes, mode]);

  // Local mode: keep tabs in sync when the same app is open twice.
  useEffect(() => {
    if (mode !== "local") return;
    const onStorage = (e) => { if (e.key === "notes-app:notes") setNotes(loadNotes()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [mode]);

  // Cloud mode: subscribe once to this viewer's notes.
  useEffect(() => {
    if (!inViewer) return;
    let unsubscribe = () => {};
    let cancelled = false;
    connectCloud().then((sync) => {
      if (cancelled) return;
      if (!sync) {
        setNotes(loadNotes());
        setMode("local");
        return;
      }
      syncRef.current = sync;
      sync.onError = (e) => {
        setSaveFailed(true);
        if (e?.code === "quota_exceeded") flash("Storage is full. Delete some notes to save new ones.", true);
      };
      let first = true;
      unsubscribe = sync.subscribe(
        (remote) => {
          setNotes((local) => applySnapshot(local, remote, sync.isDirty));
          if (first) {
            first = false;
            setActiveId((id) => id ?? sortNotes(remote)[0]?.id ?? null);
            setMode("cloud");
          }
        },
        () => flash("Lost connection to your notes. Reload the page to reconnect.", true),
      );
    });
    window.claude.use("downloads").then((d) => !cancelled && setDownloads(d));
    const flushAll = () => syncRef.current?.flushAll();
    const onHide = () => { if (document.visibilityState === "hidden") flushAll(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushAll);
    return () => {
      cancelled = true;
      unsubscribe();
      flushAll();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushAll);
    };
  }, []);

  function flash(text, error = false) {
    setMessage({ text, error });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setMessage(null), 5000);
  }

  const visible = useMemo(() => sortNotes(filterNotes(notes, query)), [notes, query]);
  const tags = useMemo(() => allTags(notes), [notes]);
  const active = notes.find((n) => n.id === activeId) ?? null;

  function addNote() {
    if (mode === "connecting") return;
    const note = createNote();
    setNotes((ns) => [note, ...ns]);
    syncRef.current?.save(note);
    setActiveId(note.id);
    setQuery("");
    setShowEditor(true);
    focusEditor.current = true;
  }

  function updateActive(patch) {
    if (!active) return;
    const note = { ...active, ...patch, updatedAt: Date.now() };
    setNotes((ns) => ns.map((n) => (n.id === note.id ? note : n)));
    syncRef.current?.saveSoon(note);
  }

  function togglePin() {
    if (!active) return;
    // Pinning shouldn't count as an edit, so keep updatedAt.
    const note = { ...active, pinned: !active.pinned };
    setNotes((ns) => ns.map((n) => (n.id === note.id ? note : n)));
    syncRef.current?.save(note);
  }

  function deleteActive() {
    if (!active) return;
    const idx = visible.findIndex((n) => n.id === active.id);
    const next = visible[idx + 1] ?? visible[idx - 1] ?? null;
    setNotes((ns) => ns.filter((n) => n.id !== active.id));
    syncRef.current?.remove(active.id);
    setActiveId(next?.id ?? null);
    setShowEditor(false);
    if (undo) clearTimeout(undo.timer);
    setUndo({ note: active, timer: setTimeout(() => setUndo(null), 6000) });
  }

  function restore() {
    if (!undo) return;
    clearTimeout(undo.timer);
    setNotes((ns) => [...ns, undo.note]);
    syncRef.current?.save(undo.note);
    setActiveId(undo.note.id);
    setUndo(null);
  }

  async function exportNotes() {
    const filename = `notes-${new Date().toISOString().slice(0, 10)}.json`;
    const json = JSON.stringify({ version: 1, notes }, null, 2);
    if (downloads) {
      try {
        await downloads.save({ filename, data: json });
      } catch (e) {
        if (e?.code !== "declined") flash("Export isn't available here.", true);
      }
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importNotes(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const incoming = validateImport(JSON.parse(await file.text()));
      const merged = mergeNotes(notes, incoming);
      const current = new Set(notes);
      setNotes(merged);
      for (const n of merged) if (!current.has(n)) syncRef.current?.save(n);
      flash(`Imported ${incoming.length} note${incoming.length === 1 ? "" : "s"}.`);
    } catch (err) {
      flash(`Couldn't import that file: ${err.message}. Choose a notes export (.json).`, true);
    }
  }

  // Ctrl/Cmd+Alt+N for a new note, Escape to go back to the list on mobile.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); addNote(); }
      if (e.key === "Escape") setShowEditor(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const words = active ? (active.body.match(/\S+/g) || []).length : 0;

  return (
    <div className={`app ${showEditor ? "show-editor" : ""}`}>
      <aside className="sidebar">
        <header className="side-head">
          <h1>Notes</h1>
          <button className="primary" onClick={addNote} disabled={mode === "connecting"} title="New note (Ctrl+Alt+N)">+ New</button>
        </header>
        <input
          className="search"
          type="search"
          placeholder="Search notes or #tag"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {tags.length > 0 && (
          <div className="tags">
            {tags.map(([t, c]) => {
              const on = query.toLowerCase().split(/\s+/).includes(`#${t}`);
              return (
                <button
                  key={t}
                  className={`chip ${on ? "on" : ""}`}
                  onClick={() => setQuery(on ? query.replace(new RegExp(`(^|\\s)#${t}(?=\\s|$)`, "i"), "").trim() : `${query} #${t}`.trim())}
                >
                  #{t} <span>{c}</span>
                </button>
              );
            })}
          </div>
        )}
        <ul className="list">
          {visible.map((n) => (
            <li key={n.id}>
              <button
                className={`item ${n.id === activeId ? "active" : ""}`}
                onClick={() => { setActiveId(n.id); setShowEditor(true); }}
              >
                <div className="item-title">
                  {n.pinned && <span className="pin" aria-label="Pinned">★</span>}
                  {titleOf(n)}
                </div>
                <div className="item-meta">
                  <span>{formatDate(n.updatedAt)}</span>
                  <span className="item-preview">{previewOf(n) || "No additional text"}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
        {visible.length === 0 && (
          <p className="empty">
            {mode === "connecting" ? "Loading your notes…" : notes.length === 0 ? "No notes yet. Click + New to start." : "No notes match your search."}
          </p>
        )}
        <footer className="side-foot">
          <button onClick={exportNotes} disabled={notes.length === 0}>Export</button>
          <button onClick={() => fileRef.current.click()}>Import</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importNotes} />
          <span className="count" title={mode === "cloud" ? "Saved to your account, private to you" : "Saved in this browser only"}>
            {notes.length} note{notes.length === 1 ? "" : "s"}{mode === "cloud" ? " · synced" : ""}
          </span>
        </footer>
      </aside>

      <main className="editor">
        {active ? (
          <>
            <div className="toolbar">
              <button className="back" onClick={() => setShowEditor(false)}>‹ Notes</button>
              <span className="stamp">Edited {formatDate(active.updatedAt)} · {words} word{words === 1 ? "" : "s"}</span>
              <button onClick={togglePin} aria-pressed={active.pinned}>{active.pinned ? "★ Unpin" : "☆ Pin"}</button>
              <button className="danger" onClick={deleteActive}>Delete</button>
            </div>
            <textarea
              ref={editorRef}
              value={active.body}
              onChange={(e) => updateActive({ body: e.target.value })}
              placeholder={"Title on the first line…\n\nAdd #tags anywhere in the text."}
              spellCheck
            />
          </>
        ) : (
          <div className="placeholder">
            <p>Select a note or create a new one.</p>
            <button className="primary" onClick={addNote}>+ New note</button>
          </div>
        )}
      </main>

      {saveFailed && (
        <div className="toast error">
          {mode === "cloud" ? "Some changes didn't save. Check your connection and reload." : "Couldn't save. Browser storage is full or blocked."}
        </div>
      )}
      {message && !undo && <div className={`toast ${message.error ? "danger" : ""}`}>{message.text}</div>}
      {undo && (
        <div className="toast">
          Deleted “{titleOf(undo.note)}”
          <button onClick={restore}>Undo</button>
        </div>
      )}
    </div>
  );
}
