// Optional browser-side match-winner odds. The key stays on this device.
const OddsAuto=(()=>{
  const KEY="te-odds-api-key", LINKS="te-odds-links", CACHE_MS=120000;
  const cache=new Map();
  const key=()=>localStorage.getItem(KEY)||"";
  const name=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z ]/g," ").replace(/\s+/g," ").trim();
  const same=(a,b)=>name(a)===name(b);
  const links=()=>{try{return JSON.parse(localStorage.getItem(LINKS)||"{}")||{}}catch{return {}}};
  const saveLink=(id,link)=>localStorage.setItem(LINKS,JSON.stringify({...links(),[id]:link}));
  async function request(path){
    const url=new URL(`https://api.the-odds-api.com/v4/${path}`);
    url.searchParams.set("apiKey",key());
    const response=await fetch(url.toString(),{cache:"no-store"});
    const remaining=response.headers.get("x-requests-remaining");
    if(remaining!==null)localStorage.setItem("te-odds-remaining",remaining);
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||`Odds API returned ${response.status}`)}
    return response.json();
  }
  async function sports(){
    const c=cache.get("sports");if(c&&Date.now()-c.at<3600000)return c.value;
    const value=(await request("sports/" )).filter(s=>s.active&&!s.has_outrights&&s.group==="Tennis"&&/wta/i.test(`${s.key} ${s.title}`));
    cache.set("sports",{at:Date.now(),value});return value;
  }
  async function events(sport,force=false){
    const c=cache.get(sport);if(!force&&c&&Date.now()-c.at<CACHE_MS)return c.value;
    const value=await request(`sports/${encodeURIComponent(sport)}/odds/?regions=us&markets=h2h&oddsFormat=decimal`);
    cache.set(sport,{at:Date.now(),value});return value;
  }
  function quote(event,link){
    const books=event.bookmakers||[];
    const book=books.find(b=>b.key===link?.bookmaker)||books.find(b=>b.markets?.some(m=>m.key==="h2h"));
    const outcomes=book?.markets?.find(m=>m.key==="h2h")?.outcomes||[];
    if(outcomes.length!==2)return null;
    const a=outcomes.find(o=>same(o.name,event.home_team));
    const b=outcomes.find(o=>same(o.name,event.away_team));
    if(!a||!b||!(a.price>1&&b.price>1))return null;
    return {eventId:event.id,sport:event.sport_key,bookmaker:book.key,at:book.last_update||new Date().toISOString(),players:[{name:a.name,odds:a.price},{name:b.name,odds:b.price}],commenceTime:event.commence_time};
  }
  async function find(a,b,id,force=false){
    if(!key())throw new Error("Save your Odds API key first.");
    const prior=links()[id],available=await sports();
    const sportKeys=prior?[prior.sport]:available.map(s=>s.key).slice(0,8);
    for(const sport of sportKeys){
      const list=await events(sport,force);
      const event=list.find(e=>e.id===prior?.eventId)||list.find(e=>
        (same(e.home_team,a)&&same(e.away_team,b))||(same(e.home_team,b)&&same(e.away_team,a)));
      if(!event)continue;
      const result=quote(event,prior);
      if(result){saveLink(id,{sport,eventId:event.id,bookmaker:result.bookmaker});return result;}
    }
    return null;
  }
  return {key,saveKey:value=>localStorage.setItem(KEY,String(value||"").trim()),find,sports,
    remaining:()=>localStorage.getItem("te-odds-remaining")};
})();
