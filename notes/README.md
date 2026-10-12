# Notes

A simple, fast note-taking app built with React + Vite.

- Notes autosave as you type; the first line becomes the title
- Give each note as many tags as you like in its tag field (Enter or comma adds one,
  × or Backspace removes one, existing tags are suggested), or type `#tags` in the text
- Search covers the text and tags of every note; `#tag` matches a tag exactly, and
  clicking a tag in the sidebar filters by it (click several to narrow further)
- Pin important notes to the top
- Delete with a 6-second undo
- Export / import all notes as JSON (imports merge, keeping the newer copy of each note)
- Light and dark themes follow your system setting
- Works on phones: the list and editor become separate screens
- Keyboard: `Ctrl/Cmd+Alt+N` new note, `/` search, `Esc` back to the list (mobile)

## Run locally

```bash
npm install
npm run dev
```

Opens at http://localhost:5173

## Test

```bash
npm test
```

## Build for production

```bash
npm run build
```

Outputs a static site to `dist/` that any static host (Vercel, Netlify, GitHub Pages) can serve.

## Publish as a claude.ai artifact

```bash
npm run build:artifact
```

Writes `dist-artifact/notes.html`, a single page (React loads from cdnjs) to
publish as an artifact with the `db`, `user` and `downloads` capabilities.

## Data storage

When opened as a published claude.ai artifact, each person's notes are saved to
their own private space in the artifact's database, so they follow you across
devices and no one else (the artifact's owner included) can read them.

Anywhere else, notes are saved in the browser's `localStorage` under `notes-app:notes`, so they
live only on that device/browser. Use **Export** to back them up or move them to
another device, then **Import** there.
