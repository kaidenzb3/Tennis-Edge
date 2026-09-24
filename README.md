# Tennis Edge v3.0

This release preserves the existing mobile PWA and its Live, Model, Analyzer, Results, Decider, and Settings sections. SportScore is now the primary automatic tennis-data source.

## Automatic data

- WTA singles live and upcoming matches
- completed results and automatic signal grading
- local start times, tournaments, surfaces, set scores, games, points, and server
- point history and available match statistics
- available pre-match match-winner odds
- automatic freezing of the original pre-match favourite
- automatic Set 1 loss, Set 2 recovery, and deciding-set detection

SportScore's tested market records were marked as pre-match even when a match was live. Tennis Edge therefore freezes those prices as the opening snapshot but never labels them as after-Set-1 or Set-3 prices. Those later fields remain available for a future live-odds provider or manual research entry.

## Secure setup

The GitHub Pages app must not contain the RapidAPI key. Deploy `worker/sportscore-proxy.js` as a Cloudflare Worker:

1. Create a Worker in Cloudflare and paste `worker/sportscore-proxy.js` into it.
2. Add an encrypted Worker secret named `RAPIDAPI_KEY` containing the RapidAPI key.
3. Set `ALLOWED_ORIGIN` to `https://kaidenzb3.github.io`.
4. Deploy the Worker and copy its `https://...workers.dev` address.
5. Open Tennis Edge → Settings, paste that address under **SportScore connection**, save, and test.

The Worker limits requests to the endpoints Tennis Edge needs. The key remains in Cloudflare's encrypted secret store.

## Existing model

Tennis Edge continues calculating overall Elo, surface Elo, recent form, and its model locally from the historical WTA results snapshot. The scanner filters are research settings and are not presented as proven profitable rules.

## Files added or changed

- `sportscore.js`: SportScore requests, WTA singles filtering, and match normalization.
- `worker/sportscore-proxy.js`: secure RapidAPI proxy.
- `worker/wrangler.toml.example`: optional Worker configuration example.
- `app.js`: SportScore live/upcoming/results feeds, automatic stats, and one-minute refresh.
- `decider-app.js`: automatic pre-match favourite freezing from verified pre-match prices.
- `index.html`: v3.0 labels and SportScore setup UI.
- `service-worker.js`, `manifest.webmanifest`: v3.0 PWA cache and description.

No API keys belong in this repository.
