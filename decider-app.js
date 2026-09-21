/* Scanner UI and persistence. Match data and odds snapshots stay separate. */
const OddsProvider = {
  name:"manual",
  get(matchId){ return STORE.get("te3-odds",{})[String(matchId)] || {}; },
  save(matchId,stage,values){
    const all=STORE.get("te3-odds",{}), id=String(matchId);
    const existing=all[id] || {};
    if(existing[stage]) throw new Error("This odds snapshot is already frozen.");
    all[id]={...existing,[stage]:{...values,at:Date.now(),source:this.name}};
    STORE.set("te3-odds",all);
  },
  snapshots(matchId){
    const s=this.get(matchId);
    return {preMatchFavOdds:s.pre?.favouriteOdds,afterSet1FavOdds:s.afterSet1?.favouriteOdds,
      startSet3FavOdds:s.startSet3?.favouriteOdds,earlySet3FavOdds:s.earlySet3?.favouriteOdds,
      underdogOdds:s.startSet3?.underdogOdds};
  }
};
const deciderStore = () => STORE.get("te3-decider",{frozen:{},signals:{},filters:{maxSet3FavOdds:1.60,minSnapbackRecoveryPct:80,betterRankingRequired:true,betterSurfaceEloRequired:false}});
const saveDecider = d => STORE.set("te3-decider",d);
const deciderMatchId = m => String(m?.id ?? canonicalMatchKey(m));
const rankFor = (m,index) => {
  const player=m?.players?.[`p${index}`];
  if(Number(player?.rank)>0) return Number(player.rank);
  const list=STORE.get("te3-rankings",[]);
  const hit=list.find(r=>(player?.id && String(r.id)===String(player.id)) || norm(r.name)===norm(player?.name));
  return hit?.rank ?? null;
};
async function refreshRankings(force=false){
  const old=STORE.get("te3-rankings-updated",0);
  if(!force && Date.now()-old<24*3600000) return;
  try{const rows=await TennisDataProvider.rankings(getApiKey());if(rows.length){STORE.set("te3-rankings",rows);STORE.set("te3-rankings-updated",Date.now());}}
  catch(err){setSourceError(`Rankings: ${err.message||String(err)}`);}
}
function freezeDecider(match,index,odds){
  const id=deciderMatchId(match), d=deciderStore();
  if(d.frozen[id]) return;
  if(matchStartDate(match) && matchStartDate(match).getTime()<Date.now()) throw new Error("Pre-match favourite must be frozen before the scheduled start.");
  const o=Decider.validOdds(odds);
  if(!o) throw new Error("Enter valid decimal favourite odds above 1.00.");
  const name=pName(match,index), opponent=pName(match,3-index);
  OddsProvider.save(id,"pre",{favouriteOdds:o});
  d.frozen[id]={id,index,name,opponent,playerA:pName(match,1),playerB:pName(match,2),tournament:tournamentName(match),
    surface:mSurface(match),scheduled:matchStartRaw(match),frozenAt:Date.now(),source:"manual pre-match selection"};
  saveDecider(d);renderDecider();
}
function rankAndElo(match,frozen){
  const fr=rankFor(match,frozen.index), or=rankFor(match,3-frozen.index);
  const f=playerMetrics(frozen.name,frozen.surface),o=playerMetrics(frozen.opponent,frozen.surface);
  return {ranking:fr!=null && or!=null?or-fr:null,surfaceElo:f&&o?f.surfElo-o.surfElo:null,
    favRank:fr,oppRank:or};
}
function scanDeciders(matches){
  const d=deciderStore();let changed=false;
  for(const m of matches){
    const id=deciderMatchId(m),frozen=d.frozen[id];if(!frozen)continue;
    const phase=Decider.stage(m,frozen.index);
    const measures=rankAndElo(m,frozen);
    const result=Decider.evaluate({match:m,frozen,snapshots:OddsProvider.snapshots(id),ranking:measures.ranking,
      surfaceElo:measures.surfaceElo,filters:d.filters});
    if(phase==="DECIDER" && !d.signals[id]){
      const s=OddsProvider.snapshots(id);
      d.signals[id]={id,favourite:frozen.name,underdog:frozen.opponent,tournament:frozen.tournament,surface:frozen.surface,
        set2Score:(m.score?.games?.[0]?.[1] ?? "?")+"-"+(m.score?.games?.[1]?.[1] ?? "?"),
        rankingDifference:measures.ranking,surfaceEloDifference:measures.surfaceElo,
        favouriteOdds:s.startSet3FavOdds??null,underdogOdds:s.underdogOdds??null,
        snapbackRecoveryPct:result.snapbackRecoveryPct??null,distanceFromOpenPct:result.distanceFromOpenPct??null,
        snapbackBucket:Decider.bucket(result.snapbackRecoveryPct,[50,80,100]),
        favouriteOddsBucket:Decider.bucket(s.startSet3FavOdds,[1.4,1.6,1.8,2]),
        state:result.state,createdAt:Date.now(),result:null};
      changed=true;
      if("Notification" in window && Notification.permission==="granted")
        new Notification("Tennis Edge: deciding set",{body:`${frozen.name} won Set 2. ${result.state}.`});
    }else if(d.signals[id] && d.signals[id].result==null){
      d.signals[id].state=result.state;changed=true;
    }
  }
  if(changed)saveDecider(d);
  renderDecider();
}
function gradeDeciders(completed){
  const d=deciderStore();let changed=false;
  for(const m of completed){
    const id=deciderMatchId(m),s=d.signals[id];if(!s||s.result)continue;
    const winner=m?.winner?.name;if(!winner)continue;
    s.result=norm(winner)===norm(s.underdog)?"win":"loss";
    s.winner=winner;s.state="COMPLETED";s.gradedAt=Date.now();changed=true;
  }
  if(changed)saveDecider(d);
  renderDecider();
}
const fmt = n => n==null || !Number.isFinite(n)?"—":Number(n).toFixed(1);
function renderDecider(){
  const d=deciderStore(),byId=new Map();
  for(const m of [...(STORE.get("te3-upcoming-cache",null)?.data||[]),...(STORE.get("te3-live-cache",null)?.data||[])])byId.set(deciderMatchId(m),m);
  const matches=[...byId.values()];
  const stats=Decider.summary(Object.values(d.signals));
  for(const [id,value] of Object.entries({deciderSignals:stats.signals,deciderRecord:`${stats.wins}-${stats.losses}`,
    deciderHitRate:stats.hitRate==null?"—":`${fmt(stats.hitRate)}%`,deciderAvgOdds:fmt(stats.averageUnderdogOdds),
    deciderProfit:stats.unitsProfit==null?"—":`${fmt(stats.unitsProfit)}u`,deciderRoi:stats.roi==null?"—":`${fmt(stats.roi)}%`})){
    if($(id))$(id).textContent=value;
  }
  const board=$("deciderBoard");if(!board)return;
  board.innerHTML=matches.length?matches.map(m=>{
    const id=deciderMatchId(m),f=d.frozen[id],s=OddsProvider.get(id),phase=f?Decider.stage(m,f.index):"NONE";
    const live=(STORE.get("te3-live-cache",null)?.data||[]).some(x=>deciderMatchId(x)===id);
    const measures=f?rankAndElo(m,f):null;
    const verdict=f?Decider.evaluate({match:m,frozen:f,snapshots:OddsProvider.snapshots(id),ranking:measures.ranking,surfaceElo:measures.surfaceElo,filters:d.filters}):null;
    let actions="";
    if(!f && !live) actions=`<div class="decider-inputs"><select data-role="fav" aria-label="Original favourite"><option value="1">${esc(pName(m,1))}</option><option value="2">${esc(pName(m,2))}</option></select><input data-role="pre" type="number" step="0.01" min="1.01" placeholder="Pre-match favourite odds"><button class="small-btn decider-freeze" data-id="${esc(id)}">Freeze favourite</button></div>`;
    const first=completedSet(m,0),second=completedSet(m,1);
    const afterFirstWindow=!!f && first?.winner===3-f.index && !second;
    const thirdGames=(Number(m.score?.games?.[0]?.[2])||0)+(Number(m.score?.games?.[1]?.[2])||0);
    if(f && live && afterFirstWindow && !s.afterSet1) actions=`<div class="decider-inputs"><input data-role="after1" type="number" step="0.01" min="1.01" placeholder="Favourite odds after Set 1"><button class="small-btn decider-after1" data-id="${esc(id)}">Save Set 1 price</button></div>`;
    if(f && live && phase==="DECIDER" && thirdGames<=1 && !s.startSet3) actions=`<div class="decider-inputs"><input data-role="set3fav" type="number" step="0.01" min="1.01" placeholder="Set 3 favourite odds"><input data-role="set3dog" type="number" step="0.01" min="1.01" placeholder="Set 3 underdog odds"><button class="small-btn decider-set3" data-id="${esc(id)}">Save Set 3 prices</button></div>`;
    if(f && live && phase==="DECIDER" && thirdGames>0 && (s.startSet3 || thirdGames>1) && !s.earlySet3) actions=`<div class="decider-inputs"><input data-role="early3" type="number" step="0.01" min="1.01" placeholder="Optional early Set 3 favourite odds"><button class="small-btn decider-early3" data-id="${esc(id)}">Save early price</button></div>`;
    return `<div class="match-card decider-card" data-match="${esc(id)}"><div class="match-top"><div><div class="match-title">${esc(pName(m,1))} vs ${esc(pName(m,2))}</div><div class="match-meta">${esc(tournamentName(m))} · ${esc(mSurface(m))} · ${esc(live?scoreText(m):formatMatchTime(m))}</div></div><span class="badge ${verdict?.state==="STRONG"?"strong":verdict?.state==="PASS"?"pass":"watch"}">${esc(verdict?.state||"PRE-MATCH")}</span></div><p class="muted small">${esc(verdict?.reason||"Freeze the original favourite before play.")}</p>${f?`<div class="match-meta">Frozen favourite: ${esc(f.name)} · rank edge ${measures?.ranking??"?"} · surface Elo edge ${measures?.surfaceElo??"?"} · snapback ${fmt(verdict?.snapbackRecoveryPct)}% · distance from open ${fmt(verdict?.distanceFromOpenPct)}%</div>`:""}${actions}</div>`;
  }).join(""):'<div class="empty card">Load WTA matches to scan deciding-set setups.</div>';
  const log=$("deciderLog");
  log.innerHTML=Object.values(d.signals).sort((a,b)=>b.createdAt-a.createdAt).map(s=>`<div class="match-card"><div class="match-top"><div><div class="match-title">${esc(s.favourite)} vs ${esc(s.underdog)}</div><div class="match-meta">${esc(s.tournament)} · ${esc(s.surface)} · Set 2 ${esc(s.set2Score)} · rank edge ${s.rankingDifference??"?"} · surface Elo edge ${s.surfaceEloDifference??"?"}</div></div><span class="badge ${s.result==="win"?"strong":s.result==="loss"?"pass":"watch"}">${esc(s.state)}</span></div><div class="match-meta">Snapback ${fmt(s.snapbackRecoveryPct)}% (${esc(s.snapbackBucket)}) · favourite odds ${s.favouriteOdds??"?"} (${esc(s.favouriteOddsBucket)}) · underdog odds ${s.underdogOdds??"?"} · ${s.result||"pending"}</div></div>`).join("")||'<div class="empty card">No deciding-set signals recorded yet.</div>';
}
$("deciderBoard").onclick=e=>{
  const button=e.target.closest("button[data-id]");if(!button)return;
  const card=button.closest(".decider-card"),id=button.dataset.id;
  const match=[...(STORE.get("te3-upcoming-cache",null)?.data||[]),...(STORE.get("te3-live-cache",null)?.data||[])].find(m=>deciderMatchId(m)===id);
  if(!match)return;
  const value=role=>card.querySelector(`[data-role="${role}"]`)?.value;
  try{
    if(button.classList.contains("decider-freeze")) freezeDecider(match,Number(value("fav")),value("pre"));
    else if(button.classList.contains("decider-after1")) {const odds=Decider.validOdds(value("after1"));if(!odds)throw new Error("Enter valid decimal odds.");OddsProvider.save(id,"afterSet1",{favouriteOdds:odds});scanDeciders([match]);}
    else if(button.classList.contains("decider-set3")) {const fav=Decider.validOdds(value("set3fav")),dog=Decider.validOdds(value("set3dog"));if(!fav||!dog)throw new Error("Enter both valid decimal prices.");OddsProvider.save(id,"startSet3",{favouriteOdds:fav,underdogOdds:dog});scanDeciders([match]);}
    else if(button.classList.contains("decider-early3")) {const odds=Decider.validOdds(value("early3"));if(!odds)throw new Error("Enter valid decimal odds.");OddsProvider.save(id,"earlySet3",{favouriteOdds:odds});renderDecider();}
  }catch(err){alert(err.message||String(err));}
};
$("saveDeciderFilters").onclick=()=>{
  const d=deciderStore();
  d.filters={maxSet3FavOdds:Number($("maxSet3Odds").value),minSnapbackRecoveryPct:Number($("minSnapback").value),
    betterRankingRequired:$("betterRanking").checked,betterSurfaceEloRequired:$("betterSurfaceElo").checked};
  if(!Number.isFinite(d.filters.maxSet3FavOdds)||d.filters.maxSet3FavOdds<=1||!Number.isFinite(d.filters.minSnapbackRecoveryPct))return alert("Enter valid filter values.");
  saveDecider(d);scanDeciders(STORE.get("te3-live-cache",null)?.data||[]);
};
$("maxSet3Odds").value=deciderStore().filters.maxSet3FavOdds;
$("minSnapback").value=deciderStore().filters.minSnapbackRecoveryPct;
$("betterRanking").checked=deciderStore().filters.betterRankingRequired;
$("betterSurfaceElo").checked=deciderStore().filters.betterSurfaceEloRequired;
renderDecider();
