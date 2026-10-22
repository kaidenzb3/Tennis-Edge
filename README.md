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

The frontend is deployed as Cloudflare Worker static assets at `https://tennis-edge.kaidenzb3.workers.dev` from this repository’s `main` branch; GitHub Pages is also a supported origin. It uses the fixed proxy URL `https://tennis-edge-api.kaidenzb3.workers.dev`. No matching Vercel project was found in the connected account. Do not deploy this change to PropLab.

The previously documented Worker source was absent from the repository. The replacement is `worker/sportscore-proxy.mjs`; it requires a Durable Object binding, rather than only pasting a script into the dashboard.

1. The production Worker source was inspected in the signed-in Cloudflare dashboard. Its API base is `https://sportscore1.p.rapidapi.com` with no prefix. The replacement preserves the existing live/date page-1, event, tennis-points, statistics, markets and WTA rankings routes.
2. Copy `worker/wrangler.toml.example` to `worker/wrangler.toml`. Confirm the Cloudflare account and existing Worker name `tennis-edge-api`. Keep any existing deployment configuration that is still needed. For a different frontend origin, update `ALLOWED_ORIGIN`.
3. The existing `tennis-edge-api` Worker already has an encrypted `RAPIDAPI_KEY` secret. Preserve it during deployment; do not retrieve or replace it. For a fresh installation only, use `wrangler secret put RAPIDAPI_KEY` from `worker/`. Never put the key in source control or browser storage.
4. Deploy with `wrangler deploy`. The included SQLite Durable Object migration and `SPORTSCORE_CACHE` binding are required. All requests use a single named object so caching, deduplication, pacing, and cooldown are shared across visitors and regions.
5. Smoke-test live, schedule, match detail and completed results. Check `X-Data-Timestamp`, `X-Data-Stale` and `Retry-After`. A forced upstream 429 should retain the last good response and suppress further upstream calls until cooldown ends.
6. Merge/deploy the frontend changes through the existing Cloudflare Workers Build linked to `kaidenzb3/Tennis-Edge` on `main` after validation. The script version is bumped to 3.0.20. No Vercel configuration is introduced.

The browser protections work with the existing proxy; shared protection across all visitors requires deploying the replacement Worker. Deployment status and live verification are recorded in the pull request.

## Request policy

- Live scores, statistics and points: 5-minute cache. Date schedules/results: 30 minutes. Markets: 15 minutes. Cache keys ignore client version and use canonical action/parameters.
- In-flight calls deduplicate. An origin-wide Web Lock and localStorage share the browser cache/cooldown across tabs when supported; without Web Locks deduplication is per tab. Storage failures fall back to memory.
- Live automatic refresh runs every 5 minutes in visible tabs. Automatic results grading runs every 30 minutes and respects the auto-refresh setting. Manual buttons still obey the cache/cooldown.
- No immediate retry. A 429 starts at 5 minutes; network/5xx/invalid-response failures start at 1 minute. Repeated failures double up to 1 hour, while a longer upstream Retry-After (seconds or HTTP date) always wins. Different endpoints share the cooldown.
- Successful responses, including empty lists, remain eligible for stale fallback for 24 hours. Failed responses never overwrite good data. Proxy response headers preserve the original timestamp and identify stale data; live/schedule UI labels indicate cached fallback.
- The proxy spaces upstream cache misses by at least 1 second and bounds persistent response storage to 200 entries. It permits only the supported actions and nearby schedule dates. There is no periodic proxy polling.
- These controls reduce traffic; they cannot restore an exhausted provider subscription quota. Longer quota reset periods should be supplied by the provider through Retry-After.

Upcoming and Model boards revalidate cached fixtures at render time: started, finished, cancelled, past-date, undated, and older-than-24-hour cached schedules are excluded. Historical pregame picks and grading records remain stored. This prevents October 7 fixtures from remaining on a current board during a provider outage. The adapter also preserves timestamps that already contain UTC or timezone offsets.

Run all local tests with `node --test tests.js rate-limit.test.js schedule.test.js`. Proxy tests mock the Durable Object storage and upstream; they do not replace a Cloudflare deployment smoke test.

## Existing model

Tennis Edge continues calculating overall Elo, surface Elo, recent form, and its model locally from the historical WTA results snapshot. The scanner filters are research settings and are not presented as proven profitable rules.

## Files added or changed

- `sportscore.js`: SportScore requests, WTA singles filtering, and match normalization.
- `worker/sportscore-proxy.mjs`: secure RapidAPI proxy.
- `worker/wrangler.toml.example`: optional Worker configuration example.
- `app.js`: SportScore live/upcoming/results feeds, automatic stats, and five-minute visible-tab refresh.
- `decider-app.js`: automatic pre-match favourite freezing from verified pre-match prices.
- `index.html`: v3.0 labels and SportScore setup UI.
- `service-worker.js`, `manifest.webmanifest`: v3.0 PWA cache and description.

No API keys belong in this repository.
