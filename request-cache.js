/* Shared policy for the browser and the secure proxy. No immediate retries. */
(function(root){
  const TTL={live:300000,date:1800000,stats:300000,points:300000,markets:900000,event:300000,rankings:3600000};
  const STALE=24*60*60*1000;
  function retryDelay(value,now=Date.now()){
    if(value==null||String(value).trim()==="")return 0;
    const seconds=Number(value);
    return Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(value)-now)||0;
  }
  function create({read,write,fetcher,now=Date.now}){
    const pending=new Map();let queue=Promise.resolve();
    async function run(key,action){
      const time=now(),cached=await read(key),state=await read("cooldown")||{};
      if(cached&&time-cached.at<(TTL[action]||TTL.live))return {...cached,stale:false};
      const fallback=()=>cached&&now()-cached.at<STALE?{...cached,stale:true,retryAt:state.until}:null;
      if(state.until>time){
        const old=fallback();if(old)return old;
        throw Object.assign(new Error("SportScore is cooling down. Please try later."),{status:state.status||429,retryAt:state.until});
      }
      try{
        const response=await fetcher(key);
        if(!response.ok){
          const err=new Error(`SportScore returned ${response.status}`);
          err.status=response.status;err.retryAfter=response.headers.get("Retry-After");throw err;
        }
        const body=await response.json();
        if(body==null||typeof body!=="object"||body.error)throw new Error("Invalid SportScore response");
        const at=Number(response.headers.get("X-Data-Timestamp"))||now();
        const entry={body,at};
        await write(key,entry);
        const stale=response.headers.get("X-Data-Stale")==="1";
        if(stale){
          state.until=now()+Math.max(300000,retryDelay(response.headers.get("Retry-After"),now()));
          state.status=429;await write("cooldown",state);
        }else await write("cooldown",{failures:0,until:0});
        return {...entry,stale};
      }catch(err){
        const failures=(state.failures||0)+1;
        const base=err.status===429?300000:60000;
        state.failures=failures;state.status=err.status||503;
        state.until=now()+Math.max(retryDelay(err.retryAfter,now()),Math.min(3600000,base*2**Math.min(failures-1,6)));
        await write("cooldown",state);
        const old=fallback();if(old)return old;
        err.retryAt=state.until;throw err;
      }
    }
    return {get(key,action){
      if(pending.has(key))return pending.get(key);
      // Serialize different keys too: a 429 stops the rest of a date batch.
      const task=queue.then(()=>run(key,action));queue=task.catch(()=>{});
      pending.set(key,task);task.finally(()=>pending.delete(key)).catch(()=>{});
      return task;
    }};
  }
  const api={create,retryDelay,TTL,STALE};
  root.RequestCache=api;
  if(typeof module!=="undefined")module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
