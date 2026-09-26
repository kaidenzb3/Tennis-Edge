/* SportScore adapter. All requests go through the configured proxy so the RapidAPI key is never shipped to browsers. */
const SportScore=(()=>{
  const DEFAULT_PROXY="https://tennis-edge-api.kaidenzb3.workers.dev";
  // This deployment has one known-good secure Worker. Older installed builds may
  // have saved an obsolete Worker URL, so always use the verified endpoint.
  const proxy=()=>DEFAULT_PROXY;
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
  const home=e=>e?.home_team||e?.homeTeam||{};
  const away=e=>e?.away_team||e?.awayTeam||{};
  const text=e=>[e?.section?.name,e?.section?.slug,e?.league?.name,e?.league?.slug,e?.challenge?.name,e?.tournament?.name,e?.tournament?.category?.name,e?.season?.name].filter(Boolean).join(" ");
  const singles=e=>!/[\/]|doubles/i.test(`${home(e)?.name||""} ${away(e)?.name||""} ${text(e)}`);
  const excluded=e=>/\butr\b|\bitf\b|billie jean king|fed cup|college|ncaa/i.test(text(e));
  const mens=e=>/\batp\b|\bmen singles\b|\bmen's\b|\bboys\b/i.test(text(e))||home(e)?.gender==="M"||away(e)?.gender==="M";
  const wta=e=>singles(e)&&!excluded(e)&&!mens(e)&&(/\bwta\b/i.test(text(e))||(home(e)?.gender==="F"&&away(e)?.gender==="F")||(!home(e)?.gender&&!away(e)?.gender));
  const surface=s=>/clay/i.test(s)?"Clay":/grass/i.test(s)?"Grass":/carpet/i.test(s)?"Carpet":"Hard";
  const score=e=>{
    const h=e?.home_score||e?.homeScore||{},a=e?.away_score||e?.awayScore||{},hg=[],ag=[];
    const period=(o,i)=>o[`period_${i}`]??o[`period${i}`];
    for(let i=1;i<=5;i++)if(period(h,i)!=null||period(a,i)!=null){hg.push(period(h,i)??0);ag.push(period(a,i)??0)}
    return {sets:[h.current??0,a.current??0],games:[hg,ag],points:[h.point??null,a.point??null],server:e?.first_supply??e?.firstToServe??null};
  };
  const event=e=>{
    const h=home(e),a=away(e),winnerCode=e?.winner_code??e?.winnerCode;
    const winner=winnerCode===1?h:winnerCode===2?a:null;
    const status=typeof e?.status==="string"?e.status:(e?.status?.type||e?.status?.description||"");
    const start=e?.start_at?`${String(e.start_at).replace(" ","T")}Z`:(e?.startTimestamp?new Date(Number(e.startTimestamp)*1000).toISOString():null);
    return {id:String(e.id),players:{p1:{id:h?.id,name:h?.name,rank:h?.ranking??h?.playerTeamInfo?.currentRanking??null},p2:{id:a?.id,name:a?.name,rank:a?.ranking??a?.playerTeamInfo?.currentRanking??null}},
      tournament:e?.challenge?.name||e?.tournament?.name||e?.league?.name||"WTA",round:e?.round_info?.name||e?.roundInfo?.name||"",surface:surface(e?.ground_type||e?.groundType),start_at:start,status,status_detail:e?.status_more||e?.status?.description||"",
      winner:winner?{name:winner.name}:null,score:score(e),main_odds:e?.main_odds||null,_sportscore:e};
  };
  const list=j=>rows(j).filter(wta).map(event);
  const dates=offsets=>offsets.map(i=>{const d=new Date();d.setDate(d.getDate()+i);return d.toISOString().slice(0,10)});
  async function live(){return list(await req("live"))}
  async function scheduled(){const batches=await Promise.all(dates([0,1,2]).map(date=>req("date",{date})));return batches.flatMap(list).filter(m=>!/inprogress|live|finished|completed/i.test(m.status||"")&&!m.winner&&(!m.start_at||new Date(m.start_at).getTime()>Date.now()))}
  async function completed(){const batches=await Promise.all(dates([-1,0]).map(date=>req("date",{date})));return batches.flatMap(list).filter(m=>m.winner||/finished|completed/i.test(m.status||""))}
  const stats=async id=>rows(await req("stats",{id}));
  const points=async id=>rows(await req("points",{id}));
  const markets=async id=>rows(await req("markets",{id}));
  function statMap(items){const out={};for(const x of items)out[x.name]={home:x.home,away:x.away,period:x.period};return out}
  return {proxy,saveProxy:()=>localStorage.removeItem("te-sportscore-proxy"),req,live,scheduled,completed,stats,points,markets,statMap,event,wta};
})();
if(typeof module!=="undefined")module.exports=SportScore;
