# Tennis Edge v2.2

A mobile-first, installable WTA analysis PWA.

## v2.2 fixes

- Restored the historical sync functions that were accidentally broken in v2.1.
- Uses one shared PlayerDB for Live, Model and Analyzer.
- Historical WTA data now auto-syncs twice per day and recalculates Elo everywhere.
- Uses five recent seasons for more stable Elo ratings.
- Automatic Model Board now uses all cached Live + Upcoming WTA matches.
- Fixed the Live Tennis API score parser: free match objects expose `sets`, `games`, `points`, and `server` at the top level.
- Opening a live match in Analyzer now automatically fills:
  - player/opponent
  - surface
  - Elo edge
  - last 10
  - surface last 10
  - Set 1 games won/lost
  - whether the selected player won/lost Set 1
- Data not supplied by the free API is deliberately blank and highlighted **red** so you know exactly what must be entered manually.
- Current free-feed manual fields: 1st-serve points won, 2nd-serve points won, break points created/conceded, opponent break-point conversion, and physical/injury judgment.
- Blank manual fields are not silently scored as zero.

## v2.1 sync architecture

v2.1 introduces one shared PlayerDB used by **Live, Model, and Analyzer**.

- Overall Elo, surface Elo, Last 10, surface Last 10 and three-set rate are calculated once.
- All tabs read the same player profile.
- Finishing a historical sync immediately rebuilds the Live and Upcoming boards.
- Opening a live match sends the same synced profile into the Analyzer.
- Typing/selecting players in the Analyzer automatically fills Elo edge and form.
- Changing the Analyzer surface immediately swaps to the correct surface profile.
- Improved name matching supports common variants such as `Elena Rybakina`, `Rybakina, Elena`, and `E. Rybakina`.

## v2 features
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
