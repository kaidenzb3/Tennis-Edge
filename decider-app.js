// Decider Scanner runs from manual match entries or the existing live feed.
const DeciderStore={
  read(){const value=STORE.get("te27-decider",{manual:[],frozen:{},odds:{},signals:{},filters:{maxSet3FavOdds:1.60,minSnapbackRecoveryPct:80,betterRankingRequired:true,betterSurfaceEloRequired:false}});value.watch ||= [];return value},
  write(value){STORE.set("te27-decider",value)}
};
const deciderId=m=>String(m?.id ?? canonicalMatchKey(m));
const deciderOdds=(state,id)=>{
  const o=state.odds[id]||{};
  return {preMatchFavOdds:o.pre?.favouriteOdds,afterSet1FavOdds:o.after1?.favouriteOdds,
    startSet3FavOdds:o.set3?.favouriteOdds,earlySet3FavOdds:o.early3?.favouriteOdds,
    underdogOdds:o.set3?.underdogOdds};
};
const deciderMatches=()=>{
  const state=DeciderStore.read(),all=new Map();
  for(const m of [...state.manual,...(STORE.get("te2-upcoming-cache",null)?.data||[]),...(STORE.get("te2-live-cache",null)?.data||[])]){
    if(!deciderManual(m)&&typeof SportScore!=="undefined"&&!SportScore.wta(m._sportscore||m))continue;
    all.set(deciderId(m),m);
  }
  return [...all.values()];
};
const deciderManual=m=>String(m?.id||"").startsWith("manual:");
const deciderRank=(m,index)=>{
  const state=DeciderStore.read(),f=state.frozen[deciderId(m)];
  if(!f)return null;
  if(f.ranks?.[index]!=null)return Number(f.ranks[index]);
  const p=pObj(m,index);const rank=Number(p?.rank??p?.ranking);
  return Number.isFinite(rank)&&rank>0?rank:null;
};
function deciderEdges(m,f){
  const favRank=deciderRank(m,f.index),oppRank=deciderRank(m,3-f.index);
  const surface=mSurface(m),a=playerMetrics(f.name,surface),b=playerMetrics(f.opponent,surface);
  return {ranking:favRank!=null&&oppRank!=null?oppRank-favRank:null,surfaceElo:a&&b?a.surfElo-b.surfElo:null};
}
function deciderFreeze(m,index,preOdds,ranks=null,source="manual"){
  const state=DeciderStore.read(),id=deciderId(m);
  if(state.frozen[id])throw new Error("Favourite already frozen for this match.");
  if(!deciderManual(m)&&matchStartDate(m)&&matchStartDate(m)<new Date())throw new Error("This match has passed its scheduled start.");
  const price=Decider.validOdds(preOdds);if(!price)throw new Error("Enter decimal odds above 1.00.");
  state.frozen[id]={id,index,name:pName(m,index),opponent:pName(m,3-index),surface:mSurface(m),
    tournament:tournamentName(m),frozenAt:Date.now(),ranks};
  state.odds[id]={pre:{favouriteOdds:price,at:Date.now(),source}};
  DeciderStore.write(state);deciderRender();
}
function deciderSaveOdds(id,stage,favouriteOdds,underdogOdds=null,source="manual"){
  const state=DeciderStore.read(),match=deciderMatches().find(m=>deciderId(m)===id),f=state.frozen[id];
  if(!match||!f)throw new Error("Match not found.");
  if(state.odds[id]?.[stage])throw new Error("This snapshot is already saved.");
  const price=Decider.validOdds(favouriteOdds);if(!price)throw new Error("Enter valid decimal favourite odds.");
  const phase=Decider.stage(match,f.index),set1=completedSet(match,0),set2=completedSet(match,1);
  if(stage==="after1"&&!(set1?.winner===3-f.index&&!set2))throw new Error("After-Set-1 window has passed.");
  if(stage==="set3"&&phase!=="DECIDER")throw new Error("Set 3 has not started.");
  const dog=stage==="set3"?Decider.validOdds(underdogOdds):null;
  if(stage==="set3"&&!dog)throw new Error("Enter valid underdog odds too.");
  state.odds[id]={...(state.odds[id]||{}),[stage]:{favouriteOdds:price,underdogOdds:dog,at:Date.now(),source}};
  DeciderStore.write(state);deciderScan([match]);
}
function deciderScan(matches){
  const state=DeciderStore.read();let changed=false;
  for(const m of matches){
    const id=deciderId(m),f=state.frozen[id];if(!f)continue;
    const edges=deciderEdges(m,f),snapshots=deciderOdds(state,id);
    const result=Decider.evaluate({match:m,frozen:f,snapshots,ranking:edges.ranking,surfaceElo:edges.surfaceElo,filters:state.filters});
    if(Decider.stage(m,f.index)==="DECIDER"){
      if(!state.signals[id]){
        state.signals[id]={id,favourite:f.name,underdog:f.opponent,tournament:f.tournament,surface:f.surface,
          set2Score:`${scoreObj(m).games?.[0]?.[1]??"?"}-${scoreObj(m).games?.[1]?.[1]??"?"}`,
          rankingDifference:edges.ranking,surfaceEloDifference:edges.surfaceElo,
          createdAt:Date.now(),result:null};
        if("Notification" in window&&Notification.permission==="granted")new Notification("Tennis Edge: Set 3",{body:`${f.name} won Set 2. Decider setup flagged.`});
      }
      const signal=state.signals[id];
      if(signal.result==null){
        Object.assign(signal,{state:result.state,snapbackRecoveryPct:result.snapbackRecoveryPct??null,
          distanceFromOpenPct:result.distanceFromOpenPct??null,favouriteOdds:snapshots.startSet3FavOdds??null,
          underdogOdds:snapshots.underdogOdds??null,
          snapbackBucket:Decider.bucket(result.snapbackRecoveryPct,[50,80,100]),
          favouriteOddsBucket:Decider.bucket(snapshots.startSet3FavOdds,[1.4,1.6,1.8,2])});
      }
      changed=true;
    }
  }
  if(changed)DeciderStore.write(state);
  deciderRender();
  for(const m of matches)deciderAutoFor(m);
}
function deciderGrade(matches){
  const state=DeciderStore.read();let changed=false;
  for(const m of matches){
    const signal=state.signals[deciderId(m)];if(!signal||signal.result)continue;
    const winner=m?.winner?.name||m?.winner_name||m?.result?.winner?.name;
    if(!winner)continue;
    signal.result=norm(winner)===norm(signal.underdog)?"win":"loss";
    signal.winner=winner;signal.state="COMPLETED";signal.gradedAt=Date.now();changed=true;
  }
  if(changed)DeciderStore.write(state);
  deciderRender();
}
function deciderManualWinner(m){
  const g=scoreObj(m).games,a=Number(g?.[0]?.[2]),b=Number(g?.[1]?.[2]);
  if(g?.[0]?.[2]==null||g?.[1]?.[2]==null)return null;
  if(!((Math.max(a,b)>=6&&Math.abs(a-b)>=2)||(Math.max(a,b)===7&&Math.min(a,b)===6)))return null;
  return pName(m,a>b?1:2);
}
const deciderFmt=n=>n==null||!Number.isFinite(n)?"—":Number(n).toFixed(1);
const oddsBusy=new Set();
window.rapidMode=typeof SportScore!=="undefined"&&!!SportScore.proxy();
function sportScorePreOdds(m){
  const a=Number(m?.main_odds?.outcome_1?.value),b=Number(m?.main_odds?.outcome_2?.value);
  if(!(a>1&&b>1)||a===b)return null;
  return a<b?{index:1,odds:a}:{index:2,odds:b};
}
function deciderObserveUpcoming(matches){
  const state=DeciderStore.read();let changed=false;
  for(const m of matches){
    const id=deciderId(m),q=sportScorePreOdds(m);if(state.frozen[id]||!q)continue;
    state.frozen[id]={id,index:q.index,name:pName(m,q.index),opponent:pName(m,3-q.index),surface:mSurface(m),tournament:tournamentName(m),frozenAt:Date.now(),ranks:null};
    state.odds[id]={pre:{favouriteOdds:q.odds,at:Date.now(),source:"SportScore pre-match"}};changed=true;
  }
  if(changed)DeciderStore.write(state);deciderRender();
}
window.rapidWatch=async m=>{const q=sportScorePreOdds(m);if(!q)throw new Error("No verified pre-match price is available for this match.");deciderFreeze(m,q.index,q.odds,null,"SportScore pre-match")};
async function deciderAutoOdds(m,stage){
  const id=deciderId(m),state=DeciderStore.read(),f=state.frozen[id];
  if(!OddsAuto.key()||!f||state.odds[id]?.[stage]||oddsBusy.has(`${id}:${stage}`))return;
  oddsBusy.add(`${id}:${stage}`);
  try{
    const quote=await OddsAuto.find(pName(m,1),pName(m,2),id,true);
    if(!quote)return;
    const fav=quote.players.find(p=>norm(p.name)===norm(f.name));
    const dog=quote.players.find(p=>norm(p.name)===norm(f.opponent));
    if(!fav||!dog)return;
    deciderSaveOdds(id,stage,fav.odds,stage==="set3"?dog.odds:null,`The Odds API: ${quote.bookmaker}`);
    $("oddsStatus").textContent=`Saved ${stage==="after1"?"Set 1":"Set 3"} odds from ${quote.bookmaker}. ${OddsAuto.remaining()??"?"} requests remain.`;
  }catch(err){$("oddsStatus").textContent=`Automatic price unavailable: ${err.message}`;}
  finally{oddsBusy.delete(`${id}:${stage}`)}
}
function deciderAutoFor(m){
  const state=DeciderStore.read(),id=deciderId(m),f=state.frozen[id];if(!f)return;
  const phase=Decider.stage(m,f.index),s=state.odds[id]||{};
  if(completedSet(m,0)?.winner===3-f.index&&!completedSet(m,1)&&!s.after1)deciderAutoOdds(m,"after1");
  if(phase==="DECIDER"&&!s.set3)deciderAutoOdds(m,"set3");
}
function deciderPrematchCandidate(m,f,edges,s){
  const fav=playerMetrics(f.name,mSurface(m)),opp=playerMetrics(f.opponent,mSurface(m));
  const overall=fav&&opp?fav.elo-opp.elo:null;
  const form=fav&&opp&&fav.played10&&opp.played10?(fav.last10/fav.played10)-(opp.last10/opp.played10):null;
  const price=Number(s?.pre?.favouriteOdds);
  const signals=[Number.isFinite(price)&&price<=1.80,overall!=null&&overall>0,edges.surfaceElo!=null&&edges.surfaceElo>0,form!=null&&form>=0];
  if(edges.ranking!=null)signals.push(edges.ranking>0);
  const score=signals.filter(Boolean).length,needed=edges.ranking==null?3:4;
  if(score>=needed)return {label:"GOOD CANDIDATE",reason:"Pre-match profile is worth monitoring if the favourite loses Set 1."};
  if(score>=2)return {label:"WATCHLIST",reason:"Some pre-match indicators fit. Wait for the Set 1 and Set 2 pattern."};
  return {label:"LOW PRIORITY",reason:"The available pre-match indicators are weaker for this research setup."};
}
function deciderModelCandidate(m){
  const model=prematchModel(pName(m,1),pName(m,2),mSurface(m));
  if(model.error)return {label:"LOW PRIORITY",reason:"No reliable Elo comparison is available for both players."};
  if(model.grade>=settings.good)return {label:"GOOD CANDIDATE",reason:`${model.fav.name} leads the pre-match Elo model (${model.grade}). Opening odds are still needed to freeze the true market favourite.`};
  return {label:"WATCHLIST",reason:`Pre-match Elo grade ${model.grade}. Wait for opening odds and the Set 1 loss → Set 2 recovery pattern.`};
}
function deciderRender(){
  const state=DeciderStore.read(),signals=Object.values(state.signals),stats=Decider.summary(signals);
  const summary={deciderSignals:stats.signals,deciderRecord:`${stats.wins}-${stats.losses}`,
    deciderHitRate:stats.hitRate==null?"—":`${deciderFmt(stats.hitRate)}%`,
    deciderAvgOdds:deciderFmt(stats.averageUnderdogOdds),
    deciderProfit:stats.unitsProfit==null?"—":`${deciderFmt(stats.unitsProfit)}u`,
    deciderRoi:stats.roi==null?"—":`${deciderFmt(stats.roi)}%`};
  for(const [id,value] of Object.entries(summary))$(id).textContent=value;
  const matches=deciderMatches();
  $("deciderBoard").innerHTML=matches.length?matches.map(m=>{
    const id=deciderId(m),f=state.frozen[id],manual=deciderManual(m),s=state.odds[id]||{};
    const phase=f?Decider.stage(m,f.index):"NONE",edges=f?deciderEdges(m,f):null;
    const verdict=f?Decider.evaluate({match:m,frozen:f,snapshots:deciderOdds(state,id),ranking:edges.ranking,
      surfaceElo:edges.surfaceElo,filters:state.filters}):null;
    const set1=f?completedSet(m,0):null,set2=f?completedSet(m,1):null;
    let action="";
    if(!f&&!manual){
      const isLive=(STORE.get("te2-live-cache",null)?.data||[]).some(x=>deciderId(x)===id);
      const quote=sportScorePreOdds(m);
      action=isLive?'<p class="muted small">The original pre-match favourite was not frozen before play.</p>':
        window.rapidMode?(quote?`<button class="small-btn" data-action="watch">Watch automatically</button>`:'<p class="muted small">Waiting for verified opening odds before freezing the market favourite.</p>'):
        `<div class="decider-inputs"><select data-role="fav"><option value="1">${esc(pName(m,1))}</option><option value="2">${esc(pName(m,2))}</option></select><input data-role="pre" type="number" step="0.01" min="1.01" placeholder="Pre-match favourite odds"><button class="small-btn" data-action="freeze">Freeze favourite</button></div>`;
    }
    if(f&&set1?.winner===3-f.index&&!set2&&!s.after1)action=window.rapidMode?'<p class="muted small">Waiting for automatic Set 1 price…</p>':`<div class="decider-inputs"><input data-role="after1" type="number" step="0.01" min="1.01" placeholder="Favourite odds after Set 1"><button class="small-btn" data-action="after1">Save Set 1 price</button></div>`;
    if(f&&phase==="DECIDER"&&!s.set3)action=window.rapidMode?'<p class="muted small">Waiting for automatic Set 3 price…</p>':`<div class="decider-inputs"><input data-role="set3fav" type="number" step="0.01" min="1.01" placeholder="Favourite odds at Set 3 start"><input data-role="set3dog" type="number" step="0.01" min="1.01" placeholder="Underdog odds at Set 3 start"><button class="small-btn" data-action="set3">Save Set 3 prices</button></div>`;
    if(f&&phase==="DECIDER"&&s.set3&&!s.early3&&!window.rapidMode)action=`<div class="decider-inputs"><input data-role="early3" type="number" step="0.01" min="1.01" placeholder="Optional early Set 3 favourite odds"><button class="small-btn" data-action="early3">Save early price</button></div>`;
    const games=scoreObj(m).games;
    const scoreInputs=manual?`<div class="decider-score-grid">${[0,1,2].map(i=>`<div class="decider-set"><span>Set ${i+1}</span><input data-score="a${i}" type="number" min="0" max="30" placeholder="A" value="${games?.[0]?.[i]??""}"><input data-score="b${i}" type="number" min="0" max="30" placeholder="B" value="${games?.[1]?.[i]??""}"></div>`).join("")}</div><button class="small-btn" data-action="score">Save score</button>`:"";
    const profile=f?playerMetrics(f.name,mSurface(m)):null;
    const opponent=f?playerMetrics(f.opponent,mSurface(m)):null;
    const prematch=m.status==="upcoming"?(f?deciderPrematchCandidate(m,f,edges,s):deciderModelCandidate(m)):null;
    const label=prematch?.label||verdict?.state||"PRE-MATCH";
    const reason=prematch?.reason||verdict?.reason||"";
    const p1Odds=Number(m?.main_odds?.outcome_1?.value),p2Odds=Number(m?.main_odds?.outcome_2?.value);
    const oddsText=p1Odds>1&&p2Odds>1?`${pName(m,1)} ${p1Odds.toFixed(2)} · ${pName(m,2)} ${p2Odds.toFixed(2)}`:`Favourite opening odds ${Number(s?.pre?.favouriteOdds)>1?Number(s.pre.favouriteOdds).toFixed(2):"unavailable"}`;
    const profileText=f?`<div class="match-meta">${esc(f.name)}: Elo ${profile?.elo??"?"}, surface Elo ${profile?.surfElo??"?"}, last 10 ${profile?`${profile.last10}/${profile.played10}`:"?"} · ${esc(f.opponent)}: Elo ${opponent?.elo??"?"}, surface Elo ${opponent?.surfElo??"?"}, last 10 ${opponent?`${opponent.last10}/${opponent.played10}`:"?"}</div>`:"";
    return `<div class="match-card decider-card" data-id="${esc(id)}"><div class="match-top"><div><div class="match-title">${esc(pName(m,1))} vs ${esc(pName(m,2))}</div><div class="match-meta">${esc(tournamentName(m))} · ${esc(mSurface(m))} · ${esc(manual?"Manual match":formatMatchTime(m))}</div></div><span class="badge ${label==="STRONG"?"strong":label==="GOOD CANDIDATE"?"good":label==="PASS"||label==="LOW PRIORITY"?"pass":"watch"}">${esc(label)}</span></div><div class="scoreline">${esc(scoreText(m)||"No score yet")}</div><div class="match-meta"><strong>Opening odds:</strong> ${esc(oddsText)}</div>${f?`<div class="match-meta">Frozen favourite: ${esc(f.name)} · rank edge ${edges.ranking??"?"} · surface Elo edge ${edges.surfaceElo??"?"} · snapback ${deciderFmt(verdict?.snapbackRecoveryPct)}% · distance from open ${deciderFmt(verdict?.distanceFromOpenPct)}%</div>${profileText}`:""}<p class="muted small">${esc(reason)}</p>${scoreInputs}${action}</div>`;
  }).join(""):'<div class="empty card">Add a match above, or load the Live board.</div>';
  $("deciderLog").innerHTML=signals.sort((a,b)=>b.createdAt-a.createdAt).map(s=>`<div class="match-card"><div class="match-top"><div><div class="match-title">${esc(s.favourite)} vs ${esc(s.underdog)}</div><div class="match-meta">${esc(s.tournament)} · ${esc(s.surface)} · Set 2 ${esc(s.set2Score)} · rank edge ${s.rankingDifference??"?"} · surface Elo edge ${s.surfaceEloDifference??"?"}</div></div><span class="badge ${s.result==="win"?"strong":s.result==="loss"?"pass":"watch"}">${esc(s.state)}</span></div><div class="match-meta">Snapback ${deciderFmt(s.snapbackRecoveryPct)}% (${esc(s.snapbackBucket)}) · favourite odds ${s.favouriteOdds??"?"} (${esc(s.favouriteOddsBucket)}) · underdog odds ${s.underdogOdds??"?"} · ${s.result||"pending"}</div></div>`).join("")||'<div class="empty card">No signals yet.</div>';
}
$("manualDeciderForm").onsubmit=async e=>{
  e.preventDefault();
  const a=$("manualA").value.trim(),b=$("manualB").value.trim();let index=Number($("manualFavourite").value);
  if(!a||!b||norm(a)===norm(b))return alert("Enter two different players.");
  const m={id:`manual:${Date.now()}:${Math.random().toString(36).slice(2,7)}`,players:{p1:{name:a},p2:{name:b}},
    tournament:$("manualTournament").value.trim()||"WTA",surface:$("manualSurface").value,score:{games:[[],[]],points:[null,null],server:null},status:"upcoming"};
  const rank=v=>v===""?null:Number(v);
  const ranks={1:index===1?rank($("manualFavRank").value):rank($("manualOppRank").value),
    2:index===2?rank($("manualFavRank").value):rank($("manualOppRank").value)};
  try{
    let price=$("manualPreOdds").value,source="manual";
    if(!price&&OddsAuto.key()){
      $("oddsStatus").textContent="Looking up pre-match odds…";
      const quote=await OddsAuto.find(a,b,m.id);
      if(!quote)throw new Error("Match-winner odds were not found. Enter the pre-match odds manually.");
      if(quote.commenceTime&&new Date(quote.commenceTime)<=new Date())throw new Error("This match has started; the original favourite cannot be frozen now.");
      const ordered=[...quote.players].sort((x,y)=>x.odds-y.odds);
      if(ordered[0].odds===ordered[1].odds)throw new Error("The prices are tied; choose the original favourite manually.");
      index=norm(ordered[0].name)===norm(a)?1:2;price=ordered[0].odds;source=`The Odds API: ${quote.bookmaker}`;
      $("oddsStatus").textContent=`Original favourite and odds saved from ${quote.bookmaker}. ${OddsAuto.remaining()??"?"} requests remain.`;
    }
    if(!price)throw new Error("Enter pre-match odds or save an Odds API key.");
    const state=DeciderStore.read();state.manual.unshift(m);DeciderStore.write(state);deciderFreeze(m,index,price,ranks,source);e.target.reset();
  }
  catch(err){alert(err.message||String(err));}
};
$("deciderBoard").onclick=e=>{
  const btn=e.target.closest("button[data-action]");if(!btn)return;
  const card=btn.closest(".decider-card"),id=card.dataset.id,m=deciderMatches().find(x=>deciderId(x)===id);
  if(!m)return;
  const value=role=>card.querySelector(`[data-role="${role}"]`)?.value;
  try{
    if(btn.dataset.action==="freeze")deciderFreeze(m,Number(value("fav")),value("pre"));
    if(btn.dataset.action==="watch" && typeof window.rapidWatch==="function")window.rapidWatch(m).catch(err=>alert(err.message||String(err)));
    if(btn.dataset.action==="after1")deciderSaveOdds(id,"after1",value("after1"));
    if(btn.dataset.action==="set3")deciderSaveOdds(id,"set3",value("set3fav"),value("set3dog"));
    if(btn.dataset.action==="early3")deciderSaveOdds(id,"early3",value("early3"));
    if(btn.dataset.action==="score"){
      const state=DeciderStore.read(),target=state.manual.find(x=>deciderId(x)===id);
      if(!target)throw new Error("Manual match not found.");
      const val=(side,i)=>{const raw=card.querySelector(`[data-score="${side}${i}"]`).value;return raw===""?null:Number(raw)};
      target.score={games:[[0,1,2].map(i=>val("a",i)),[0,1,2].map(i=>val("b",i))],points:[null,null],server:null};
      target.status="live";const winner=deciderManualWinner(target);
      if(winner){target.winner={name:winner};target.status="completed";}
      DeciderStore.write(state);deciderScan([target]);deciderAutoFor(target);if(winner)deciderGrade([target]);
    }
  }catch(err){alert(err.message||String(err));}
};
$("saveDeciderFilters").onclick=()=>{
  const state=DeciderStore.read(),max=Number($("maxSet3Odds").value),min=Number($("minSnapback").value);
  if(!Number.isFinite(max)||max<=1||!Number.isFinite(min)||min<0)return alert("Enter valid filters.");
  state.filters={maxSet3FavOdds:max,minSnapbackRecoveryPct:min,betterRankingRequired:$("betterRanking").checked,
    betterSurfaceEloRequired:$("betterSurfaceElo").checked};
  DeciderStore.write(state);deciderScan(deciderMatches());
};
const initialDecider=DeciderStore.read().filters;
$("maxSet3Odds").value=initialDecider.maxSet3FavOdds;
$("minSnapback").value=initialDecider.minSnapbackRecoveryPct;
$("betterRanking").checked=initialDecider.betterRankingRequired;
$("betterSurfaceElo").checked=initialDecider.betterSurfaceEloRequired;
deciderRender();
