/* Pure Decider Scanner rules. Odds are supplied independently of tennis data. */
const Decider = (() => {
  const validOdds = value => { const n=Number(value); return Number.isFinite(n) && n>1 ? n : null; };
  const implied = value => { const n=validOdds(value); return n ? 1/n : null; };
  const metrics = snapshots => {
    const p0=implied(snapshots?.preMatchFavOdds), p1=implied(snapshots?.afterSet1FavOdds), p2=implied(snapshots?.startSet3FavOdds);
    const denominator=p0==null || p1==null ? null : p0-p1;
    const snapbackRecoveryPct=denominator != null && denominator>0 && p2!=null ? (p2-p1)/denominator*100 : null;
    const open=validOdds(snapshots?.preMatchFavOdds), set3=validOdds(snapshots?.startSet3FavOdds);
    const distanceFromOpenPct=open && set3 ? Math.abs(set3-open)/open*100 : null;
    return {p0,p1,p2,snapbackRecoveryPct,distanceFromOpenPct};
  };
  const set = (games,index) => {
    const a=Number(games?.[0]?.[index]), b=Number(games?.[1]?.[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const done=(Math.max(a,b)>=6 && Math.abs(a-b)>=2) || (Math.max(a,b)===7 && Math.min(a,b)>=5);
    return done ? {a,b,winner:a>b?1:2} : null;
  };
  const stage = (match,favouriteIndex) => {
    const g=match?.score?.games || [[],[]];
    const first=set(g,0), second=set(g,1);
    if (!first || first.winner===favouriteIndex) return "NONE";
    if (!second) {
      const f=Number(g?.[favouriteIndex-1]?.[1]), o=Number(g?.[2-favouriteIndex]?.[1]);
      return Number.isFinite(f) && Number.isFinite(o) && f>=3 && f>=o-1 ? "SETUP FORMING" : "NONE";
    }
    return second.winner===favouriteIndex ? "DECIDER" : "NONE";
  };
  const evaluate = ({match, frozen, snapshots, ranking, surfaceElo, filters}) => {
    if (!frozen) return {state:"PASS",reason:"Original favourite was not frozen before play."};
    const phase=stage(match,frozen.index);
    if (phase==="NONE") return {state:"PASS",reason:"Decider setup has not formed."};
    if (phase==="SETUP FORMING") return {state:phase,reason:"Original favourite lost Set 1 and is competitive in Set 2."};
    const m=metrics(snapshots);
    if (m.snapbackRecoveryPct==null || !validOdds(snapshots?.startSet3FavOdds)) return {state:"WAITING FOR PRICE",reason:"Capture pre-match, after Set 1, and start Set 3 favourite odds.",...m};
    const failures=[]; const missing=[];
    if (snapshots.startSet3FavOdds>filters.maxSet3FavOdds) failures.push("Set 3 favourite odds exceed filter");
    if (m.snapbackRecoveryPct<filters.minSnapbackRecoveryPct) failures.push("Snapback below filter");
    if (filters.betterRankingRequired) {
      if (ranking==null) missing.push("ranking"); else if (ranking<=0) failures.push("Favourite ranking is not better");
    }
    if (filters.betterSurfaceEloRequired) {
      if (surfaceElo==null) missing.push("surface Elo"); else if (surfaceElo<=0) failures.push("Favourite surface Elo is not better");
    }
    if (failures.length) return {state:"PASS",reason:failures.join("; "),...m};
    if (missing.length) return {state:"WATCH",reason:`Missing ${missing.join(" and ")}.`,...m};
    return {state:"STRONG",reason:"Current research filters pass; profitability is unproven.",...m};
  };
  const bucket = (value, breaks) => value==null ? "unknown" : (breaks.find(b=>value<b) ?? `${breaks[breaks.length-1]}+`).toString();
  const summary = signals => {
    const graded=signals.filter(s=>s.result==="win"||s.result==="loss");
    const wins=graded.filter(s=>s.result==="win").length;
    const quoted=signals.filter(s=>validOdds(s.underdogOdds));
    const priced=graded.filter(s=>validOdds(s.underdogOdds));
    const profit=priced.reduce((n,s)=>n+(s.result==="win"?validOdds(s.underdogOdds)-1:-1),0);
    return {signals:signals.length,wins,losses:graded.length-wins,hitRate:graded.length?wins/graded.length*100:null,
      averageUnderdogOdds:quoted.length?quoted.reduce((n,s)=>n+validOdds(s.underdogOdds),0)/quoted.length:null,
      unitsProfit:priced.length?profit:null, roi:priced.length?profit/priced.length*100:null, priced:priced.length};
  };
  return {validOdds,metrics,stage,evaluate,bucket,summary};
})();
if (typeof module !== "undefined") module.exports = Decider;
