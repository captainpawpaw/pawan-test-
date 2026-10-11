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

## Importing exercises

In the Exercises tab, **Import exercises from a web page** reads a pasted page
(`src/importParser.js`): tables, lists and headings are kept when the copy
includes the page's HTML. Each section title becomes a tag, so a plan's
"Day 1: Legs and Abs" tags that day's exercises, and sets, reps, %1RM, RPE
and rest are kept as the exercise's plan, which fills in the log form. Names
are matched to the library ignoring case, hyphens and plurals.

Inside a claude.ai artifact two extra options use Claude (`src/claudeRead.js`):
**Read with Claude** for pages the rules can't follow, and **screenshots**.
Tall screenshots are cut into overlapping pieces first, since Claude sees each
image at about 1.2 megapixels.

## Themes

Two looks, picked at the bottom of the page: **Classic** (warm paper) and
**Ledger** (vintage ledger paper with ruled lines and a red margin, Swiss red
and black, a blueprint masthead, maple for food and neon milestone badges).
Colours live in `src/theme.js` as CSS variables; the choice is kept in the
profile, so it syncs through Google Drive.

## Progress

The Progress tab charts one exercise, one tag or all exercises: the Ledger
score, weight & reps, best weight, estimated 1-rep max (Epley), volume
(sets × reps × max weight), reps or sets for lifts, and minutes or distance
for cardio.

The **Ledger score** is one standard progress number that ignores warm-up
patterns, using only max weight, sets and reps. Each exercise starts at 100,
the average of its first two weeks. A session scores
100 × (½ × strength ÷ starting strength + ½ × work ÷ starting work), where
strength is max weight × (1 + reps ÷ 30) and work is sets × reps × max weight.
A tag, or all exercises, averages its exercises' scores, so each exercise
counts equally. Drag to move through time; pinch (or ctrl + scroll on a
trackpad, or the − / + buttons) to zoom. The chart groups values by day, week,
month or year to suit the zoom, or jump straight to one with the scale buttons.
Data logic lives in `src/progress.js`, the chart in `src/Progress.jsx`.

## Food

Each day in the Log has a Food section: search a food, choose grams or a
portion, and the day's calories, protein, carbs, fat and fibre add up, with
optional daily calorie and protein targets. Food also shows in the Progress
tab (daily totals, or the average day per week, month or year, with the
target as a line).

Where the data comes from:

| Source | Where it works | What it covers |
|---|---|---|
| Built-in list (`public/foods.json`) | Everywhere, offline | ~8,250 everyday foods with portions, from the USDA National Nutrient Database for Standard Reference, Release 28 (public domain). Rebuild with `node scripts/build-foods.mjs ABBREV.txt FOOD_DES.txt`. |
| Claude estimates | claude.ai artifact | Describe a meal, or add a photo; results are marked as estimates. |
| Open Food Facts | Website (e.g. Cloudflare Pages) | Branded products, barcode lookup and camera scanning. Data © Open Food Facts contributors, ODbL. |
| USDA FoodData Central online | Website with the Pages Function and a key | More foods and US branded products, through `functions/api/usda.js`. |

## Deploy on Cloudflare Pages

1. In the Cloudflare dashboard go to **Workers & Pages → Create → Pages →
   Connect to Git**, and pick this repository.
2. Build settings:
   - **Framework preset:** None (or Vite)
   - **Root directory:** `fitness-tracker`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. **Environment variables** (Settings → Variables and secrets), for
   Production and Preview:
   - `USDA_API_KEY`: a free key from https://fdc.nal.usda.gov/api-key-signup
     (mark it as a secret). Without it the app still works; USDA online
     search just stays off.
   - `VITE_GOOGLE_CLIENT_ID`: only if you want Google Drive sync (see above);
     add your `https://<project>.pages.dev` address to the client's
     **Authorized JavaScript origins**.
   - `NODE_VERSION`: `20`
4. **Save and Deploy.** Each push to the production branch redeploys; other
   branches get preview addresses.

The `functions/` folder is picked up automatically: `/api/usda` runs as a
Pages Function, so the USDA key never reaches the browser.

Moving data between the claude.ai link and the website: use **Back up or move
your data** at the bottom of the app to export a file on one and import it on
the other. Import only adds; nothing already logged is removed.

## Tests

```bash
npm test                      # unit tests
npm install --no-save playwright
./e2e/run-all.sh              # browser tests, with simulated outside services
```

## Exercise data

The exercise library and autosuggest fields load from `public/exercises.json`, a trimmed copy of the public
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) dataset,
merged with a custom list defined at the top of `src/App.jsx`
(`CUSTOM_EXERCISES`) — edit that array to add or remove entries.
