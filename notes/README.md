# Notes

A simple, fast note-taking app built with React + Vite.

- Notes autosave as you type; the first line becomes the title
- Search across all notes; add `#tags` anywhere and filter by clicking a tag
- Pin important notes to the top
- Delete with a 6-second undo
- Export / import all notes as JSON (imports merge, keeping the newer copy of each note)
- Light and dark themes follow your system setting
- Works on phones: the list and editor become separate screens
- Keyboard: `Ctrl/Cmd+Alt+N` new note, `Esc` back to the list (mobile)

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

## Data storage

Notes are saved in the browser's `localStorage` under `notes-app:notes`, so they
live only on that device/browser. Use **Export** to back them up or move them to
another device, then **Import** there.
