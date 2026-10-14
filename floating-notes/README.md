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
  Colours…, Google Drive, Start with Windows, Close this window, Quit.

### Colours

Windows are white by default. Right-click → **Colours…** to change any of them:
background, note text, titles/labels/buttons, the date-and-time lines, borders,
highlight, and the search and name boxes. Click a swatch to pick a colour; changes
show in every window straight away. **White** and **Dark** reset everything to a
preset.

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

If Python opens an empty console or terminal window, the app closes it by restarting
itself with the windowless `pythonw.exe` (some Python installers, such as the Python
install manager, start the console version). To keep the console for troubleshooting,
run `py floating_notes.py --console`.

To build a standalone **`FloatingNotes.exe`**, double-click **`build.bat`**. The exe
ends up in `dist\`.

## Your data

Notes are always saved on your PC first, in `%APPDATA%\FloatingNotes\data.json`
(projects, notes, and which windows are open where), so the app works with or
without the internet. If that file ever becomes unreadable, the app renames it to
`data.json.unreadable` rather than overwriting it, and starts fresh.

### Saving to Google Drive (with offline mode)

1. Install [Google Drive for desktop](https://www.google.com/drive/download/) and sign in.
   It adds a **Google Drive** drive (usually `G:`) with a **My Drive** folder.
2. Right-click a Floating Notes window → **Google Drive → Save to Google Drive…**
   and pick **My Drive** (or any folder inside it).

Your notes are then also kept in **`Floating Notes.json`** in that folder, which Google
Drive uploads. The status at the bottom of a notes window says where things stand:

| Status | Meaning |
| --- | --- |
| Saved · Google Drive synced | Up to date with the Drive folder. |
| Saved on PC · Drive offline | The Drive folder can't be reached (Drive for desktop isn't running or you're signed out). Keep working; it syncs when the folder is back. |
| Saved on PC · Drive sync paused | The Drive copy couldn't be read or written, often because Google Drive is still downloading it. It retries every few seconds; right-click → Google Drive shows the reason. |

When your laptop has no internet, Google Drive for desktop keeps the file and uploads it
when you're back online. The app checks the Drive folder every 5 seconds, so changes
from another PC appear in your open windows on their own.

**Using it on more than one PC:** choose the same Drive folder on each. Notes from
every PC are merged project by project. Each PC remembers what it last saw in Drive,
so it can tell its own edits from edits made elsewhere. If a project was changed on two
PCs before they synced and one version just has more added at the end, that one is
kept. Only if both were changed in different ways are both versions kept: the newer
under the project's name, the other as **“Name (conflict, PC-NAME)”**, so you can copy
across anything you need and delete the extra. Deleting a project on one PC deletes it
on the others.

Right-click → Google Drive → **Remove duplicate conflict copies** deletes conflict copies
whose text is already all in the main project (it never removes text found nowhere else).

**To stop:** right-click → Google Drive → **Stop syncing**. Your notes stay on this PC,
and the copy in Drive is left as it is.

## Tests

```
py -m unittest
```

## Limits

- The windows float above other windows on every monitor. Windows' separate
  **virtual desktops** (Win+Tab → New desktop) haven't been tested; the windows
  may stay on the desktop where they were opened.
- These notes are separate from the web Notes app in `notes/`.
- Google Drive sync works through the Google Drive for desktop folder; the app doesn't
  sign in to Google itself.
