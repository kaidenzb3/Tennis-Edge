# Tennis Edge v3.0

An installable mobile WTA analysis PWA. v3 keeps the v2.6 Live, Model, Analyzer, Results and Settings screens and adds a Decider Scanner.

## Setup

1. Get a Cito / tennisapi.dev API key from [tennisapi.dev](https://tennisapi.dev/).
2. Serve the files over HTTPS or localhost. For a local preview, run `npx serve .` in this folder.
3. Open Settings, enter the Cito key, Save, then Test.
4. Load Live and Upcoming. Use **Sync data** in Model to build local overall and surface Elo from Cito WTA historical match results. The sync fetches a bounded five-year sample to control requests and browser storage; it is not a complete historical archive.
5. On the Decider tab, freeze the original pre-match favourite and its decimal odds before the match starts. Capture later odds snapshots when available. The app detects the set progression, logs one deciding-set signal per match, and grades it from completed results.

No API key is included in these files. The key is stored in the browser's local storage on each device. Do not commit a key to GitHub. A browser-only app cannot keep a key secret from that device's browser; use a server-side proxy for a production key that must remain private.

## Data and odds

- Cito / tennisapi.dev supplies WTA live matches, recent completed results, weekly rankings, the historical match archive, and tournament schedules where supported by your API plan. The adapter is in `provider.js`.
- Upcoming matches are assembled from the season calendar and active tournament schedules. Start times display in the device's local timezone when a precise time exists; date-only fixtures show **Time TBD**.
- The existing Tennis Edge Elo and surface Elo calculations remain local. Their input now comes from the Cito match archive, stored separately from the old v2 cache. v2 browser data stays available if you return to the earlier app.
- Cito does not currently provide sportsbook odds. `decider-app.js` has a separate manual `OddsProvider` for four timestamped snapshots: pre-match, after Set 1, start Set 3, and optional early Set 3. Pre-match favourite and its price must be captured before play. Later snapshots cannot be overwritten.
- Serve and break statistics in the existing Live Analyzer remain manual where the provider does not return them.

## Decider Scanner

The scanner freezes the original favourite before play, detects that favourite losing Set 1, shows **SETUP FORMING** when she is competitive in Set 2, and creates one signal when she wins Set 2. Signals can be **STRONG**, **WATCH**, **PASS**, or **WAITING FOR PRICE**. They become **COMPLETED** after a result is found.

`p0 = 1 / preMatchFavOdds`, `p1 = 1 / afterSet1FavOdds`, `p2 = 1 / startSet3FavOdds`.

`snapbackRecoveryPct = ((p2 - p1) / (p0 - p1)) * 100` and `distanceFromOpenPct = abs(startSet3FavOdds - preMatchFavOdds) / preMatchFavOdds * 100`.

The starting filters are maximum Set 3 favourite odds **1.60**, minimum snapback **80%**, better ranking required, and optional better surface Elo. They are configurable research filters, not proven profitable rules. If the price denominator is invalid or a required snapshot is missing, no snapback figure is invented.

Hit rate grades **the underdog winning Set 3**. Average underdog odds uses all captured start-Set-3 prices. Units profit and ROI use a one-unit underdog bet at those decimal odds; only signals with a completed result and valid underdog price enter the profit figures. These are hypothetical research outcomes, not placed bets.

## Existing features retained

Live and upcoming WTA boards; tournament filtering; local start times; pre-match model and frozen lean log; overall and surface Elo; recent form; Live Analyzer with red missing fields; tracked plays and results; app-shell offline cache; install to home screen; and in-app notifications while open.

## Limits to check with your key

The API documentation confirms the endpoint families, but no user key was available for an end-to-end Cito test of the response fields, browser CORS, or plan access. The free evaluation allowance is 500 calls per month and may be too small for sustained live polling. The five-year historical sync is capped at eight pages per year and can produce incomplete Elo if more pages exist. The app shows source errors under Settings when a call fails. Completed-result grading checks Cito's recent-results feed and may miss a result once it leaves that feed.

## GitHub Pages

Upload **all files** in this folder to your site repository, replacing the older app files. Keep the old GitHub repository or a ZIP backup before uploading. The changed service-worker cache name helps installed phones fetch the new version. GitHub Pages can serve this static app from `main` → `/ (root)`.

API reference: [Cito tennis API](https://docs.citoapi.com/docs/api/tennis/). Cito's own [betting data page](https://tennisapi.dev/tennis-betting-api/) says it does not currently provide bookmaker odds.
