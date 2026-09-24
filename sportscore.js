/* SportScore adapter. All requests go through the configured proxy so the RapidAPI key is never shipped to browsers. */
const SportScore=(()=>{
  const DEFAULT_PROXY="https://tennis-edge-api.kaidenzb3.workers.dev";
  const proxy=()=>String(localStorage.getItem("te-sportscore-proxy")||DEFAULT_PROXY).trim().replace(/\/$/,"");
  const req=async(action,params={})=>{
    if(!proxy())throw new Error("Add the SportScore proxy address in Settings.");
    const u=new URL(proxy());u.searchParams.set("action",action);
    for(const [k,v] of Object.entries(params))if(v!=null)u.searchParams.set(k,v);
    const r=await fetch(u,{cache:"no-store"});
    const body=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(body.error||`SportScore returned ${r.status}`);
    return body;
  };
  const rows=j=>Array.isArray(j)?j:Array.isArray(j?.data)?j.data:[];
  const text=e=>[e?.section?.name,e?.section?.slug,e?.league?.name,e?.league?.slug,e?.challenge?.name,e?.season?.name].filter(Boolean).join(" ");
  const singles=e=>!/[\/]|doubles/i.test(`${e?.home_team?.name||""} ${e?.away_team?.name||""} ${text(e)}`);
  const excluded=e=>/\butr\b|\bitf\b|billie jean king|fed cup|college|ncaa/i.test(text(e));
  const wta=e=>singles(e)&&!excluded(e)&&(/\bwta\b/i.test(text(e))||(e?.home_team?.gender==="F"&&e?.away_team?.gender==="F"));
  const surface=s=>/clay/i.test(s)?"Clay":/grass/i.test(s)?"Grass":/carpet/i.test(s)?"Carpet":"Hard";
  const score=e=>{
    const h=e?.home_score||{},a=e?.away_score||{},hg=[],ag=[];
    for(let i=1;i<=5;i++)if(h[`period_${i}`]!=null||a[`period_${i}`]!=null){hg.push(h[`period_${i}`]??0);ag.push(a[`period_${i}`]??0)}
    return {sets:[h.current??0,a.current??0],games:[hg,ag],points:[h.point??null,a.point??null],server:e?.first_supply??null};
  };
  const event=e=>{
    const winner=e?.winner_code===1?e?.home_team:e?.winner_code===2?e?.away_team:null;
    return {id:String(e.id),players:{p1:{id:e?.home_team?.id,name:e?.home_team?.name,rank:e?.home_team?.ranking??null},p2:{id:e?.away_team?.id,name:e?.away_team?.name,rank:e?.away_team?.ranking??null}},
      tournament:e?.challenge?.name||e?.league?.name||"WTA",round:e?.round_info?.name||"",surface:surface(e?.ground_type),start_at:e?.start_at?`${String(e.start_at).replace(" ","T")}Z`:null,status:e?.status,
      winner:winner?{name:winner.name}:null,score:score(e),main_odds:e?.main_odds||null,_sportscore:e};
  };
  const list=j=>rows(j).filter(wta).map(event);
  const dates=offsets=>offsets.map(i=>{const d=new Date();d.setDate(d.getDate()+i);return d.toISOString().slice(0,10)});
  async function live(){return list(await req("live"))}
  async function scheduled(){const batches=await Promise.all(dates([0,1,2]).map(date=>req("date",{date})));return batches.flatMap(list).filter(m=>m.status!=="inprogress"&&!m.winner)}
  async function completed(){const batches=await Promise.all(dates([-1,0]).map(date=>req("date",{date})));return batches.flatMap(list).filter(m=>m.winner||/finished|completed/i.test(m.status||""))}
  const stats=async id=>rows(await req("stats",{id}));
  const points=async id=>rows(await req("points",{id}));
  const markets=async id=>rows(await req("markets",{id}));
  function statMap(items){const out={};for(const x of items)out[x.name]={home:x.home,away:x.away,period:x.period};return out}
  return {proxy,saveProxy:v=>localStorage.setItem("te-sportscore-proxy",String(v||"").trim()),req,live,scheduled,completed,stats,points,markets,statMap,event,wta};
})();
if(typeof module!=="undefined")module.exports=SportScore;
