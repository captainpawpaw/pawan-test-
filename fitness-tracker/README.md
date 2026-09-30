# Training Ledger

A fitness tracker with a monthly calendar and separate Strength / Cardio
logging, plus a searchable exercise library with autosuggest.

## Run locally

```bash
npm install
npm run dev
```

Opens at http://localhost:5173

## Build for production

```bash
npm run build
```

Outputs a static site to `dist/`.

## Deploy

Any static host works. Two easy options:

**Vercel**
1. Push this folder to a GitHub repo.
2. Import the repo at vercel.com/new — it auto-detects Vite, no config needed.

**Netlify**
1. Run `npm run build`.
2. Drag the `dist/` folder onto app.netlify.com/drop.

## Data storage

When opened as a published claude.ai artifact, entries are saved to the
artifact's database in your own private space, so they follow you across
devices. Anywhere else, entries are saved to the browser's `localStorage`, one key per month
(`fitness-tracker:month:YYYY-MM`). That data lives only on the device/browser it
was entered on unless Google Drive sync is turned on (below). Clearing
browser data or using a different browser/device starts fresh.

## Google Drive sync (optional)

People can press **Connect Google Drive** in the header to back up their log
to their own Google Drive and sync it between devices. The log is kept in the
Drive's hidden app folder (`training-ledger.json`), and the app can only see
files it created there. This browser's storage stays the working copy, so
logging works offline and syncs the next time Drive is reachable. Sync runs a
moment after each change, and on each device when you tap the sync button.
Google sign-ins last about an hour, so after that the button reads **Tap to
sync with Drive**.

Two copies merge by keeping every entry either side has and removing any entry
either side deleted (see `src/merge.js`).

The button only appears when the site is built with a Google OAuth client ID.
To create one:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   create a project, e.g. "Training Ledger".
2. **APIs & Services → Library**: find **Google Drive API** and click **Enable**.
3. **APIs & Services → OAuth consent screen** (called **Google Auth Platform**
   in newer consoles): choose **External**, give the app name and your support
   email, and add the scope `.../auth/drive.appdata`. While the app is in
   **Testing**, add each person's Gmail under **Test users** (up to 100).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   type **Web application**. Under **Authorized JavaScript origins** add your
   site's address, e.g. `https://your-site.netlify.app`, plus
   `http://localhost:5173` for local testing. No redirect URI is needed.
5. Copy the client ID (it ends in `.apps.googleusercontent.com`) and set it as
   `VITE_GOOGLE_CLIENT_ID`:
   - locally: copy `.env.example` to `.env` and paste it in;
   - on Netlify or Vercel: add it as an environment variable in the site's
     settings, then redeploy.

The client ID is not a secret; it's visible in the built site. To let anyone
sign in without being added as a test user, publish the consent screen
(**Publish app**) and complete Google's verification.

Drive sync is turned off inside a claude.ai artifact, whose sandbox blocks
Google's sign-in.

## Tests

```bash
npm test
```

## Exercise data

The exercise library and autosuggest fields load from `public/exercises.json`, a trimmed copy of the public
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) dataset,
merged with a custom list defined at the top of `src/App.jsx`
(`CUSTOM_EXERCISES`) — edit that array to add or remove entries.
