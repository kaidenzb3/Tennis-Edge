/* Cito / tennisapi.dev adapter. App code only sees the normalized match shape. */
const TennisDataProvider = (() => {
  const base = "https://api.citoapi.com/api/v1/tennis";
  const list = value => Array.isArray(value) ? value :
    Array.isArray(value?.items) ? value.items :
    Array.isArray(value?.matches) ? value.matches :
    Array.isArray(value?.data?.matches) ? value.data.matches :
    Array.isArray(value?.data?.items) ? value.data.items :
    Array.isArray(value?.data) ? value.data : [];
  const name = p => typeof p === "string" ? p : p?.name || p?.full_name || p?.player_name || "";
  const number = v => v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  const pair = v => Array.isArray(v) ? [v[0] ?? null, v[1] ?? null] : [v?.player1 ?? v?.p1 ?? null, v?.player2 ?? v?.p2 ?? null];
  const dateNumber = value => {
    if (!value) return "";
    if (/^\d{8}$/.test(String(value))) return String(value);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0,10).replace(/-/g, "");
  };
  const singles = m => {
    const tour = String(m?.tour || m?.circuit || m?.tournament?.tour || "").toUpperCase();
    const draw = String(m?.draw || m?.draw_type || m?.event_type || m?.discipline || "").toLowerCase();
    const players = m?.players || [];
    return (tour === "WTA" || tour === "WOMEN" || tour === "WOMENS") &&
      !/(double|pair|mixed)/.test(draw) &&
      ![name(players[0]), name(players[1]), name(m?.player1), name(m?.player2)].some(x => x.includes("/"));
  };
  const score = m => {
    const source = m?.score && typeof m.score === "object" ? m.score : m;
    const sets = source?.sets || source?.set_scores || [];
    let games = [[], []];
    if (Array.isArray(sets) && Array.isArray(sets[0])) {
      games = [sets.map(s => number(s[0])), sets.map(s => number(s[1]))];
    } else if (Array.isArray(sets) && typeof sets[0] === "object") {
      games = [sets.map(s => number(s?.player1 ?? s?.p1 ?? s?.home)), sets.map(s => number(s?.player2 ?? s?.p2 ?? s?.away))];
    }
    const current = pair(source?.current_games || source?.games_current || source?.current_game_score);
    if (current.some(v => v != null) && games[0].length < 3 &&
        (games[0].length === 0 || Math.max(Number(games[0].at(-1)),Number(games[1].at(-1))) >= 6)) {
      games[0].push(number(current[0])); games[1].push(number(current[1]));
    }
    const points = pair(source?.points || source?.current_points || source?.point_score);
    const serverRaw = source?.serving ?? source?.server ?? null;
    const server = ["player1", "p1", "1", 1].includes(serverRaw) ? 1 : ["player2", "p2", "2", 2].includes(serverRaw) ? 2 : null;
    return { games, points, server };
  };
  const normalize = m => {
    const players = m?.players || [];
    const p1 = m?.player1 || m?.player_1 || players[0] || m?.home_player || m?.winner;
    const p2 = m?.player2 || m?.player_2 || players[1] || m?.away_player || m?.loser;
    const first = typeof p1 === "string" ? {name:p1} : p1 || {};
    const second = typeof p2 === "string" ? {name:p2} : p2 || {};
    const tournament = m?.tournament || m?.tournament_name || m?.competition || "WTA";
    const s = score(m);
    const winner = m?.winner || m?.winner_name || m?.result?.winner || null;
    return {
      id: m?.match_id ?? m?.id ?? null,
      players: {p1:{...first, name:name(first), rank:number(first?.rank ?? first?.ranking ?? m?.player1_rank), id:first?.id ?? first?.player_id},
                p2:{...second, name:name(second), rank:number(second?.rank ?? second?.ranking ?? m?.player2_rank), id:second?.id ?? second?.player_id}},
      tournament, surface:m?.surface || m?.tournament?.surface || "Hard", round:m?.round || "",
      scheduled_time:m?.scheduled_time || m?.start_time || m?.starts_at || m?.scheduled_at || null,
      event_date:m?.event_date || m?.date || null,
      score:s, winner: typeof winner === "string" ? {name:winner} : winner,
      status:m?.status || "", tour:m?.tour || m?.circuit || m?.tournament?.tour || "WTA",
      draw:m?.draw || m?.draw_type || "singles"
    };
  };
  const historical = m => ({
    winner_name:name(m?.winner) || m?.winner_name || "",
    loser_name:name(m?.loser) || m?.loser_name || "",
    surface:m?.surface || "Hard", tourney_date:dateNumber(m?.date || m?.match_date || m?.scheduled_time),
    match_num:m?.match_id || m?.id || "", score:typeof m?.score === "string" ? m.score : m?.scoreline || ""
  });
  const request = async (path, key) => {
    if (!key) throw new Error("Add your Cito / tennisapi.dev key in Settings.");
    const res = await fetch(base + path, {headers:{"x-api-key":key}, cache:"no-store"});
    if (res.status === 401 || res.status === 403) throw new Error("Cito key rejected or endpoint unavailable on your plan.");
    if (res.status === 429) throw new Error("Cito request limit reached.");
    if (!res.ok) throw new Error(`Cito API HTTP ${res.status}`);
    return res.json();
  };
  const live = async key => list(await request("/matches/live", key)).filter(singles).map(normalize);
  const recent = async key => list(await request("/matches/recent?tour=WTA", key)).filter(m=>singles({...m,tour:m?.tour||"WTA"})).map(normalize);
  const rankings = async key => list(await request("/rankings?tour=WTA", key)).map(r => ({
    id:r?.player_id || r?.player?.id, name:r?.player_name || name(r?.player), rank:number(r?.rank ?? r?.ranking)
  })).filter(r => r.name && r.rank);
  const upcoming = async (key, now = new Date()) => {
    const years = [...new Set([now.getUTCFullYear(), new Date(now.getTime()+14*86400000).getUTCFullYear()])];
    const calendars = await Promise.all(years.map(y => request(`/tournaments/calendar?year=${y}&tour=WTA`, key)));
    const windowEnd = now.getTime()+14*86400000;
    const events = calendars.flatMap(list).filter(t => {
      const tour = String(t?.tour || t?.circuit || "WTA").toUpperCase();
      const start = new Date(t?.start_date || t?.start || t?.date || 0).getTime();
      const end = new Date(t?.end_date || t?.end || t?.start_date || t?.start || 0).getTime();
      return tour === "WTA" && Number.isFinite(start) && start <= windowEnd && end >= now.getTime()-86400000;
    }).slice(0,12);
    const results = await Promise.allSettled(events.map(t => request(`/tournaments/${encodeURIComponent(t?.tournament_id ?? t?.id)}/schedule`, key)));
    const matches = results.flatMap((r,i) => r.status === "fulfilled" ? list(r.value).map(m => ({...m, tour:m?.tour||"WTA", tournament:m?.tournament || events[i]})) : []);
    return matches.filter(singles).filter(m => /schedul|upcoming|not.started|pending/i.test(String(m?.status || "upcoming"))).map(normalize);
  };
  const history = async (key, currentYear = new Date().getUTCFullYear()) => {
    const rows = [], seen = new Set();
    for (let year=currentYear-4; year<=currentYear; year++) {
      for (let page=1; page<=8; page++) {
        const result = await request(`/matches?tour=WTA&year=${year}&page=${page}&per_page=500`, key);
        const batch = list(result).filter(m=>singles({...m,tour:m?.tour||"WTA"})).map(historical).filter(r => r.winner_name && r.loser_name && r.tourney_date);
        for (const row of batch) {
          const id = `${row.tourney_date}|${row.match_num}|${row.winner_name}|${row.loser_name}`;
          if (!seen.has(id)) { seen.add(id); rows.push(row); }
        }
        const meta = result?.pagination || result?.meta || {};
        if (!list(result).length || page >= Number(meta.total_pages || meta.last_page || Infinity) || (!meta.total_pages && !meta.last_page && list(result).length < 500)) break;
      }
    }
    return rows;
  };
  return {request, list, normalize, singles, live, recent, rankings, upcoming, history};
})();
if (typeof module !== "undefined") module.exports = TennisDataProvider;
