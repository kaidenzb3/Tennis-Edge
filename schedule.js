/* Keep expired fixtures out of current boards without deleting research history. */
(function(root){
  const MAX_AGE=24*60*60*1000;
  function startRaw(m){return m?.scheduled_time||m?._fixture_start_time||m?.start_time||m?.start_at||m?.scheduled_at||m?.scheduled||m?.date_time||m?.datetime||m?.match_time||m?.time||m?.starts_at||m?.start_date||null}
  function startDate(m){
    let raw=startRaw(m);if(!raw)return null;
    if(typeof raw==="number"||/^\d{10,13}$/.test(String(raw))){raw=Number(raw);if(raw<1e12)raw*=1000}
    const date=new Date(raw);return Number.isNaN(date.getTime())?null:date;
  }
  function isUpcoming(m,now=Date.now()){
    const status=typeof m?.status==="object"?m.status?.type:m?.status;
    if(m?.winner||/inprogress|live|finished|completed|cancelled|canceled|walkover|retired/i.test(status||""))return false;
    const start=startDate(m);if(start)return start.getTime()>now;
    const day=m?._fixture_event_date||m?.event_date;
    if(/^\d{4}-\d{2}-\d{2}$/.test(String(day||"")))return day>=new Date(now).toISOString().slice(0,10);
    // Undated fixtures cannot be verified as current upcoming matches.
    return false;
  }
  function cachedUpcoming(cache,now=Date.now()){
    if(!cache||!Number.isFinite(cache.time)||now-cache.time>MAX_AGE||!Array.isArray(cache.data))return [];
    return cache.data.filter(m=>isUpcoming(m,now));
  }
  const api={startRaw,startDate,isUpcoming,cachedUpcoming};root.MatchSchedule=api;
  if(typeof module!=="undefined")module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:this);
