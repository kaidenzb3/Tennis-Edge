(function(root){
  "use strict";
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  function pmf(k,lambda){
    if(k<0||!Number.isInteger(k)||lambda<=0)return 0;
    let factorial=1;
    for(let i=2;i<=k;i++)factorial*=i;
    return Math.exp(-lambda)*Math.pow(lambda,k)/factorial;
  }
  function setProjection(matchWinProbability){
    const p=clamp(Number(matchWinProbability)||.5,.08,.92);
    const favouriteLambda=clamp(3.55+3.4*(p-.5),2.2,5.3);
    const opponentLambda=clamp(3.55-3.4*(p-.5),2.2,5.3);
    const legal=[];
    for(let loser=0;loser<=4;loser++){
      legal.push({fav:6,opp:loser});
      legal.push({fav:loser,opp:6});
    }
    legal.push({fav:7,opp:5},{fav:5,opp:7},{fav:7,opp:6},{fav:6,opp:7});
    const weighted=legal.map(score=>({...score,weight:pmf(score.fav,favouriteLambda)*pmf(score.opp,opponentLambda)}));
    const total=weighted.reduce((sum,x)=>sum+x.weight,0)||1;
    const scores=weighted.map(x=>({fav:x.fav,opp:x.opp,probability:x.weight/total})).sort((a,b)=>b.probability-a.probability);
    const favouriteSetWin=scores.filter(x=>x.fav>x.opp).reduce((sum,x)=>sum+x.probability,0);
    const closeSetMass=scores.filter(x=>Math.min(x.fav,x.opp)>=4).reduce((sum,x)=>sum+x.probability,0);
    return {favouriteSetWin,closeSetMass,scores};
  }
  function setWinFromMatch(matchWinProbability){
    const target=clamp(Number(matchWinProbability)||.5,.08,.92);
    let low=0,high=1;
    for(let i=0;i<60;i++){
      const mid=(low+high)/2;
      const bestOfThree=mid*mid+2*mid*mid*(1-mid);
      if(bestOfThree<target)low=mid;else high=mid;
    }
    return (low+high)/2;
  }
  function matchProjection(matchWinProbability,stageAdjustments=[0,0,0]){
    const p=clamp(Number(matchWinProbability)||.5,.08,.92);
    const baseline=setWinFromMatch(p);
    const setWins=[0,1,2].map(i=>clamp(baseline+(Number(stageAdjustments[i])||0),.08,.92));
    const [setOne,setTwo,setThree]=setWins;
    const twoZero=setOne*setTwo;
    const decidingSet=setOne*(1-setTwo)+(1-setOne)*setTwo;
    const twoOne=decidingSet*setThree;
    const opponentTwoZero=(1-setOne)*(1-setTwo);
    const opponentTwoOne=decidingSet*(1-setThree);
    return {
      twoZero,twoOne,opponentTwoZero,opponentTwoOne,decidingSet,
      opponentWins:opponentTwoZero+opponentTwoOne,
      projectedMatchWin:twoZero+twoOne,
      setWin:baseline,
      setWins,
      setStages:setWins.map(setProjection),
      set:setProjection(setOne)
    };
  }
  const api={pmf,setProjection,setWinFromMatch,matchProjection};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  root.TennisPoisson=api;
})(typeof globalThis!=="undefined"?globalThis:this);
