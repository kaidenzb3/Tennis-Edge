const $ = id => document.getElementById(id);
const API_BASE = "https://api.livetennisapi.com/api/public/v1";
const SACKMANN = "https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master";
const STORE = {
  get(k,d){try{return JSON.parse(localStorage.getItem(k)) ?? d}catch{return d}},
  set(k,v){localStorage.setItem(k,JSON.stringify(v))}
};
let settings=STORE.get("te2-settings",{strong:82,good:72,autoRefresh:true});
let history=STORE.get("te2-history",[]);
let modelCache={};
let liveTimer=null;

function nav(view){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $("view-"+view).classList.add("active");
}
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>nav(b.dataset.view));
document.querySelectorAll("[data-view-jump]").forEach(b=>b.onclick=()=>nav(b.dataset.viewJump));

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function norm(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim()}
function pct(n,d){return d?Math.round(n/d*100):0}
function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
function logistic(diff){return 1/(1+Math.pow(10,-diff/400))}
function nowLabel(){return new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}

function parseCSV(text){
  const rows=[]; let row=[],cell="",q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(c=='"'&&q&&n=='"'){cell+='"';i++}
    else if(c=='"'){q=!q}
    else if(c==','&&!q){row.push(cell);cell=""}
    else if((c=='\n'||c=='\r')&&!q){
      if(c=='\r'&&n=='\n')i++;
      row.push(cell); if(row.some(x=>x!==""))rows.push(row); row=[];cell="";
    } else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row)}
  if(!rows.length)return[];
  const h=rows.shift().map(x=>x.trim());
  return rows.map(r=>Object.fromEntries(h.map((k,i)=>[k,(r[i]??"").trim()])));
}

async function syncHistory(){
  $("syncHistoryBtn").textContent="Syncing…"; $("syncHistoryBtn").disabled=true;
  const year=new Date().getFullYear();
  const years=[year-2,year-1,year];
  let all=[];
  try{
    for(const y of years){
      const res=await fetch(`${SACKMANN}/wta_matches_${y}.csv`,{cache:"no-store"});
      if(!res.ok)continue;
      const rows=parseCSV(await res.text());
      all=all.concat(rows);
    }
    history=all.filter(r=>r.winner_name&&r.loser_name&&r.tourney_date);
    STORE.set("te2-history",history);
    STORE.set("te2-history-updated",Date.now());
    buildModelCache();
    renderHistoryStatus();
    $("syncHistoryBtn").textContent="Synced ✓";
  }catch(e){
    alert("Historical data sync failed. Try again when you have internet.");
    $("syncHistoryBtn").textContent="Retry";
  }finally{$("syncHistoryBtn").disabled=false;setTimeout(()=>$("syncHistoryBtn").textContent="Sync data",1800)}
}
$("syncHistoryBtn").onclick=syncHistory;

function buildModelCache(){
  modelCache={};
  const sorted=[...history].sort((a,b)=>Number(a.tourney_date)-Number(b.tourney_date)||Number(a.match_num)-Number(b.match_num));
  const elo={},surfElo={};
  const recent={};
  function ensure(name){if(elo[name]==null)elo[name]=1500;if(!surfElo[name])surfElo[name]={Hard:1500,Clay:1500,Grass:1500,Carpet:1500};if(!recent[name])recent[name]=[]}
  for(const r of sorted){
    const w=r.winner_name,l=r.loser_name,s=r.surface||"Hard"; ensure(w);ensure(l);
    const ew=logistic(elo[w]-elo[l]); const k=26;
    elo[w]+=k*(1-ew); elo[l]-=k*(1-ew);
    if(surfElo[w][s]==null)surfElo[w][s]=1500;if(surfElo[l][s]==null)surfElo[l][s]=1500;
    const es=logistic(surfElo[w][s]-surfElo[l][s]); const ks=32;
    surfElo[w][s]+=ks*(1-es); surfElo[l][s]-=ks*(1-es);
    recent[w].push({win:true,surface:s,date:r.tourney_date,score:r.score});
    recent[l].push({win:false,surface:s,date:r.tourney_date,score:r.score});
  }
  for(const name of Object.keys(elo))modelCache[norm(name)]={name,elo:Math.round(elo[name]),surfElo:Object.fromEntries(Object.entries(surfElo[name]).map(([k,v])=>[k,Math.round(v)])),recent:recent[name]};
}

function findPlayer(name){
  const n=norm(name); if(!n)return null;
  if(modelCache[n])return modelCache[n];
  const keys=Object.keys(modelCache);
  let candidates=keys.filter(k=>k===n||k.endsWith(" "+n)||n.endsWith(" "+k));
  if(candidates.length===1)return modelCache[candidates[0]];
  const tokens=n.split(" "); const last=tokens[tokens.length-1];
  candidates=keys.filter(k=>k.split(" ").pop()===last);
  return candidates.length===1?modelCache[candidates[0]]:null;
}

function playerMetrics(name,surface="Hard"){
  const p=findPlayer(name); if(!p)return null;
  const rec=[...p.recent].sort((a,b)=>Number(b.date)-Number(a.date));
  const l10=rec.slice(0,10),s10=rec.filter(x=>x.surface===surface).slice(0,10);
  const three=rec.slice(0,10).filter(x=>{
    const sets=String(x.score||"").split(" ").filter(z=>/^\d/.test(z)); return sets.length>=3;
  }).length;
  return {name:p.name,elo:p.elo,surfElo:p.surfElo[surface]||1500,last10:l10.filter(x=>x.win).length,surface10:s10.filter(x=>x.win).length,threeSet:three,played10:l10.length,splayed:s10.length};
}

function prematchModel(a,b,surface){
  const A=playerMetrics(a,surface),B=playerMetrics(b,surface);
  if(!A||!B)return {error:"I couldn't match one or both players in the local historical data. Try full names or sync the data first."};
  const globalDiff=A.elo-B.elo,surfDiff=A.surfElo-B.surfElo;
  const formA=A.played10?pct(A.last10,A.played10):50, formB=B.played10?pct(B.last10,B.played10):50;
  const sA=A.splayed?pct(A.surface10,A.splayed):50,sB=B.splayed?pct(B.surface10,B.splayed):50;
  const blended=0.35*globalDiff+0.45*surfDiff+1.15*(formA-formB)+0.8*(sA-sB);
  const pA=clamp(logistic(blended),.08,.92), pB=1-pA;
  const fav=pA>=.5?A:B, opp=pA>=.5?B:A, winP=Math.max(pA,pB), diff=(pA>=.5?1:-1)*blended;
  const oppThree=opp.threeSet/Math.max(1,opp.played10),favThree=fav.threeSet/Math.max(1,fav.played10);
  let droppedSet=clamp(.24 + .22*oppThree + .14*favThree - .16*(winP-.5), .15,.55);
  let p21=winP*droppedSet, p20=winP-p21;
  let lean="PASS",grade=60;
  if(winP>=.78 && p20>p21*1.3){lean="2–0";grade=Math.round(65+winP*25)}
  else if(winP>=.62 && p21>=.20){lean="2–1";grade=Math.round(64+winP*22+Math.min(8,(oppThree+favThree)*7))}
  else if(winP>=.58){lean="ML";grade=Math.round(58+winP*22)}
  grade=clamp(grade,1,96);
  return {A,B,fav,opp,winP,p20,p21,lean,grade,eloEdge:Math.round((fav===A?1:-1)*globalDiff),surfaceEdge:Math.round((fav===A?1:-1)*surfDiff)};
}

function renderPrematch(m){
  if(m.error)return `<div class="result-card"><div class="result-title">No model result</div><p class="muted">${esc(m.error)}</p></div>`;
  const cls=m.grade>=settings.strong?"STRONG":m.grade>=settings.good?"GOOD":"WATCH";
  return `<div class="result-card">
    <div class="result-score">${m.grade}</div>
    <div class="result-title">${cls}: ${esc(m.fav.name)}</div>
    <div class="result-market">${esc(m.lean)} lean</div>
    <div class="prob-row">
      <div class="prob"><span>Match win</span><strong>${Math.round(m.winP*100)}%</strong></div>
      <div class="prob"><span>2–0 model</span><strong>${Math.round(m.p20*100)}%</strong></div>
      <div class="prob"><span>2–1 model</span><strong>${Math.round(m.p21*100)}%</strong></div>
    </div>
    <ul class="reason-list">
      <li>Tennis Edge Elo edge: ${m.eloEdge>=0?"+":""}${m.eloEdge}</li>
      <li>${esc($("preSurface").value)} Elo edge: ${m.surfaceEdge>=0?"+":""}${m.surfaceEdge}</li>
      <li>${esc(m.fav.name)} last 10: ${m.fav.last10}-${Math.max(0,m.fav.played10-m.fav.last10)}</li>
      <li>${esc(m.fav.name)} same-surface last 10: ${m.fav.surface10}-${Math.max(0,m.fav.splayed-m.fav.surface10)}</li>
      <li>Recent three-set frequency: ${m.fav.threeSet}/10 vs ${m.opp.threeSet}/10</li>
    </ul>
  </div>`;
}
$("prematchForm").onsubmit=e=>{e.preventDefault();const m=prematchModel($("preA").value,$("preB").value,$("preSurface").value);$("prematchResult").innerHTML=renderPrematch(m)};

function gradeLive(v){
  let score=48,reasons=[];
  if(v.elo>=120){score+=14;reasons.push(`Large Tennis Edge Elo advantage (+${v.elo}).`)}
  else if(v.elo>=80){score+=10;reasons.push(`Solid Elo advantage (+${v.elo}).`)}
  else if(v.elo>=40){score+=4}
  else if(v.elo<0){score-=14;reasons.push("The player is behind on Elo.");}
  if(v.last10>=8){score+=7;reasons.push(`Excellent recent form (${v.last10}/10 wins).`)}
  else if(v.last10>=6)score+=3;else if(v.last10<=4){score-=5;reasons.push("Recent form is weak.");}
  if(v.surface10>=8){score+=7;reasons.push("Excellent same-surface form.");}
  else if(v.surface10>=6)score+=3;else if(v.surface10<=4){score-=5;reasons.push("Surface form is weak.");}
  const margin=Math.abs(v.fg-v.og);
  if(v.lost){if(margin<=1){score+=10;reasons.push("Set 1 was extremely close.");}else if(margin===2){score+=6;reasons.push("Set 1 stayed competitive.");}else if(margin>=4){score-=13;reasons.push("Set 1 score suggests genuine domination.");}}
  if(v.first>=70){score+=8;reasons.push("First-serve points won stayed excellent.");}else if(v.first>=63){score+=4}else if(v.first<56){score-=10;reasons.push("First-serve points won is a red flag.");}
  if(v.second>=45)score+=4;else if(v.second<32){score-=8;reasons.push("Second serve is being punished.");}
  const bd=v.bpc-v.bpa;if(bd>=3){score+=12;reasons.push("Created much more break pressure.");}else if(bd>=1){score+=7;reasons.push("Created more break chances.");}else if(bd<=-3){score-=12;reasons.push("Opponent created far more break pressure.");}
  if(v.obpc>=80&&v.bpa<=4){score+=6;reasons.push("Opponent converted an unusually high share of limited break chances.");}
  if(v.phys==="bad"){score-=25;reasons.push("Physical concern overrides the statistical angle.");}else if(v.phys==="unknown")score-=4;
  score=clamp(Math.round(score),1,99);
  let tier=score>=settings.strong?"STRONG":score>=settings.good?"GOOD":score>=62?"WATCH":"PASS";
  let market=tier==="PASS"?"No bet":v.lost?`${v.fav} Set 2 ML`:`${v.fav} live ML`;
  return {score,tier,market,reasons};
}
$("analyzerForm").onsubmit=e=>{
  e.preventDefault();
  const v={fav:$("favName").value.trim(),opp:$("oppName").value.trim(),elo:+$("eloEdge").value,last10:+$("last10").value,surface10:+$("surface10").value,fg:+$("favGames").value,og:+$("oppGames").value,lost:$("lostSet").value==="yes",first:+$("firstWon").value,second:+$("secondWon").value,bpc:+$("bpCreated").value,bpa:+$("bpConceded").value,obpc:+$("oppBpConv").value,phys:$("physical").value};
  const g=gradeLive(v);
  $("analysisResult").innerHTML=`<div class="result-card"><div class="result-score">${g.score}</div><div class="result-title">${g.tier==="STRONG"?"🔥 ":""}${g.tier}</div><div class="result-market">${esc(g.market)}</div><ul class="reason-list">${g.reasons.map(r=>`<li>${esc(r)}</li>`).join("")}</ul><button id="trackPlayBtn" class="primary-btn">Track this play</button></div>`;
  $("trackPlayBtn").onclick=()=>trackPlay({fav:v.fav,opp:v.opp,score:g.score,tier:g.tier,market:g.market,status:"pending",created:Date.now()});
};

function trackPlay(play){
  const arr=STORE.get("te2-results",[]);arr.unshift(play);STORE.set("te2-results",arr);renderResults();$("trackPlayBtn")&&($("trackPlayBtn").textContent="Tracked ✓");
}
function renderResults(){
  const arr=STORE.get("te2-results",[]),graded=arr.filter(x=>x.status==="win"||x.status==="loss"),wins=graded.filter(x=>x.status==="win").length;
  $("trackedCount").textContent=arr.length;$("winRate").textContent=graded.length?`${Math.round(wins/graded.length*100)}%`:"—";
  const strong=graded.filter(x=>x.tier==="STRONG"),sw=strong.filter(x=>x.status==="win").length;$("strongRecord").textContent=`${sw}-${strong.length-sw}`;
  const el=$("resultsList");el.innerHTML=arr.length?"":'<div class="empty card">No plays tracked yet.</div>';
  arr.forEach((x,i)=>{
    const d=document.createElement("div");d.className="match-card";d.innerHTML=`<div class="match-top"><div><div class="match-title">${esc(x.fav)} vs ${esc(x.opp)}</div><div class="match-meta">${esc(x.market)} · model ${x.score}</div></div><span class="badge ${x.tier==="STRONG"?"strong":x.tier==="GOOD"?"good":"watch"}">${esc(x.status.toUpperCase())}</span></div><div class="match-actions"><button class="small-btn" data-result="${i}:win">Win</button><button class="small-btn danger" data-result="${i}:loss">Loss</button><button class="small-btn" data-result="${i}:void">Void</button></div>`;el.appendChild(d)
  })
}
$("resultsList").onclick=e=>{if(!e.target.dataset.result)return;let[i,s]=e.target.dataset.result.split(":");const a=STORE.get("te2-results",[]);a[+i].status=s;STORE.set("te2-results",a);renderResults()};
$("clearResultsBtn").onclick=()=>{if(confirm("Clear tracked plays?")){STORE.set("te2-results",[]);renderResults()}};

function getApiKey(){return STORE.get("te2-api-key","")}
async function apiFetch(path){
  const key=getApiKey();if(!key)throw new Error("No API key saved.");
  const res=await fetch(API_BASE+path,{headers:{Authorization:`Bearer ${key}`}});
  if(res.status===401)throw new Error("API key was rejected.");
  if(res.status===429)throw new Error("Free daily request limit reached. Try again after reset.");
  if(res.status===403)throw new Error("That endpoint is not included on the free tier.");
  if(!res.ok)throw new Error(`API error ${res.status}`);
  return res.json();
}
function playerName(m,side){return m.players?.[side]?.name||m[side]?.name||m[side]||"Unknown"}
function matchSurface(m){let s=m.surface||"Hard";return s.charAt(0).toUpperCase()+s.slice(1).toLowerCase()}
function scoreText(m){
  const s=m.score;if(!s)return"";
  const g=s.games||[[],[]],sets=Math.max(g[0]?.length||0,g[1]?.length||0),parts=[];
  for(let i=0;i<sets;i++)if(g[0]?.[i]!=null&&g[1]?.[i]!=null)parts.push(`${g[0][i]}-${g[1][i]}`);
  if(s.points?.length)parts.push(`(${s.points[0]}-${s.points[1]})`);
  return parts.join(" ");
}
function completedFirstSet(m){
  const g=m.score?.games;if(!g||!g[0]?.length||!g[1]?.length)return null;
  const a=+g[0][0],b=+g[1][0];
  const done=(Math.max(a,b)>=6&&Math.abs(a-b)>=2)||Math.max(a,b)===7;
  return done?{a,b,winner:a>b?1:2}:null;
}
function preliminaryLive(m){
  const a=playerName(m,"p1"),b=playerName(m,"p2"),surface=matchSurface(m),set1=completedFirstSet(m);
  const pm=prematchModel(a,b,surface);
  if(pm.error||!set1)return null;
  const favIsP1=norm(pm.fav.name)===norm(findPlayer(a)?.name||a);
  const favLost=(favIsP1&&set1.winner===2)||(!favIsP1&&set1.winner===1);
  const fg=favIsP1?set1.a:set1.b,og=favIsP1?set1.b:set1.a;
  let score=pm.grade;
  if(favLost){const mar=Math.abs(fg-og);score+=mar<=1?8:mar===2?4:-10}
  else score-=8;
  score=clamp(score,1,96);
  return {...pm,score,favLost,fg,og};
}
function matchCard(m,live=true){
  const a=playerName(m,"p1"),b=playerName(m,"p2"),surface=matchSurface(m),pm=prematchModel(a,b,surface),pre=live?preliminaryLive(m):pm;
  let grade=pre?.score??pm?.grade??0,tier=grade>=settings.strong?"strong":grade>=settings.good?"good":grade>=62?"watch":"pass",lab=grade?`${tier.toUpperCase()} ${grade}`:"NO DATA";
  let metrics="";
  if(!pm.error){
    metrics=`<div class="edge-grid"><div class="edge-chip"><span>Favourite</span><strong>${esc(pm.fav.name)}</strong></div><div class="edge-chip"><span>Elo edge</span><strong>+${pm.eloEdge}</strong></div><div class="edge-chip"><span>Lean</span><strong>${esc(pm.lean)}</strong></div></div>`;
  }
  const server=m.score?.server;let aDisp=esc(a),bDisp=esc(b);if(server===1)aDisp=`<span class="server">●</span> ${aDisp}`;if(server===2)bDisp=`<span class="server">●</span> ${bDisp}`;
  return `<div class="match-card" data-id="${m.id||""}">
    <div class="match-top"><div><div class="match-title">${aDisp} vs ${bDisp}</div><div class="match-meta">${esc(m.tournament||"WTA")} · ${esc(surface)} · ${esc(m.round||"")}</div></div><span class="badge ${tier}">${lab}</span></div>
    ${live?`<div class="scoreline">${esc(scoreText(m)||"Live")}</div>`:""}
    ${metrics}
    <div class="match-actions"><button class="small-btn analyze-match" data-a="${esc(a)}" data-b="${esc(b)}" data-s="${esc(surface)}" data-fav="${!pm.error?esc(pm.fav.name):""}">Open analyzer</button></div>
  </div>`;
}
function bindAnalyzeButtons(){
  document.querySelectorAll(".analyze-match").forEach(btn=>btn.onclick=()=>{
    const a=btn.dataset.a,b=btn.dataset.b,s=btn.dataset.s;
    const pm=prematchModel(a,b,s);
    const fav=pm.error?(btn.dataset.fav||a):pm.fav.name,opp=norm(fav)===norm(a)?b:a;
    $("favName").value=fav;$("oppName").value=opp;
    if(!pm.error){
      $("eloEdge").value=pm.eloEdge;$("last10").value=pm.fav.last10;$("surface10").value=pm.fav.surface10;
    }
    nav("analyzer");
  })
}
let notified=new Set(STORE.get("te2-notified",[]));
function maybeNotify(matches){
  if(Notification.permission!=="granted")return;
  for(const m of matches){
    const p=preliminaryLive(m);if(!p||!p.favLost||p.score<settings.strong||notified.has(String(m.id)))continue;
    new Notification("Tennis Edge: live setup",{body:`${p.fav.name} lost a close Set 1. Preliminary edge ${p.score}. Open the analyzer.`});
    notified.add(String(m.id));STORE.set("te2-notified",[...notified].slice(-100));
  }
}
async function refreshLive(){
  $("refreshLiveBtn").textContent="Loading…";$("refreshLiveBtn").disabled=true;
  try{
    const j=await apiFetch("/matches?status=live&tour=wta&limit=100");
    const data=j.data||[];$("liveMatches").innerHTML=data.length?data.map(m=>matchCard(m,true)).join(""):'<div class="empty card">No WTA matches are live right now.</div>';
    $("liveUpdated").textContent=`Updated ${nowLabel()} · ${data.length} live`;
    STORE.set("te2-live-cache",{time:Date.now(),data});bindAnalyzeButtons();maybeNotify(data);setApiConnected(true);
  }catch(e){$("liveMatches").innerHTML=`<div class="empty card">${esc(e.message)}</div>`;setApiConnected(false)}
  finally{$("refreshLiveBtn").textContent="↻ Refresh";$("refreshLiveBtn").disabled=false}
}
$("refreshLiveBtn").onclick=refreshLive;

async function refreshUpcoming(){
  $("refreshUpcomingBtn").textContent="Loading…";$("refreshUpcomingBtn").disabled=true;
  try{
    const j=await apiFetch("/matches?status=upcoming&tour=wta&limit=100");
    const data=j.data||[];$("upcomingMatches").innerHTML=data.length?data.map(m=>matchCard(m,false)).join(""):'<div class="empty card">No upcoming WTA matches returned.</div>';
    STORE.set("te2-upcoming-cache",{time:Date.now(),data});bindAnalyzeButtons();setApiConnected(true);
  }catch(e){$("upcomingMatches").innerHTML=`<div class="empty card">${esc(e.message)}</div>`;setApiConnected(false)}
  finally{$("refreshUpcomingBtn").textContent="Load";$("refreshUpcomingBtn").disabled=false}
}
$("refreshUpcomingBtn").onclick=refreshUpcoming;

function setApiConnected(ok){$("apiDot").classList.toggle("on",ok);$("apiDot").classList.toggle("off",!ok);$("apiBanner").style.display=getApiKey()?"none":"flex"}
$("saveApiBtn").onclick=()=>{STORE.set("te2-api-key",$("apiKey").value.trim());setApiConnected(!!getApiKey());$("apiTestMsg").textContent="Saved on this device."};
$("testApiBtn").onclick=async()=>{STORE.set("te2-api-key",$("apiKey").value.trim());$("apiTestMsg").textContent="Testing…";try{await apiFetch("/matches?status=live&tour=wta&limit=1");$("apiTestMsg").textContent="Connected ✓";setApiConnected(true)}catch(e){$("apiTestMsg").textContent=e.message;setApiConnected(false)}};
$("notifyBtn").onclick=async()=>{if(!("Notification"in window)){alert("Notifications are not supported in this browser.");return}const p=await Notification.requestPermission();$("notifyBtn").textContent=p==="granted"?"Notifications enabled ✓":"Notifications blocked"};

function setupSettings(){
  $("apiKey").value=getApiKey();$("strongThreshold").value=settings.strong;$("goodThreshold").value=settings.good;$("autoRefresh").checked=settings.autoRefresh;$("heroThreshold").textContent=settings.strong+"+";setApiConnected(!!getApiKey());
}
$("saveSettingsBtn").onclick=()=>{settings={strong:+$("strongThreshold").value,good:+$("goodThreshold").value,autoRefresh:$("autoRefresh").checked};STORE.set("te2-settings",settings);$("heroThreshold").textContent=settings.strong+"+";configureTimer();alert("Settings saved.")};
function configureTimer(){if(liveTimer)clearInterval(liveTimer);if(settings.autoRefresh&&getApiKey())liveTimer=setInterval(refreshLive,15*60*1000)}

function renderHistoryStatus(){
  $("historyCount").textContent=history.length.toLocaleString();
  const t=STORE.get("te2-history-updated",0);$("historyUpdated").textContent=t?new Date(t).toLocaleString():"Never";
}
function loadCaches(){
  const live=STORE.get("te2-live-cache",null),up=STORE.get("te2-upcoming-cache",null);
  if(live?.data){$("liveMatches").innerHTML=live.data.map(m=>matchCard(m,true)).join("")||'<div class="empty card">No live matches in cache.</div>';$("liveUpdated").textContent=`Cached ${new Date(live.time).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}`;}
  if(up?.data)$("upcomingMatches").innerHTML=up.data.map(m=>matchCard(m,false)).join("")||'<div class="empty card">No upcoming matches in cache.</div>';
  bindAnalyzeButtons();
}

let deferredPrompt;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").hidden=false});
$("installBtn").onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").hidden=true};
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js"));

buildModelCache();renderHistoryStatus();setupSettings();renderResults();loadCaches();configureTimer();
if(!history.length)setTimeout(syncHistory,700);
