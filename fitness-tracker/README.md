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

Entries are saved to the browser's `localStorage`, one key per month
(`fitness-tracker:month:YYYY-MM`). Data lives only on the device/browser it
was entered on — there's no account system or sync. Clearing browser data
or using a different browser/device starts fresh.

## Exercise data

The exercise library and autosuggest fields pull from the public
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) dataset on
load, merged with a custom list defined at the top of `src/App.jsx`
(`CUSTOM_EXERCISES`) — edit that array to add or remove entries.
