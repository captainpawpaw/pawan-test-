# Floating Notes

Plain, see-through note windows that float above everything on your Windows
laptop. Open one window per job and keep them on any of your screens.

## How it works

Each window has four steps. Click to go forward, and click **‹** to go back:

1. **Dot**: a small ✎ circle that sits out of the way.
2. **Root**: click the dot to open it. It shows **Projects ›**, a shortcut back to
   the last project this window had open, and **New window**.
3. **Projects**: every project you've made, newest first. Type in the search box
   to search project names *and* the notes inside them. **+ New project** adds one.
   Right-click a project to rename or delete it.
4. **Notes**: type your notes. They save automatically.
   - Each time you open a project and start typing at the end, a new note begins:
     a blank line after the last note, then the date and time
     (e.g. `Wed 14 Oct 2026, 09:41`), then what you type.
   - **+ Note** at the bottom starts a new dated note straight away.
   - Clicking into an older note to fix it doesn't add a date.

- **–** shrinks the window back to a dot (or press **Esc**). **×** closes the window.
- **Drag** the top strip (or the dot) to move a window, onto any monitor.
  Drag the **◢** corner to resize the notes view.
- When the mouse leaves a window, it fades so you can see through it, and
  **3 seconds later it shrinks back to its dot**. Typing restarts the
  3 seconds, so it won't disappear while you're writing.
- **Right-click** the top strip or the dot for: New window, Shrink to dot after
  (3 / 10 / 30 seconds, or Never), Fade when idle (Off / Light / Medium / Strong),
  Start with Windows, Close this window, Quit.

### Several windows

Open as many windows as you like with **New window**, one for each job. They all
share the same projects, and if two windows show the same project, typing in one
updates the other. When you quit and restart, every window comes back where
you left it, showing what it was showing.

Running the app again while it's already open just opens one more window, so a
pinned taskbar shortcut works as a "new note window" button.

## Run it

You need [Python 3.10+ for Windows](https://www.python.org/downloads/windows/). The
default installer has everything; there's nothing else to install.

- Double-click **`run.bat`**, or
- run `pyw floating_notes.py`

To build a standalone **`FloatingNotes.exe`**, double-click **`build.bat`**. The exe
ends up in `dist\`.

## Your data

Everything is saved on your PC in `%APPDATA%\FloatingNotes\data.json` (projects,
notes, and which windows are open where). It's a plain JSON file, so you can back
it up by copying it. If it ever becomes unreadable, the app renames it to
`data.json.unreadable` rather than overwriting it, and starts fresh.

## Tests

```
py -m unittest
```

## Limits

- The windows float above other windows on every monitor. Windows' separate
  **virtual desktops** (Win+Tab → New desktop) haven't been tested; the windows
  may stay on the desktop where they were opened.
- These notes are separate from the web Notes app in `notes/`.
