#!/usr/bin/env bash
# Browser tests: builds the app with a test Google client ID, then drives it in
# Chromium with simulated Google Drive, Open Food Facts, USDA and Claude.
# Needs Playwright: npm install --no-save playwright
set -euo pipefail
cd "$(dirname "$0")"
(cd .. && node scripts/copy-ocr.mjs >/dev/null && VITE_GOOGLE_CLIENT_ID=test-client.apps.googleusercontent.com npx vite build --outDir e2e/dist --emptyOutDir >/dev/null)
fail=0
for t in sync tags logtags import bw progress food food-artifact custom calendar edit layout minweight theme label swipe meals weighin lasttime splits bests liftunits; do
  out=$(node "$t.mjs" dist 2>&1) || true
  pass=$(grep -c '^PASS' <<<"$out" || true)
  bad=$(grep -Ec '^FAIL|Error' <<<"$out" || true)
  echo "$t: $pass passed, $bad failed"
  [ "$bad" = 0 ] || { grep -E '^FAIL|Error' <<<"$out" | head -5; fail=1; }
done
exit $fail
