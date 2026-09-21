const assert=require("node:assert/strict");
const {test}=require("node:test");
const Decider=require("./decider.js");
const Provider=require("./provider.js");

const match = games => ({score:{games}});
const frozen={index:1};
const filters={maxSet3FavOdds:1.60,minSnapbackRecoveryPct:80,betterRankingRequired:true,betterSurfaceEloRequired:false};

test("Decider phases follow the original favourite through three sets",()=>{
  assert.equal(Decider.stage(match([[4,3],[6,2]]),1),"SETUP FORMING");
  assert.equal(Decider.stage(match([[4,6],[6,4]]),1),"DECIDER");
  assert.equal(Decider.stage(match([[6,6],[4,4]]),1),"NONE");
});

test("snapback math and research filters",()=>{
  const snapshots={preMatchFavOdds:1.5,afterSet1FavOdds:2.5,startSet3FavOdds:1.55};
  const m=Decider.metrics(snapshots);
  assert.ok(Math.abs(m.snapbackRecoveryPct-91.9354839)<0.001);
  assert.ok(Math.abs(m.distanceFromOpenPct-3.3333333)<0.001);
  const s=Decider.evaluate({match:match([[4,6],[6,4]]),frozen,snapshots,ranking:30,surfaceElo:80,filters});
  assert.equal(s.state,"STRONG");
  assert.equal(Decider.evaluate({match:match([[4,6],[6,4]]),frozen,snapshots:{},ranking:30,surfaceElo:80,filters}).state,"WAITING FOR PRICE");
  assert.equal(Decider.evaluate({match:match([[4,6],[6,4]]),frozen,snapshots,ranking:-10,surfaceElo:80,filters}).state,"PASS");
});

test("profit only includes priced and graded underdog signals",()=>{
  const s=Decider.summary([{result:"win",underdogOdds:3},{result:"loss",underdogOdds:2.5},{result:null,underdogOdds:2}]);
  assert.equal(s.signals,3);assert.equal(s.wins,1);assert.equal(s.losses,1);
  assert.equal(s.unitsProfit,1);assert.equal(s.roi,50);
});

test("Cito match adapter maps WTA live sets, points, server, and rank",()=>{
  const raw={match_id:"123",tour:"WTA",draw:"singles",player1:{name:"A",rank:10},player2:{name:"B",rank:20},sets:[[6,4],[3,2]],points:[30,15],serving:"player1",start_time:"2026-09-21T12:00:00Z"};
  const m=Provider.normalize(raw);
  assert.equal(Provider.singles(raw),true);
  assert.equal(m.id,"123");assert.deepEqual(m.score.games,[[6,3],[4,2]]);
  assert.deepEqual(m.score.points,[30,15]);assert.equal(m.score.server,1);
  assert.equal(m.players.p1.rank,10);assert.equal(m.scheduled_time,raw.start_time);
  assert.equal(Provider.singles({...raw,draw:"doubles"}),false);
});
