# Tennis Edge — basic site with Decider strategy

This restores the v2.6 Tennis Edge layout and its Live, Model, Analyzer, Results, and Settings sections. The added Decider tab works without an API key, paid plan, or local server. The existing Live Tennis API connection remains optional; if its key is rejected, the other screens and manual Decider tracking still work.

## Add a match

1. Open **Decider** and enter both players, the original pre-match favourite, and that favourite's decimal odds before play. This locks the baseline for the match.
2. Enter the set scores on the match card as the match progresses. The app shows **SETUP FORMING** when the original favourite has lost Set 1 and is competitive in Set 2.
3. After Set 1, enter the favourite's new odds. If the favourite wins Set 2, enter both players' odds at the start of Set 3. The app calculates snapback and flags the setup as **STRONG**, **WATCH**, **PASS**, or **WAITING FOR PRICE**.
4. Enter the final Set 3 score. The saved signal is graded for the underdog and included in the results summary.

The research filters start at maximum Set 3 favourite odds of 1.60, minimum snapback recovery of 80%, and better ranking required. You can change them in the Decider tab. They are research filters, not proven profitable rules.

All Decider entries and results are stored in this browser on this device. Back up the device's browser data if you want to preserve them long term. No bets are placed.

## Publishing

The files are a static site. Upload the contents of this folder to the root of the Tennis Edge GitHub repository when you approve replacing the current site. Upload every file, including `decider.js` and `decider-app.js`. The changed service worker cache name prompts installed copies to fetch this version. If a phone still shows an older installed version, close and reopen the app after the site updates.

## Files changed from v2.6

- `index.html`: adds the Decider tab and its simple match form and results summary.
- `app.js`: lets loaded live matches and completed results update Decider entries when the existing API works.
- `styles.css`: fits the sixth tab and Decider controls into the existing mobile design.
- `decider.js`, `decider-app.js`: detect the Set 1 loss → Set 2 win pattern, calculate snapback, save one signal per match, and grade it.
- `service-worker.js`, `manifest.webmanifest`: update the offline cache and app description.
- `decider.test.js`: checks core Decider rules.

The original v2.6 Model, Analyzer, Results, Settings, icons, and local Elo code are retained.
