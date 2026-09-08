const $ = id => document.getElementById(id);

const API_BASE = "https://api.livetennisapi.com/api/public/v1";
const HISTORICAL_SOURCE = "https://raw.githubusercontent.com/36-SURE/2026/main/data/wta_matches_2021_2026.csv";
const STORE = {
  get(k,d){ try { const v=localStorage.getItem(k); return v===null?d:JSON.parse(v); } catch { return d; } },
  set(k,v){ localStorage.setItem(k,JSON.stringify(v)); }
};

let settings = STORE.get("te2-settings",{strong:82,good:72,autoRefresh:true});
let history = STORE.get("te2-history",[]);
let modelCache = {};
let liveTimer = null;
let notified = new Set(STORE.get("te2-notified",[]));
let currentAnalyzerMatch = null;

// ---------- Utilities ----------
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function norm(s){
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9, ]/g," ").replace(/\s+/g," ").trim();
}
function pct(n,d){ return d ? Math.round((n/d)*100) : 0; }
function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
function logistic(diff){ return 1/(1+Math.pow(10,-diff/400)); }
function nowLabel(){ return new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}); }
function yyyy(){ return new Date().getFullYear(); }

function parseCSV(text){
  const rows=[]; let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], next=text[i+1];
    if(c === '"' && quoted && next === '"'){ cell+='"'; i++; }
    else if(c === '"'){ quoted=!quoted; }
    else if(c === "," && !quoted){ row.push(cell); cell=""; }
    else if((c === "\n" || c === "\r") && !quoted){
      if(c === "\r" && next === "\n") i++;
      row.push(cell);
      if(row.some(x=>x!=="")) rows.push(row);
      row=[]; cell="";
    } else cell+=c;
  }
  if(cell || row.length){ row.push(cell); rows.push(row); }
  if(!rows.length) return [];
  const headers=rows.shift().map(x=>x.trim());
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??"").trim()])));
}

function nav(view){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $("view-"+view)?.classList.add("active");
}
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>nav(b.dataset.view));
document.querySelectorAll("[data-view-jump]").forEach(b=>b.onclick=()=>nav(b.dataset.viewJump));

// ---------- One shared PlayerDB ----------
const PlayerDB = {
  profiles:new Map(),
  aliases:new Map(),

  key(name){ return norm(name); },

  nameForms(name){
    const raw=String(name||"").trim();
    if(!raw) return [];
    const out=new Set([this.key(raw)]);
    if(raw.includes(",")){
      const parts=raw.split(",").map(x=>x.trim()).filter(Boolean);
      if(parts.length>=2) out.add(this.key(parts.slice(1).join(" ")+" "+parts[0]));
    } else {
      const parts=raw.split(/\s+/).filter(Boolean);
      if(parts.length>=2){
        const first=parts[0], last=parts[parts.length-1];
        out.add(this.key(last+", "+parts.slice(0,-1).join(" ")));
        out.add(this.key(first[0]+". "+last));
        out.add(this.key(first[0]+" "+last));
      }
    }
    return [...out];
  },

  addAlias(alias,canonical){
    for(const f of this.nameForms(alias)){
      if(!this.aliases.has(f)) this.aliases.set(f,new Set());
      this.aliases.get(f).add(canonical);
    }
  },

  resolve(name){
    for(const f of this.nameForms(name)){
      if(this.profiles.has(f)) return this.profiles.get(f);
      const set=this.aliases.get(f);
      if(set && set.size===1) return this.profiles.get([...set][0])||null;
    }
    const tokens=norm(name).replace(/,/g," ").split(" ").filter(Boolean);
    const last=tokens[tokens.length-1];
    if(last){
      const c=[...this.profiles.values()].filter(p=>norm(p.name).split(" ").pop()===last);
      if(c.length===1) return c[0];
    }
    return null;
  },

  rebuild(rows){
    this.profiles.clear(); this.aliases.clear(); modelCache={};
    const sorted=[...rows].sort((a,b)=>Number(a.tourney_date)-Number(b.tourney_date)||Number(a.match_num)-Number(b.match_num));
    const elo={}, surfElo={}, recent={};

    const ensure=n=>{
      if(elo[n]==null) elo[n]=1500;
      if(!surfElo[n]) surfElo[n]={Hard:1500,Clay:1500,Grass:1500,Carpet:1500};
      if(!recent[n]) recent[n]=[];
    };

    for(const r of sorted){
      const w=r.winner_name,l=r.loser_name,s=r.surface||"Hard";
      if(!w||!l) continue;
      ensure(w); ensure(l);

      const expected=logistic(elo[w]-elo[l]), k=26;
      elo[w]+=k*(1-expected); elo[l]-=k*(1-expected);

      if(surfElo[w][s]==null) surfElo[w][s]=1500;
      if(surfElo[l][s]==null) surfElo[l][s]=1500;
      const se=logistic(surfElo[w][s]-surfElo[l][s]), sk=32;
      surfElo[w][s]+=sk*(1-se); surfElo[l][s]-=sk*(1-se);

      recent[w].push({win:true,surface:s,date:r.tourney_date,score:r.score});
      recent[l].push({win:false,surface:s,date:r.tourney_date,score:r.score});
    }

    for(const name of Object.keys(elo)){
      const key=this.key(name);
      const p={
        name,
        elo:Math.round(elo[name]),
        surfElo:Object.fromEntries(Object.entries(surfElo[name]).map(([s,v])=>[s,Math.round(v)])),
        recent:recent[name]
      };
      this.profiles.set(key,p);
      modelCache[key]=p;
      this.addAlias(name,key);
    }
    renderPlayerDatalist();
  }
};

function buildModelCache(){ PlayerDB.rebuild(history); renderHistoryStatus(); updateMatchedStatus(); }
function findPlayer(name){ return PlayerDB.resolve(name); }

function playerMetrics(name,surface="Hard"){
  const p=findPlayer(name);
  if(!p) return null;
  const rec=[...p.recent].sort((a,b)=>Number(b.date)-Number(a.date));
  const l10=rec.slice(0,10);
  const s10=rec.filter(x=>x.surface===surface).slice(0,10);
  const three=l10.filter(x=>String(x.score||"").split(" ").filter(z=>/^\d/.test(z)).length>=3).length;
  return {
    name:p.name,
    elo:p.elo,
    surfElo:p.surfElo[surface]??1500,
    last10:l10.filter(x=>x.win).length,
    surface10:s10.filter(x=>x.win).length,
    threeSet:three,
    played10:l10.length,
    splayed:s10.length
  };
}

function prematchModel(a,b,surface){
  const A=playerMetrics(a,surface), B=playerMetrics(b,surface);
  if(!A||!B){
    const missing=[];
    if(!A) missing.push(a||"Player A");
    if(!B) missing.push(b||"Player B");
    return {error:`No synced historical profile for: ${missing.join(", ")}.`};
  }

  const globalDiff=A.elo-B.elo;
  const surfDiff=A.surfElo-B.surfElo;
  const fA=A.played10?pct(A.last10,A.played10):50;
  const fB=B.played10?pct(B.last10,B.played10):50;
  const sA=A.splayed?pct(A.surface10,A.splayed):50;
  const sB=B.splayed?pct(B.surface10,B.splayed):50;
  const blended=.35*globalDiff+.45*surfDiff+1.15*(fA-fB)+.8*(sA-sB);

  const pA=clamp(logistic(blended),.08,.92), pB=1-pA;
  const fav=pA>=.5?A:B, opp=pA>=.5?B:A, winP=Math.max(pA,pB);
  const favThree=fav.threeSet/Math.max(1,fav.played10);
  const oppThree=opp.threeSet/Math.max(1,opp.played10);
  const drop=clamp(.24+.22*oppThree+.14*favThree-.16*(winP-.5),.15,.55);
  const p21=winP*drop, p20=winP-p21;

  let lean="PASS",grade=60;
  if(winP>=.78 && p20>p21*1.3){ lean="2–0"; grade=Math.round(65+winP*25); }
  else if(winP>=.62 && p21>=.20){ lean="2–1"; grade=Math.round(64+winP*22+Math.min(8,(oppThree+favThree)*7)); }
  else if(winP>=.58){ lean="ML"; grade=Math.round(58+winP*22); }
  grade=clamp(grade,1,96);

  const favIsA=fav===A;
  return {
    A,B,fav,opp,winP,p20,p21,lean,grade,
    eloEdge:Math.round((favIsA?1:-1)*globalDiff),
    surfaceEdge:Math.round((favIsA?1:-1)*surfDiff)
  };
}

// ---------- Historical sync ----------
async function syncHistory(force=false){
  const btn=$("syncHistoryBtn");
  if(btn){ btn.textContent="Syncing…"; btn.disabled=true; }
  setSourceStatus("history","loading");

  const last=STORE.get("te2-history-updated",0);
  if(!force && history.length && Date.now()-last < 12*60*60*1000){
    buildModelCache();
    refreshAllModelViews();
    setSourceStatus("history","ok");
    if(btn){ btn.textContent="Up to date ✓"; btn.disabled=false; setTimeout(()=>btn.textContent="Sync data",1200); }
    return;
  }

  try{
    const res=await fetch(`${HISTORICAL_SOURCE}?ts=${Date.now()}`,{cache:"no-store"});
    if(!res.ok) throw new Error(`Historical source HTTP ${res.status}`);

    const rows=parseCSV(await res.text());
    if(rows.length<5000) throw new Error(`Historical source returned only ${rows.length} rows`);

    // CRITICAL v2.4 FIX:
    // The raw CSV has ~50 columns and is too large for phone localStorage.
    // Keep only the six fields Tennis Edge actually needs for Elo/form.
    history=rows
      .filter(r=>r.winner_name&&r.loser_name&&r.tourney_date)
      .map(r=>({
        winner_name:r.winner_name,
        loser_name:r.loser_name,
        surface:r.surface||"Hard",
        tourney_date:r.tourney_date,
        match_num:r.match_num||"",
        score:r.score||""
      }));

    if(history.length<5000) throw new Error("Historical source parsed, but too few usable WTA matches remained.");

    // Persist only the compact version. This avoids Safari/Chrome quota failures.
    try{
      STORE.set("te2-history",history);
      STORE.set("te2-history-updated",Date.now());
    }catch(storageErr){
      // If an old oversized cache is blocking storage, wipe only Tennis Edge historical cache and retry.
      localStorage.removeItem("te2-history");
      localStorage.removeItem("te2-history-updated");
      STORE.set("te2-history",history);
      STORE.set("te2-history-updated",Date.now());
    }

    buildModelCache();
    refreshAllModelViews();
    setSourceStatus("history","ok");
    clearSourceError();

    if(btn){ btn.textContent="Synced ✓"; setTimeout(()=>btn.textContent="Sync data",1500); }
  }catch(err){
    console.error(err);
    setSourceStatus("history","bad");
    setSourceError((err && err.name ? err.name + ": " : "") + (err.message||String(err)));
    if(btn) btn.textContent="Sync failed";
    if(!history.length){
      $("modelBoard").innerHTML='<div class="empty card missing-list">Historical sync failed. Check Settings → Source status for the exact error.</div>';
    }
  }finally{
    if(btn) btn.disabled=false;
  }
}
$("syncHistoryBtn").onclick=()=>syncHistory(true);

// ---------- Shared profile UI ----------
function renderPlayerDatalist(){
  const dl=$("playerNames");
  if(!dl) return;
  dl.innerHTML=[...PlayerDB.profiles.values()].map(p=>p.name).sort().map(n=>`<option value="${esc(n)}"></option>`).join("");
}
function renderHistoryStatus(){
  $("historyCount").textContent=history.length.toLocaleString();
  if($("profileCount")) $("profileCount").textContent=PlayerDB.profiles.size.toLocaleString();
  const t=STORE.get("te2-history-updated",0);
  $("historyUpdated").textContent=t?new Date(t).toLocaleString():"Never";
}

function updateAnalyzerProfile(autoFill=true){
  const fav=$("favName").value.trim(), opp=$("oppName").value.trim(), surface=$("anSurface").value;
  const F=playerMetrics(fav,surface), O=playerMetrics(opp,surface);
  const strip=$("analyzerProfile");

  ["eloEdge","last10","surface10"].forEach(id=>$(id).classList.remove("auto-filled","needs-manual"));

  if(!F||!O){
    strip.innerHTML='<span class="missing-list">Historical player match failed — Elo/form fields are red because they need manual values.</span>';
    ["eloEdge","last10","surface10"].forEach(id=>$(id).classList.add("needs-manual"));
    return false;
  }

  const eloEdge=F.elo-O.elo, surfEdge=F.surfElo-O.surfElo;
  strip.innerHTML=`
    <div class="profile-item"><span>Overall Elo</span><strong>${F.elo}</strong></div>
    <div class="profile-item"><span>${esc(surface)} Elo</span><strong>${F.surfElo}</strong></div>
    <div class="profile-item"><span>Elo edge</span><strong>${eloEdge>=0?"+":""}${eloEdge}</strong></div>
    <div class="profile-item"><span>Last 10</span><strong>${F.last10}-${Math.max(0,F.played10-F.last10)}</strong></div>
    <div class="profile-item"><span>${esc(surface)} L10</span><strong>${F.surface10}-${Math.max(0,F.splayed-F.surface10)}</strong></div>
    <span class="synced-note">Synced · surface edge ${surfEdge>=0?"+":""}${surfEdge} vs ${esc(O.name)}</span>`;

  if(autoFill){
    $("eloEdge").value=eloEdge;
    $("last10").value=F.last10;
    $("surface10").value=F.surface10;
    ["eloEdge","last10","surface10"].forEach(id=>$(id).classList.add("auto-filled"));
  }
  return true;
}

// ---------- Match API normalization ----------
// The free API's match list exposes score as top-level sets/games/points/server.
// Older cached Tennis Edge builds stored it under `score`, so support both.
function scoreObj(m){
  const nested=m?.score && typeof m.score==="object" ? m.score : {};
  return {
    sets: m?.sets ?? nested.sets ?? [],
    games: m?.games ?? nested.games ?? [[],[]],
    points:m?.points ?? nested.points ?? [null,null],
    server:m?.server ?? nested.server ?? null,
    is_tiebreak:m?.is_tiebreak ?? nested.is_tiebreak ?? false,
    timestamp:m?.timestamp ?? nested.timestamp ?? null
  };
}
function pObj(m,n){
  return m?.players?.[`p${n}`]
      || m?.players?.[n-1]
      || m?.[`p${n}`]
      || m?.[`player${n}`]
      || m?.[`player_${n}`]
      || null;
}
function pName(m,n){
  const p=pObj(m,n);
  if(typeof p==="string") return p;
  return p?.name
      || p?.full_name
      || p?.player_name
      || m?.[`p${n}_name`]
      || m?.[`player${n}_name`]
      || m?.[`player_${n}_name`]
      || `Player ${n}`;
}
function pId(m,n){
  const p=pObj(m,n);
  return p?.id || p?.player_id || m?.[`p${n}_id`] || m?.[`player${n}_id`] || null;
}
function mSurface(m){
  let s=m?.surface || m?.tournament?.surface || "Hard";
  s=String(s);
  return s.charAt(0).toUpperCase()+s.slice(1).toLowerCase();
}
function tournamentName(m){
  return typeof m?.tournament==="string" ? m.tournament : (m?.tournament?.name || m?.tournament_name || "WTA");
}
function scoreText(m){
  const s=scoreObj(m), g=s.games;
  if(!Array.isArray(g)||!Array.isArray(g[0])||!Array.isArray(g[1])) return "";
  const parts=[];
  const n=Math.max(g[0].length,g[1].length);
  for(let i=0;i<n;i++){
    if(g[0][i]!=null && g[1][i]!=null) parts.push(`${g[0][i]}-${g[1][i]}`);
  }
  if(s.points?.[0]!=null && s.points?.[1]!=null) parts.push(`(${s.points[0]}-${s.points[1]})`);
  return parts.join(" ");
}
function completedSet(m,index=0){
  const g=scoreObj(m).games;
  if(!g?.[0]||!g?.[1]) return null;
  const a=Number(g[0][index]), b=Number(g[1][index]);
  if(Number.isNaN(a)||Number.isNaN(b)) return null;
  const done=(Math.max(a,b)>=6&&Math.abs(a-b)>=2)||Math.max(a,b)===7;
  return done?{a,b,winner:a>b?1:2}:null;
}
function currentSetIndex(m){
  const s=scoreObj(m),g=s.games;
  if(!g?.[0]||!g?.[1]) return 0;
  return Math.max(0,Math.max(g[0].length,g[1].length)-1);
}

// ---------- API ----------
function getApiKey(){ return STORE.get("te2-api-key",""); }
async function apiFetch(path){
  const key=getApiKey();
  if(!key) throw new Error("No API key saved.");

  let res;
  try{
    res=await fetch(API_BASE+path,{headers:{"X-API-Key":key},cache:"no-store"});
  }catch(_err){
    const join=path.includes("?")?"&":"?";
    res=await fetch(`${API_BASE}${path}${join}token=${encodeURIComponent(key)}`,{cache:"no-store"});
  }

  if(res.status===401) throw new Error("API key was rejected.");
  if(res.status===429) throw new Error("Free daily request limit reached.");
  if(res.status===403) throw new Error("This endpoint is not on the free tier.");
  if(!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
function unwrapMatches(j){
  if(Array.isArray(j)) return j;
  if(Array.isArray(j?.data)) return j.data;
  if(Array.isArray(j?.matches)) return j.matches;
  if(Array.isArray(j?.results)) return j.results;
  return [];
}

function setApiConnected(ok){
  $("apiDot").classList.toggle("on",ok);
  $("apiDot").classList.toggle("off",!ok);
  $("apiBanner").style.display=getApiKey()?"none":"flex";
}

function setSourceStatus(which,state){
  const el=which==="history"?$("historySourceStatus"):$("liveSourceStatus");
  if(!el)return;
  el.classList.remove("source-ok","source-bad");
  if(state==="ok"){el.textContent="Connected ✓";el.classList.add("source-ok")}
  else if(state==="bad"){el.textContent="Failed";el.classList.add("source-bad")}
  else if(state==="loading"){el.textContent="Loading…"}
  else el.textContent="Not loaded";
}
function setSourceError(msg){
  if($("lastSourceError")) $("lastSourceError").textContent=msg||"Unknown error";
}
function clearSourceError(){
  if($("lastSourceError")) $("lastSourceError").textContent="None";
}
function updateMatchedStatus(){
  if($("matchedPlayerStatus")) $("matchedPlayerStatus").textContent=PlayerDB.profiles.size.toLocaleString();
}


// ---------- Pre-match board ----------
function renderPrematch(m,surface="Hard"){
  if(m.error) return `<div class="result-card"><div class="result-title">No model result</div><p class="missing-list">${esc(m.error)}</p></div>`;
  const tier=m.grade>=settings.strong?"STRONG":m.grade>=settings.good?"GOOD":"WATCH";
  return `<div class="result-card">
    <div class="result-score">${m.grade}</div>
    <div class="result-title">${tier}: ${esc(m.fav.name)}</div>
    <div class="result-market">${esc(m.lean)} lean</div>
    <div class="prob-row">
      <div class="prob"><span>Match win</span><strong>${Math.round(m.winP*100)}%</strong></div>
      <div class="prob"><span>2–0 model</span><strong>${Math.round(m.p20*100)}%</strong></div>
      <div class="prob"><span>2–1 model</span><strong>${Math.round(m.p21*100)}%</strong></div>
    </div>
    <ul class="reason-list">
      <li>Overall Elo edge: ${m.eloEdge>=0?"+":""}${m.eloEdge}</li>
      <li>${esc(surface)} Elo edge: ${m.surfaceEdge>=0?"+":""}${m.surfaceEdge}</li>
      <li>${esc(m.fav.name)} last 10: ${m.fav.last10}-${Math.max(0,m.fav.played10-m.fav.last10)}</li>
      <li>${esc(m.fav.name)} ${esc(surface)} last 10: ${m.fav.surface10}-${Math.max(0,m.fav.splayed-m.fav.surface10)}</li>
      <li>3-set frequency: ${m.fav.threeSet}/10 vs ${m.opp.threeSet}/10</li>
    </ul>
  </div>`;
}
$("prematchForm").onsubmit=e=>{
  e.preventDefault();
  const surface=$("preSurface").value;
  $("prematchResult").innerHTML=renderPrematch(prematchModel($("preA").value,$("preB").value,surface),surface);
};

function modelMatchCard(m){
  const a=pName(m,1),b=pName(m,2),surface=mSurface(m);
  const pm=prematchModel(a,b,surface);
  if(pm.error){
    return `<div class="match-card">
      <div class="match-title">${esc(a)} vs ${esc(b)}</div>
      <div class="match-meta">${esc(tournamentName(m))} · ${esc(surface)}</div>
      <span class="badge pass">NO ELO MATCH</span>
      <div class="model-source missing-list">Player names could not be matched to synced history.</div>
    </div>`;
  }
  const tier=pm.grade>=settings.strong?"strong":pm.grade>=settings.good?"good":"watch";
  return `<div class="match-card">
    <div class="match-top">
      <div>
        <div class="match-title">${esc(a)} vs ${esc(b)}</div>
        <div class="match-meta">${esc(tournamentName(m))} · ${esc(surface)}</div>
      </div>
      <span class="badge ${tier}">${tier.toUpperCase()} ${pm.grade}</span>
    </div>
    <div class="edge-grid">
      <div class="edge-chip"><span>Favourite</span><strong>${esc(pm.fav.name)}</strong></div>
      <div class="edge-chip"><span>Overall Elo</span><strong>+${pm.eloEdge}</strong></div>
      <div class="edge-chip"><span>${esc(surface)} Elo</span><strong>+${pm.surfaceEdge}</strong></div>
      <div class="edge-chip"><span>Last 10</span><strong>${pm.fav.last10}-${Math.max(0,pm.fav.played10-pm.fav.last10)}</strong></div>
      <div class="edge-chip"><span>Surface L10</span><strong>${pm.fav.surface10}-${Math.max(0,pm.fav.splayed-pm.fav.surface10)}</strong></div>
      <div class="edge-chip"><span>Lean</span><strong>${esc(pm.lean)}</strong></div>
    </div>
    <span class="route-tag pre">PRE-MATCH → MODEL</span>
    <div class="match-actions">
      <button class="small-btn model-open" data-a="${esc(a)}" data-b="${esc(b)}" data-s="${esc(surface)}">Open pre-match analyzer</button>
    </div>
  </div>`;
}
function refreshModelBoard(){
  const up=STORE.get("te2-upcoming-cache",null)?.data||[];
  $("modelBoard").innerHTML=up.length
    ? up.map(modelMatchCard).join("")
    : '<div class="empty card">No upcoming WTA singles matches loaded yet.</div>';
  bindMatchButtons();
}
$("refreshModelBoardBtn").onclick=async()=>{
  if(!history.length) await syncHistory(true);
  await refreshUpcoming();
  refreshModelBoard();
};

// ---------- Live cards ----------
function preliminaryLive(m){
  const a=pName(m,1),b=pName(m,2),surface=mSurface(m),set1=completedSet(m,0);
  const pm=prematchModel(a,b,surface);
  if(pm.error||!set1) return null;
  const p1=findPlayer(a);
  const favIsP1=p1 && norm(pm.fav.name)===norm(p1.name);
  const favLost=(favIsP1&&set1.winner===2)||(!favIsP1&&set1.winner===1);
  const fg=favIsP1?set1.a:set1.b, og=favIsP1?set1.b:set1.a;
  let score=pm.grade;
  if(favLost){
    const margin=Math.abs(fg-og);
    score+=margin<=1?8:margin===2?4:-10;
  } else score-=8;
  return {...pm,score:clamp(score,1,96),favLost,fg,og};
}
function liveMatchCard(m,live=true){
  const a=pName(m,1),b=pName(m,2),surface=mSurface(m),pm=prematchModel(a,b,surface);
  const pre=live?preliminaryLive(m):pm;
  const grade=pre?.score??pm?.grade??0;
  const tier=grade>=settings.strong?"strong":grade>=settings.good?"good":grade>=62?"watch":"pass";
  const label=grade?`${tier.toUpperCase()} ${grade}`:"NO ELO";
  const s=scoreObj(m);
  const server=s.server;
  const aDisp=`${server===1?'<span class="server">●</span> ':''}${esc(a)}`;
  const bDisp=`${server===2?'<span class="server">●</span> ':''}${esc(b)}`;

  let metrics="";
  if(!pm.error){
    metrics=`<div class="edge-grid">
      <div class="edge-chip"><span>Favourite</span><strong>${esc(pm.fav.name)}</strong></div>
      <div class="edge-chip"><span>Elo edge</span><strong>+${pm.eloEdge}</strong></div>
      <div class="edge-chip"><span>Surface</span><strong>+${pm.surfaceEdge}</strong></div>
    </div>`;
  }

  return `<div class="match-card">
    <div class="match-top">
      <div>
        <div class="match-title">${aDisp} vs ${bDisp}</div>
        <div class="match-meta">${esc(tournamentName(m))} · ${esc(surface)} · ${esc(m.round||"")}</div>
      </div>
      <span class="badge ${tier}">${label}</span>
    </div>
    ${live?`<div class="scoreline">${esc(scoreText(m)||"Live")}</div><span class="live-set-chip">Set ${currentSetIndex(m)+1}</span>`:""}
    ${metrics}
    ${live?'<span class="route-tag live">LIVE → LIVE ANALYZER</span>':'<span class="route-tag pre">UPCOMING → PRE-MATCH MODEL</span>'}
    <div class="match-actions">
      ${live
        ? `<button class="small-btn analyze-match" data-id="${esc(m.id||"")}" data-a="${esc(a)}" data-b="${esc(b)}" data-s="${esc(surface)}">Open live analyzer</button>`
        : `<button class="small-btn model-open" data-a="${esc(a)}" data-b="${esc(b)}" data-s="${esc(surface)}">Open pre-match analyzer</button>`}
    </div>
  </div>`;
}

function findCachedMatch(id,a,b){
  const all=[
    ...(STORE.get("te2-live-cache",null)?.data||[]),
    ...(STORE.get("te2-upcoming-cache",null)?.data||[])
  ];
  return all.find(m=>String(m.id||"")===String(id||""))
      || all.find(m=>norm(pName(m,1))===norm(a)&&norm(pName(m,2))===norm(b))
      || null;
}

// ---------- Analyzer auto-fill ----------
const manualLiveFields=["firstWon","secondWon","bpCreated","bpConceded","oppBpConv"];

function markField(id,mode){
  const el=$(id);
  el.classList.remove("needs-manual","auto-filled");
  if(mode==="manual") el.classList.add("needs-manual");
  if(mode==="auto") el.classList.add("auto-filled");
}
function clearManualLiveStats(){
  for(const id of manualLiveFields){
    $(id).value="";
    markField(id,"manual");
  }
}
function fillAnalyzerFromMatch(m,a,b,surface){
  currentAnalyzerMatch=m;
  $("anSurface").value=surface;
  const pm=prematchModel(a,b,surface);
  let fav=a,opp=b;

  if(!pm.error){
    fav=pm.fav.name;
    const resolvedA=findPlayer(a);
    opp=(resolvedA && norm(pm.fav.name)===norm(resolvedA.name))?b:a;
  }

  $("favName").value=fav;
  $("oppName").value=opp;
  updateAnalyzerProfile(true);

  // Identify whether fav is API p1 or p2.
  const api1=pName(m,1), api2=pName(m,2);
  const favP=findPlayer(fav);
  const p1P=findPlayer(api1);
  const favIsP1 = favP && p1P ? norm(favP.name)===norm(p1P.name) : norm(fav)===norm(api1);

  const set1=completedSet(m,0);
  const available=[], missing=[];

  if(set1){
    $("favGames").value=favIsP1?set1.a:set1.b;
    $("oppGames").value=favIsP1?set1.b:set1.a;
    $("lostSet").value=((favIsP1&&set1.winner===2)||(!favIsP1&&set1.winner===1))?"yes":"no";
    ["favGames","oppGames","lostSet"].forEach(id=>markField(id,"auto"));
    available.push("Set 1 games", "Set 1 winner/loss");
  } else {
    ["favGames","oppGames","lostSet"].forEach(id=>markField(id,"manual"));
    missing.push("completed Set 1 score");
  }

  if(updateAnalyzerProfile(true)){
    available.push("Elo edge","last 10","surface last 10");
  } else {
    missing.push("Elo/form");
  }

  // FREE score feed does not provide serve split / break-point statistics.
  clearManualLiveStats();
  missing.push("1st serve points won","2nd serve points won","break points created","break points conceded","opponent BP conversion");

  const s=scoreObj(m);
  $("autofillStatus").innerHTML=`
    <strong>Auto-fill status</strong>
    <span class="available-list">Auto: ${available.length?available.join(", "):"none"}</span>
    <span class="missing-list">Red/manual: ${missing.join(", ")}</span>
    <span>Current live score: ${esc(scoreText(m)||"not available")} ${s.server?`· server: ${s.server===1?esc(api1):esc(api2)}`:""}</span>`;

  nav("analyzer");
}

function bindMatchButtons(){
  document.querySelectorAll(".analyze-match").forEach(btn=>{
    btn.onclick=()=>{
      const a=btn.dataset.a,b=btn.dataset.b,s=btn.dataset.s;
      const m=findCachedMatch(btn.dataset.id,a,b);
      if(m) fillAnalyzerFromMatch(m,a,b,s);
      else {
        $("favName").value=a; $("oppName").value=b; $("anSurface").value=s;
        updateAnalyzerProfile(true);
        ["favGames","oppGames","lostSet",...manualLiveFields].forEach(id=>markField(id,"manual"));
        $("autofillStatus").innerHTML='<strong>Auto-fill status</strong><span class="missing-list">No live score object was cached. Red fields need manual entry.</span>';
        nav("analyzer");
      }
    };
  });

  document.querySelectorAll(".model-open").forEach(btn=>{
    btn.onclick=()=>{
      $("preA").value=btn.dataset.a; $("preB").value=btn.dataset.b; $("preSurface").value=btn.dataset.s;
      $("prematchResult").innerHTML=renderPrematch(prematchModel(btn.dataset.a,btn.dataset.b,btn.dataset.s),btn.dataset.s);
      nav("model");
    };
  });
}

async function refreshLive(){
  $("refreshLiveBtn").textContent="Loading…"; $("refreshLiveBtn").disabled=true;
  try{
    const j=await apiFetch("/matches?status=live&tour=wta&draw=singles&limit=100");
    const data=unwrapMatches(j);
    STORE.set("te2-live-cache",{time:Date.now(),data});
    $("liveMatches").innerHTML=data.length?data.map(m=>liveMatchCard(m,true)).join(""):'<div class="empty card">No WTA matches are live right now.</div>';
    $("liveUpdated").textContent=`Updated ${nowLabel()} · ${data.length} live`;
    setApiConnected(true); setSourceStatus("live","ok"); clearSourceError();
    bindMatchButtons();
    refreshModelBoard();
    maybeNotify(data);
  }catch(err){
    $("liveMatches").innerHTML=`<div class="empty card">${esc(err.message)}</div>`;
    setApiConnected(false); setSourceStatus("live","bad"); setSourceError((err && err.name ? err.name + ": " : "") + (err.message||String(err)));
  }finally{
    $("refreshLiveBtn").textContent="↻ Refresh"; $("refreshLiveBtn").disabled=false;
  }
}
$("refreshLiveBtn").onclick=refreshLive;

async function refreshUpcoming(){
  $("refreshUpcomingBtn").textContent="Loading…"; $("refreshUpcomingBtn").disabled=true;
  try{
    const j=await apiFetch("/matches?status=upcoming&tour=wta&draw=singles&limit=100");
    const data=unwrapMatches(j);
    STORE.set("te2-upcoming-cache",{time:Date.now(),data});
    $("upcomingMatches").innerHTML=data.length?data.map(m=>liveMatchCard(m,false)).join(""):'<div class="empty card">No upcoming WTA matches returned.</div>';
    setApiConnected(true); setSourceStatus("live","ok"); clearSourceError();
    bindMatchButtons();
    refreshModelBoard();
  }catch(err){
    $("upcomingMatches").innerHTML=`<div class="empty card">${esc(err.message)}</div>`;
    setApiConnected(false); setSourceStatus("live","bad"); setSourceError((err && err.name ? err.name + ": " : "") + (err.message||String(err)));
  }finally{
    $("refreshUpcomingBtn").textContent="Load"; $("refreshUpcomingBtn").disabled=false;
  }
}
$("refreshUpcomingBtn").onclick=refreshUpcoming;

// ---------- Notifications ----------
function maybeNotify(matches){
  if(!("Notification" in window)||Notification.permission!=="granted") return;
  for(const m of matches){
    const p=preliminaryLive(m);
    if(!p||!p.favLost||p.score<settings.strong||notified.has(String(m.id))) continue;
    new Notification("Tennis Edge: live setup",{body:`${p.fav.name} lost Set 1. Preliminary edge ${p.score}. Open Analyzer.`});
    notified.add(String(m.id));
  }
  STORE.set("te2-notified",[...notified].slice(-100));
}

// ---------- Live grade ----------
function valNum(id){
  const raw=$(id).value;
  return raw===""?null:Number(raw);
}
function gradeLive(v){
  let score=48,reasons=[],missing=0;
  if(v.elo!=null){
    if(v.elo>=120){score+=14;reasons.push(`Large Elo advantage (+${v.elo}).`)}
    else if(v.elo>=80){score+=10;reasons.push(`Solid Elo advantage (+${v.elo}).`)}
    else if(v.elo>=40)score+=4;
    else if(v.elo<0){score-=14;reasons.push("The player is behind on Elo.")}
  } else missing++;

  if(v.last10!=null){ if(v.last10>=8){score+=7;reasons.push(`Excellent recent form (${v.last10}/10 wins).`)} else if(v.last10>=6)score+=3; else if(v.last10<=4)score-=5; } else missing++;
  if(v.surface10!=null){ if(v.surface10>=8){score+=7;reasons.push("Excellent same-surface form.")} else if(v.surface10>=6)score+=3; else if(v.surface10<=4)score-=5; } else missing++;

  if(v.fg!=null&&v.og!=null){
    const margin=Math.abs(v.fg-v.og);
    if(v.lost){ if(margin<=1){score+=10;reasons.push("Set 1 was extremely close.")} else if(margin===2){score+=6;reasons.push("Set 1 stayed competitive.")} else if(margin>=4){score-=13;reasons.push("Set 1 score suggests genuine domination.")} }
  } else missing++;

  if(v.first!=null){ if(v.first>=70){score+=8;reasons.push("First-serve points won stayed excellent.")} else if(v.first>=63)score+=4; else if(v.first<56){score-=10;reasons.push("First-serve points won is a red flag.")} } else missing++;
  if(v.second!=null){ if(v.second>=45)score+=4; else if(v.second<32){score-=8;reasons.push("Second serve is being punished.")} } else missing++;

  if(v.bpc!=null&&v.bpa!=null){
    const d=v.bpc-v.bpa;
    if(d>=3){score+=12;reasons.push("Created much more break pressure.")}
    else if(d>=1){score+=7;reasons.push("Created more break chances.")}
    else if(d<=-3){score-=12;reasons.push("Opponent created far more break pressure.")}
  } else missing++;

  if(v.obpc!=null&&v.bpa!=null&&v.obpc>=80&&v.bpa<=4){score+=6;reasons.push("Opponent converted an unusually high share of limited break chances.")}

  if(v.phys==="bad"){score-=25;reasons.push("Physical concern overrides the statistical angle.")}
  else if(v.phys==="unknown")score-=4;

  // Do not award Strong with too much missing live information.
  score=clamp(Math.round(score),1,99);
  if(missing>=4) score=Math.min(score,settings.good+3);

  const tier=score>=settings.strong?"STRONG":score>=settings.good?"GOOD":score>=62?"WATCH":"PASS";
  const market=tier==="PASS"?"No bet":v.lost?`${v.fav} Set 2 ML`:`${v.fav} live ML`;
  if(missing) reasons.push(`${missing} data group${missing===1?"":"s"} missing; red fields were not counted.`);
  return {score,tier,market,reasons};
}

$("analyzerForm").onsubmit=e=>{
  e.preventDefault();
  const v={
    fav:$("favName").value.trim(),opp:$("oppName").value.trim(),
    elo:valNum("eloEdge"),last10:valNum("last10"),surface10:valNum("surface10"),
    fg:valNum("favGames"),og:valNum("oppGames"),lost:$("lostSet").value==="yes",
    first:valNum("firstWon"),second:valNum("secondWon"),bpc:valNum("bpCreated"),
    bpa:valNum("bpConceded"),obpc:valNum("oppBpConv"),phys:$("physical").value
  };
  const g=gradeLive(v);
  $("analysisResult").innerHTML=`<div class="result-card">
    <div class="result-score">${g.score}</div>
    <div class="result-title">${g.tier==="STRONG"?"🔥 ":""}${g.tier}</div>
    <div class="result-market">${esc(g.market)}</div>
    <ul class="reason-list">${g.reasons.map(r=>`<li>${esc(r)}</li>`).join("")}</ul>
    <button id="trackPlayBtn" class="primary-btn">Track this play</button>
  </div>`;
  $("trackPlayBtn").onclick=()=>trackPlay({fav:v.fav,opp:v.opp,score:g.score,tier:g.tier,market:g.market,status:"pending",created:Date.now()});
};

// Manual edits remove red indicator.
[...manualLiveFields,"eloEdge","last10","surface10","favGames","oppGames"].forEach(id=>{
  $(id)?.addEventListener("input",()=>{ if($(id).value!=="") markField(id,"auto"); });
});

// Analyzer profile auto-refresh.
let analyzerDebounce=null;
["favName","oppName"].forEach(id=>{
  $(id).addEventListener("input",()=>{
    clearTimeout(analyzerDebounce);
    analyzerDebounce=setTimeout(()=>updateAnalyzerProfile(true),250);
  });
  $(id).addEventListener("change",()=>updateAnalyzerProfile(true));
});
$("anSurface").addEventListener("change",()=>updateAnalyzerProfile(true));

// ---------- Results ----------
function trackPlay(play){
  const arr=STORE.get("te2-results",[]);
  arr.unshift(play); STORE.set("te2-results",arr); renderResults();
  if($("trackPlayBtn")) $("trackPlayBtn").textContent="Tracked ✓";
}
function renderResults(){
  const arr=STORE.get("te2-results",[]);
  const graded=arr.filter(x=>["win","loss"].includes(x.status));
  const wins=graded.filter(x=>x.status==="win").length;
  $("trackedCount").textContent=arr.length;
  $("winRate").textContent=graded.length?`${Math.round(wins/graded.length*100)}%`:"—";
  const strong=graded.filter(x=>x.tier==="STRONG"),sw=strong.filter(x=>x.status==="win").length;
  $("strongRecord").textContent=`${sw}-${strong.length-sw}`;

  $("resultsList").innerHTML=arr.length?"":'<div class="empty card">No plays tracked yet.</div>';
  arr.forEach((x,i)=>{
    const d=document.createElement("div"); d.className="match-card";
    d.innerHTML=`<div class="match-top"><div><div class="match-title">${esc(x.fav)} vs ${esc(x.opp)}</div><div class="match-meta">${esc(x.market)} · model ${x.score}</div></div><span class="badge ${x.tier==="STRONG"?"strong":x.tier==="GOOD"?"good":"watch"}">${esc(x.status.toUpperCase())}</span></div><div class="match-actions"><button class="small-btn" data-result="${i}:win">Win</button><button class="small-btn danger" data-result="${i}:loss">Loss</button><button class="small-btn" data-result="${i}:void">Void</button></div>`;
    $("resultsList").appendChild(d);
  });
}
$("resultsList").onclick=e=>{
  if(!e.target.dataset.result) return;
  const [i,s]=e.target.dataset.result.split(":");
  const a=STORE.get("te2-results",[]);
  a[Number(i)].status=s; STORE.set("te2-results",a); renderResults();
};
$("clearResultsBtn").onclick=()=>{ if(confirm("Clear tracked plays?")){ STORE.set("te2-results",[]); renderResults(); } };

// ---------- Settings ----------
$("saveApiBtn").onclick=()=>{
  STORE.set("te2-api-key",$("apiKey").value.trim());
  setApiConnected(!!getApiKey());
  $("apiTestMsg").textContent="Saved on this device.";
  configureTimer();
};
$("testApiBtn").onclick=async()=>{
  STORE.set("te2-api-key",$("apiKey").value.trim());
  $("apiTestMsg").textContent="Testing…";
  try{
    await apiFetch("/matches?status=live&tour=wta&draw=singles&limit=1");
    $("apiTestMsg").textContent="Connected ✓"; setApiConnected(true);
  }catch(err){
    $("apiTestMsg").textContent=err.message; setApiConnected(false);
  }
};
$("notifyBtn").onclick=async()=>{
  if(!("Notification" in window)){ alert("Notifications are not supported in this browser."); return; }
  const p=await Notification.requestPermission();
  $("notifyBtn").textContent=p==="granted"?"Notifications enabled ✓":"Notifications blocked";
};
function setupSettings(){
  $("apiKey").value=getApiKey();
  $("strongThreshold").value=settings.strong;
  $("goodThreshold").value=settings.good;
  $("autoRefresh").checked=settings.autoRefresh;
  $("heroThreshold").textContent=settings.strong+"+";
  setApiConnected(!!getApiKey());
}
$("saveSettingsBtn").onclick=()=>{
  settings={strong:Number($("strongThreshold").value),good:Number($("goodThreshold").value),autoRefresh:$("autoRefresh").checked};
  STORE.set("te2-settings",settings);
  $("heroThreshold").textContent=settings.strong+"+";
  configureTimer(); refreshAllModelViews();
  alert("Settings saved.");
};
function configureTimer(){
  if(liveTimer) clearInterval(liveTimer);
  if(settings.autoRefresh&&getApiKey()) liveTimer=setInterval(refreshLive,15*60*1000);
}

// ---------- Cache / cross-tab refresh ----------
function refreshAllModelViews(){
  renderHistoryStatus();
  updateAnalyzerProfile(true);

  const live=STORE.get("te2-live-cache",null)?.data||[];
  const up=STORE.get("te2-upcoming-cache",null)?.data||[];

  if(live.length){
    $("liveMatches").innerHTML=live.map(m=>liveMatchCard(m,true)).join("");
    $("liveUpdated").textContent=`Cached · ${live.length} live`;
  }
  if(up.length) $("upcomingMatches").innerHTML=up.map(m=>liveMatchCard(m,false)).join("");

  refreshModelBoard();
  bindMatchButtons();

  if($("preA").value.trim()&&$("preB").value.trim()){
    const s=$("preSurface").value;
    $("prematchResult").innerHTML=renderPrematch(prematchModel($("preA").value,$("preB").value,s),s);
  }
}
function loadCaches(){
  const live=STORE.get("te2-live-cache",null),up=STORE.get("te2-upcoming-cache",null);
  if(live?.data){
    $("liveMatches").innerHTML=live.data.length?live.data.map(m=>liveMatchCard(m,true)).join(""):'<div class="empty card">No live matches in cache.</div>';
    $("liveUpdated").textContent=`Cached ${new Date(live.time).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}`;
  }
  if(up?.data) $("upcomingMatches").innerHTML=up.data.length?up.data.map(m=>liveMatchCard(m,false)).join(""):'<div class="empty card">No upcoming matches in cache.</div>';
  refreshModelBoard();
  bindMatchButtons();
}


$("forceSourceSyncBtn").onclick=async()=>{
  $("forceSourceSyncBtn").textContent="Syncing everything…";
  try{
    await syncHistory(true);
    if(getApiKey()){
      await refreshLive();
      await refreshUpcoming();
    }
    refreshAllModelViews();
    $("forceSourceSyncBtn").textContent="Full sync complete ✓";
    setTimeout(()=>$("forceSourceSyncBtn").textContent="Force full source sync",1600);
  }catch(err){
    setSourceError((err && err.name ? err.name + ": " : "") + (err.message||String(err)));
    $("forceSourceSyncBtn").textContent="Sync failed";
  }
};

// ---------- Install ----------
let deferredPrompt;
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); deferredPrompt=e; $("installBtn").hidden=false; });
$("installBtn").onclick=async()=>{ if(!deferredPrompt)return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $("installBtn").hidden=true; };
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js"));


function migrateHistoricalCache(){
  // Older builds attempted to store the entire ~50-column historical CSV.
  // Convert any surviving old cache into the compact six-field format.
  if(!Array.isArray(history) || !history.length) return;
  const sample=history[0]||{};
  const keys=Object.keys(sample);
  if(keys.length>10 || "winner_rank" in sample || "w_ace" in sample){
    history=history.map(r=>({
      winner_name:r.winner_name,
      loser_name:r.loser_name,
      surface:r.surface||"Hard",
      tourney_date:r.tourney_date,
      match_num:r.match_num||"",
      score:r.score||""
    })).filter(r=>r.winner_name&&r.loser_name&&r.tourney_date);
    try{ STORE.set("te2-history",history); }catch(_){}
  }
}

// ---------- Start ----------
migrateHistoricalCache();
setupSettings();
if(history.length) setSourceStatus("history","ok");
if(getApiKey()) setSourceStatus("live","loading");
buildModelCache();
renderResults();
loadCaches();
configureTimer();
updateAnalyzerProfile(false);

// Automatically refresh the historical player/Elo database at least twice per day.
setTimeout(()=>syncHistory(false),350);

// If a key exists, refresh current boards shortly after startup.
if(getApiKey()){
  setTimeout(refreshLive,1000);
  setTimeout(refreshUpcoming,2200);
}
