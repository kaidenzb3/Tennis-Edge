const {test}=require("node:test"),assert=require("node:assert/strict");
const Schedule=require("./schedule.js");
const now=Date.parse("2026-10-22T18:00:00Z");
test("October 7 fixtures stay off current boards even if the old cache was just rewritten",()=>{
  const data=[{id:"old",start_at:"2026-10-07T18:00:00Z"},{id:"next",start_at:"2026-10-22T20:00:00Z"}];
  assert.deepEqual(Schedule.cachedUpcoming({time:now,data},now).map(m=>m.id),["next"]);
});
test("old cache expires even when its fixtures have future dates",()=>{
  const data=[{start_at:"2026-10-23T18:00:00Z"}];
  assert.deepEqual(Schedule.cachedUpcoming({time:now-15*86400000,data},now),[]);
  assert.equal(Schedule.cachedUpcoming({time:now-3600000,data},now).length,1);
});
test("started, completed, live, cancelled, and undated fixtures are excluded",()=>{
  for(const m of [{start_at:new Date(now).toISOString()},{start_at:"2026-10-07"},{event_date:"2026-10-07"},{},
    ...["live","inprogress","finished","completed","cancelled","retired"].map(status=>({status,start_at:"2026-10-23"})),
    {winner:{name:"A"},start_at:"2026-10-23"}])assert.equal(Schedule.isUpcoming(m,now),false);
  assert.equal(Schedule.isUpcoming({event_date:"2026-10-23"},now),true);
});
test("fixture aliases, numeric timestamps, and timezone offsets retain valid future games",()=>{
  for(const m of [{scheduled_time:(now+3600000)/1000},{start_at:String((now+3600000)/1000)},
    {_fixture_start_time:now+3600000},{start_at:"2026-10-22T15:00:00-06:00"}])assert.equal(Schedule.isUpcoming(m,now),true);
});
test("SportScore timestamps already carrying UTC or offsets remain valid",()=>{
  const SportScore=require("./sportscore.js");
  for(const start_at of ["2026-10-22T21:00:00Z","2026-10-22T15:00:00-06:00","2026-10-22 21:00:00"]){
    const match=SportScore.event({id:1,start_at});
    assert.equal(new Date(match.start_at).getTime(),Date.parse("2026-10-22T21:00:00Z"));
    assert.equal(Schedule.isUpcoming(match,now),true);
  }
});
