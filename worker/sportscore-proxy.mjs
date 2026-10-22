import "../request-cache.js";

const policy=globalThis.RequestCache;
export function route(url){
  const action=url.searchParams.get("action"),id=url.searchParams.get("id"),date=url.searchParams.get("date");
  if(action==="live")return {action,path:"/sports/2/events/live"};
  if(action==="date"&&/^\d{4}-\d{2}-\d{2}$/.test(date||"")){
    const day=Date.parse(date+"T00:00:00Z"),today=Date.parse(new Date().toISOString().slice(0,10)+"T00:00:00Z");
    if(Math.abs(day-today)<=3*86400000)return {action,path:`/sports/2/events/date/${date}`};
  }
  const suffix={stats:"statistics",points:"incidents",markets:"markets"}[action];
  if(suffix&&/^\d{1,12}$/.test(id||""))return {action,path:`/events/${id}/${suffix}`};
  throw new Error("Unsupported SportScore request");
}

// A single named Durable Object coordinates all regions, tabs, and visitors.
export class SportScoreCache{
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;
    this.cache=policy.create({
      read:key=>ctx.storage.get(key),
      write:async(key,value)=>{
        await ctx.storage.put(key,value);
        // Bound detail/date storage; expired entries are removed on writes.
        const entries=await ctx.storage.list();
        const records=[...entries].filter(([,v])=>v&&typeof v.at==="number").sort((a,b)=>b[1].at-a[1].at);
        const old=records.filter(([,v],i)=>i>=200||Date.now()-v.at>policy.STALE);
        if(old.length)await ctx.storage.delete(old.map(([k])=>k));
      },
      fetcher:async path=>{
        // Space cache misses even when they concern different endpoints.
        const previous=await ctx.storage.get("last-call")||0;
        const wait=Math.max(0,1000-(Date.now()-previous));
        if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
        await ctx.storage.put("last-call",Date.now());
        return fetch(`https://sportscore1.p.rapidapi.com${env.SPORTSCORE_API_PREFIX||""}${path}`,{
          headers:{"X-RapidAPI-Key":env.RAPIDAPI_KEY,"X-RapidAPI-Host":"sportscore1.p.rapidapi.com"},
          signal:AbortSignal.timeout(15000)
        });
      }
    });
  }
  async fetch(request){
    let target;try{target=route(new URL(request.url))}catch(_){return Response.json({error:"Unsupported request"},{status:400})}
    if(!this.env.RAPIDAPI_KEY)return Response.json({error:"SportScore proxy is not configured"},{status:503});
    try{
      const value=await this.cache.get(target.path,target.action);
      const headers={"Cache-Control":"no-store","X-Data-Timestamp":String(value.at),"X-Data-Stale":value.stale?"1":"0"};
      if(value.stale)headers["Retry-After"]=String(Math.max(1,Math.ceil(((value.retryAt||Date.now()+300000)-Date.now())/1000)));
      return Response.json(value.body,{headers});
    }catch(err){return Response.json({error:err.status===429?"SportScore rate limit reached; please try later.":"SportScore temporarily unavailable"},{
      status:err.status===429?429:503,headers:{"Cache-Control":"no-store","Retry-After":String(Math.max(1,Math.ceil(((err.retryAt||Date.now()+60000)-Date.now())/1000)))}
    })}
  }
}

export default {
  async fetch(request,env){
    const origin=request.headers.get("Origin");
    if(origin&&origin!==env.ALLOWED_ORIGIN)return new Response("Origin not allowed",{status:403});
    const cors={"Access-Control-Allow-Origin":env.ALLOWED_ORIGIN,"Vary":"Origin","Access-Control-Allow-Methods":"GET, OPTIONS","Access-Control-Expose-Headers":"Retry-After, X-Data-Timestamp, X-Data-Stale","Cache-Control":"no-store"};
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
    if(request.method!=="GET")return new Response("Method not allowed",{status:405,headers:cors});
    try{route(new URL(request.url))}catch(_){return Response.json({error:"Unsupported request"},{status:400,headers:cors})}
    const stub=env.SPORTSCORE_CACHE.get(env.SPORTSCORE_CACHE.idFromName("tennis-edge-sportscore-v1"));
    const response=await stub.fetch(request);
    const result=new Response(response.body,response);
    for(const [key,value] of Object.entries(cors))result.headers.set(key,value);
    return result;
  }
};
