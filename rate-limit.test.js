const {test}=require("node:test");
const assert=require("node:assert/strict");
const {create,retryDelay,TTL,STALE}=require("./request-cache.js");
function fixture(fetcher){
  let time=Date.now(),calls=0;const db=new Map();
  const options={read:async k=>db.get(k),write:async(k,v)=>db.set(k,structuredClone(v)),now:()=>time,
    fetcher:async key=>{calls++;return fetcher(key)}};
  return {cache:create(options),restart:()=>create(options),db,advance:ms=>time+=ms,calls:()=>calls};
}
const ok=body=>Response.json(body);
test("concurrent callers deduplicate and empty data is cached",async()=>{
  const f=fixture(()=>ok({data:[]}));
  await Promise.all(Array.from({length:20},()=>f.cache.get("live","live")));
  assert.equal(f.calls(),1);
  await f.restart().get("live","live");assert.equal(f.calls(),1);
  f.advance(TTL.live);await f.cache.get("live","live");assert.equal(f.calls(),2);
});
test("Retry-After supports seconds, dates, zero and malformed values",()=>{
  assert.equal(retryDelay("120"),120000);assert.equal(retryDelay(null),0);
  assert.equal(retryDelay(""),0);assert.equal(retryDelay("oops"),0);
  assert.equal(retryDelay(new Date(200000).toUTCString(),100000),100000);
  assert.equal(retryDelay("0"),0);
});
test("429 cooldown survives restart, blocks other keys, then backs off",async()=>{
  const f=fixture(()=>new Response("",{status:429,headers:{"Retry-After":"900"}}));
  await assert.rejects(f.cache.get("a","date"),e=>e.status===429&&/rate-limited until at least/.test(e.message));
  await assert.rejects(f.restart().get("b","date"),e=>e.status===429);
  assert.equal(f.calls(),1);
  f.advance(900000);await assert.rejects(f.cache.get("a","date"));
  assert.equal(f.calls(),2);assert.equal(f.db.get("cooldown").failures,2);
});
test("serialized date requests stop upstream traffic after the first 429",async()=>{
  const f=fixture(()=>new Response("",{status:429}));
  await Promise.allSettled([f.cache.get("today","date"),f.cache.get("tomorrow","date")]);
  assert.equal(f.calls(),1);
});
test("errors serve last good empty data, preserve age, and expire after a day",async()=>{
  let fail=false;const f=fixture(()=>{if(fail)throw new Error("offline");return ok({data:[]})});
  const first=await f.cache.get("live","live");fail=true;f.advance(TTL.live);
  const stale=await f.cache.get("live","live");
  assert.equal(stale.stale,true);assert.equal(stale.at,first.at);
  await f.cache.get("live","live");assert.equal(f.calls(),2);
  f.advance(STALE);await assert.rejects(f.cache.get("live","live"));
});
test("500s and invalid JSON do not overwrite the last successful response",async()=>{
  for(const failure of [()=>new Response("",{status:500}),()=>new Response("bad JSON")]){
    let fail=false;const f=fixture(()=>fail?failure():ok({data:[1]}));
    const first=await f.cache.get("a","live");fail=true;f.advance(TTL.live);
    const stale=await f.cache.get("a","live");assert.deepEqual(stale.body,first.body);assert.equal(stale.stale,true);
  }
});
test("proxy stale headers retain timestamp and establish client cooldown",async()=>{
  const old=Date.now()-600000;
  const f=fixture(()=>Response.json({data:[1]},{headers:{"X-Data-Stale":"1","X-Data-Timestamp":String(old),"Retry-After":"1200"}}));
  const value=await f.cache.get("live","live");assert.equal(value.stale,true);assert.equal(value.at,old);
  await assert.rejects(f.cache.get("date","date"));assert.equal(f.calls(),1);
});
test("browser adapter shares cache across reloads and preserves stale metadata",async()=>{
  const vm=require("node:vm"),fs=require("node:fs"),db=new Map();let calls=0,fail=false;
  const localStorage={getItem:k=>db.get(k)||null,setItem:(k,v)=>db.set(k,v)};
  function browser(){
    const context=vm.createContext({URL,AbortSignal,localStorage,setTimeout,RequestCache:require("./request-cache.js"),MatchSchedule:require("./schedule.js"),
      fetch:async()=>{calls++;return fail?new Response("",{status:429,headers:{"Retry-After":"600"}}):ok({data:[]})}});
    vm.runInContext(fs.readFileSync("sportscore.js","utf8")+"\nglobalThis.adapter=SportScore",context);
    return context.adapter;
  }
  const first=browser();await Promise.all([first.live(),first.live()]);assert.equal(calls,1);
  await browser().live();assert.equal(calls,1);
  const key=[...db.keys()].find(k=>k.includes("action=live"));
  const entry=JSON.parse(db.get(key));entry.at-=TTL.live;db.set(key,JSON.stringify(entry));fail=true;
  const next=browser();await next.live();assert.equal(next.status().stale,true);assert.equal(next.status().at,entry.at);
  await browser().live();assert.equal(calls,2);
});
test("worker validates routes, deduplicates globally, persists cache and exposes metadata",async()=>{
  const worker=await import("./worker/sportscore-proxy.mjs");
  assert.equal(worker.route(new URL("https://proxy/?action=points&id=123")).path,"/events/123/tennis-points");
  assert.equal(worker.route(new URL("https://proxy/?action=event&id=123")).path,"/events/123");
  assert.equal(worker.route(new URL("https://proxy/?action=rankings")).path,"/tennis-rankings/wta?page=1");
  assert.throws(()=>worker.route(new URL("https://proxy/?action=stats&id=../secret")));
  assert.throws(()=>worker.route(new URL("https://proxy/?action=date&date=2020-01-01")));
  const db=new Map();const storage={get:async k=>db.get(k),put:async(k,v)=>db.set(k,v),list:async()=>new Map(db),delete:async keys=>keys.forEach(k=>db.delete(k))};
  const original=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;return ok({data:[]})};
  try{
    const env={RAPIDAPI_KEY:"test-only",ALLOWED_ORIGIN:"https://kaidenzb3.github.io"};
    const object=new worker.SportScoreCache({storage},env);
    const request=new Request("https://proxy/?action=live&client=old-version");
    const responses=await Promise.all([object.fetch(request),object.fetch(request)]);
    assert.equal(calls,1);assert.equal(responses[0].headers.get("X-Data-Stale"),"0");
    assert.ok(responses[0].headers.get("X-Data-Timestamp"));
    await new worker.SportScoreCache({storage},env).fetch(request);assert.equal(calls,1);
    env.SPORTSCORE_CACHE={idFromName:()=>"one",get:()=>({fetch:r=>object.fetch(r)})};
    const response=await worker.default.fetch(new Request(request,{headers:{Origin:env.ALLOWED_ORIGIN}}),env);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"),env.ALLOWED_ORIGIN);
    assert.match(response.headers.get("Access-Control-Expose-Headers"),/Retry-After/);
    assert.equal((await worker.default.fetch(new Request(request,{headers:{Origin:"https://other.example"}}),env)).status,403);
    assert.equal((await worker.default.fetch(new Request(request,{method:"POST"}),env)).status,405);
  }finally{global.fetch=original}
});
