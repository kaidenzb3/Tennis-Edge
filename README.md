# Tennis Edge v2

A mobile-first, installable WTA analysis PWA.

## v2 adds
- Automatic live WTA match loading
- Automatic upcoming WTA match board
- 15-minute live refresh while the app is open
- Free API-key setup
- Automatic sync of recent WTA results from Jeff Sackmann / Tennis Abstract's public dataset
- Tennis Edge global Elo
- Surface-specific Elo
- Last-10 form
- Same-surface last-10 form
- Three-set frequency
- 2–0 vs 2–1 pre-match model
- Live Set 2 preliminary grading from the score
- Full manual live-stat upgrade using serve and break-point numbers
- In-app/browser notifications while the app is open
- Tracked bets and hit-rate dashboard
- Offline shell + cached boards

## Why the historical metrics say "Tennis Edge Elo"
Tennis Edge derives its own Elo from Jeff Sackmann's public WTA match-results dataset. It does **not** scrape the Tennis Abstract website or claim to reproduce Tennis Abstract's private/current Elo calculations exactly.

Data attribution:
Jeff Sackmann / Tennis Abstract — https://github.com/JeffSackmann/tennis_wta
License: CC BY-NC-SA 4.0 (non-commercial, attribution required).

## Live scores — free
Tennis Edge uses Live Tennis API:
https://livetennisapi.com

The free tier currently supports live/upcoming matches and scores. The free key can be used directly in browser code. The service currently limits free accounts to 100 requests/day, so Tennis Edge refreshes live scores every 15 minutes only while the app is open.

### Setup
1. Get a free Live Tennis API key.
2. In Tennis Edge → Settings, paste the key and tap Save.
3. Tap Test.
4. Go to Live and refresh.

The key is stored only in your browser's localStorage. Do not use a paid API key in this static app.

## Install free with GitHub Pages
1. Create a GitHub repository called `tennis-edge`.
2. Upload every file from this folder.
3. Settings → Pages.
4. Deploy from branch → `main` → `/ (root)`.
5. Open the GitHub Pages URL on your phone.
6. iPhone: Safari → Share → Add to Home Screen.
7. Android: Chrome → menu → Install app / Add to Home screen.

## Important limitations
- Free live-score access does not include detailed in-play serve/break statistics, so those remain manual.
- Browser notifications from a static PWA are dependable while the app is open. True background push notifications would require a server/push service.
- Model probabilities are estimates, not guarantees or sportsbook odds.
