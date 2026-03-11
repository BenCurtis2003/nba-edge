// lib/engine.js
const MIN_EV_EDGE = 1.5;
const MIN_EV_EDGE_LONGSHOT = 6;
const KELLY_FRACTION = 0.25;
const CONVICTION_THRESHOLD = 70;
const STARTING_BANKROLL = 100;

function americanToDecimal(odds) {
  return odds < 0 ? (100 / (-odds) + 1) : (odds / 100 + 1);
}
function americanToImplied(odds) {
  return odds < 0 ? (-odds) / (-odds + 100) : 100 / (odds + 100);
}
function noVigProb(homeOdds, awayOdds) {
  const hi = americanToImplied(homeOdds);
  const ai = americanToImplied(awayOdds);
  const total = hi + ai;
  return { home: hi / total, away: ai / total };
}
function kellyPct(edge, decOdds) {
  if(edge <= 0 || decOdds <= 1) return 0;
  const full = (edge * decOdds) / (decOdds - 1);
  return Math.min(full * KELLY_FRACTION * 100, 8);
}

export async function fetchLiveOdds(apiKey) {
  const books = "draftkings,fanduel,betmgm,caesars,pointsbet,betrivers,lowvig,betonlineag,bovada,mybookieag,betus,pinnacle";
  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us,us2&markets=h2h,spreads,totals&bookmakers=${books}&oddsFormat=american`;
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) { console.error(`[OddsAPI] HTTP ${res.status}`); return null; }
  const data = await res.json();
  if(data.message) { console.error(`[OddsAPI] ${data.message}`); return null; }
  console.log(`[OddsAPI] ${data.length} games fetched`);
  return data;
}

export async function fetchScores(apiKey) {
  if(apiKey) {
    try {
      const res = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/scores/?apiKey=${apiKey}&daysFrom=3`);
      if(res.ok) {
        const data = await res.json();
        if(!data.message && data.some(g => g.completed)) return data;
      }
    } catch(e) {}
  }
  return fetchESPNScores();
}

async function fetchESPNScores() {
  const makeDateStr = d => new Date(Date.now()-d*86400000).toISOString().slice(0,10).replace(/-/g,"");
  const urls = [
    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${makeDateStr(1)}`,
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${makeDateStr(2)}`,
  ];
  const scores = [];
  for(const url of urls) {
    try {
      const res = await fetch(url);
      if(!res.ok) continue;
      const data = await res.json();
      for(const event of (data.events||[])) {
        const comp = event.competitions?.[0];
        const home = comp?.competitors?.find(c=>c.homeAway==="home");
        const away = comp?.competitors?.find(c=>c.homeAway==="away");
        const status = comp?.status?.type;
        if(!home||!away) continue;
        if(!(status?.completed||status?.state==="post")) continue;
        scores.push({ home_team:home.team.displayName, away_team:away.team.displayName, completed:true, commence_time:event.date, scores:[{name:home.team.displayName,score:home.score},{name:away.team.displayName,score:away.score}] });
      }
    } catch(e) {}
  }
  const seen = new Set();
  return scores.filter(s => { const k=`${normTeam(s.home_team)}|${normTeam(s.away_team)}`; if(seen.has(k)) return false; seen.add(k); return true; });
}

export function extractEVBets(games) {
  const bets = [];
  for(const game of games) {
    const gameLabel = `${game.away_team} @ ${game.home_team}`;
    const bookmakers = game.bookmakers || [];
    const pinnBook = bookmakers.find(b => b.key === "pinnacle");
    const h2h = {}, spreads = {}, totals = {};
    for(const bk of bookmakers) {
      for(const mkt of (bk.markets||[])) {
        for(const o of (mkt.outcomes||[])) {
          if(mkt.key==="h2h") { if(!h2h[o.name]) h2h[o.name]={}; h2h[o.name][bk.key]=o.price; }
          if(mkt.key==="spreads") { if(!spreads[o.name]) spreads[o.name]={}; spreads[o.name][bk.key]={price:o.price,point:o.point}; }
          if(mkt.key==="totals") { if(!totals[o.name]) totals[o.name]={}; totals[o.name][bk.key]={price:o.price,point:o.point}; }
        }
      }
    }

    function consensusProb(marketKey, nameA, nameB) {
      const oddsA=[], oddsB=[];
      for(const bk of bookmakers) {
        if(bk.key==="pinnacle") continue;
        const mkt = bk.markets?.find(m=>m.key===marketKey);
        if(!mkt) continue;
        const a = mkt.outcomes.find(o=>o.name===nameA);
        const b = mkt.outcomes.find(o=>o.name===nameB);
        if(a&&b) { oddsA.push(a.price); oddsB.push(b.price); }
      }
      if(!oddsA.length) return null;
      const avgA = oddsA.reduce((s,v)=>s+v,0)/oddsA.length;
      const avgB = oddsB.reduce((s,v)=>s+v,0)/oddsB.length;
      return noVigProb(avgA, avgB);
    }

    function getTrueProbs_h2h() {
      const pinnH2h = pinnBook?.markets?.find(m=>m.key==="h2h");
      if(pinnH2h) {
        const pH = pinnH2h.outcomes.find(o=>o.name===game.home_team);
        const pA = pinnH2h.outcomes.find(o=>o.name===game.away_team);
        if(pH&&pA) return noVigProb(pH.price, pA.price);
      }
      return consensusProb("h2h", game.home_team, game.away_team);
    }

    function getTrueProbs_total() {
      const pinnTotal = pinnBook?.markets?.find(m=>m.key==="totals");
      if(pinnTotal) {
        const pO = pinnTotal.outcomes.find(o=>o.name==="Over");
        const pU = pinnTotal.outcomes.find(o=>o.name==="Under");
        if(pO&&pU) return noVigProb(pO.price, pU.price);
      }
      return consensusProb("totals", "Over", "Under");
    }

    function bestLine(marketObj, key) {
      let bestOdds=null, bestBook=null;
      for(const [bk,val] of Object.entries(marketObj[key]||{})) {
        if(bk==="pinnacle") continue;
        const price = typeof val==="object" ? val.price : val;
        if(bestOdds===null||price>bestOdds) { bestOdds=price; bestBook=bk; }
      }
      return { bestOdds, bestBook };
    }

    function tryBet(bet) {
      const bookImplied = americanToImplied(bet.bestOdds);
      const edge = bet.trueProb - bookImplied;
      if(edge < MIN_EV_EDGE/100) return;
      if(bet.bestOdds > 125 && edge < MIN_EV_EDGE_LONGSHOT/100) return;
      const decOdds = americanToDecimal(bet.bestOdds);
      const kPct = kellyPct(edge, decOdds);
      if(kPct <= 0) return;
      bets.push({ ...bet, edge:+(edge*100).toFixed(2), ev:+((edge/bookImplied)*100).toFixed(1), kellyPct:+kPct.toFixed(2), ourProbability:+(bet.trueProb*100).toFixed(1), bookImplied:+(bookImplied*100).toFixed(1) });
    }

    const mlProbs = getTrueProbs_h2h();
    if(mlProbs) {
      for(const [team, trueProb, isHome] of [[game.home_team,mlProbs.home,true],[game.away_team,mlProbs.away,false]]) {
        const { bestOdds, bestBook } = bestLine(h2h, team);
        if(!bestOdds) continue;
        tryBet({ id:`ev|ml|${gameLabel}|${team}`, type:"Moneyline", betType:"Moneyline", game:gameLabel, selection:`${team} ML`, gameTime:game.commence_time, bestOdds, bestBook, trueProb, isHome });
      }
      for(const [team, trueProb, isHome] of [[game.home_team,mlProbs.home,true],[game.away_team,mlProbs.away,false]]) {
        const { bestOdds, bestBook } = bestLine(spreads, team);
        if(!bestOdds) continue;
        const point = spreads[team]?.[bestBook]?.point;
        tryBet({ id:`ev|spread|${gameLabel}|${team}`, type:"Spread", betType:"Spread", game:gameLabel, selection:`${team} ${point>=0?"+":""}${point}`, gameTime:game.commence_time, bestOdds, bestBook, trueProb, isHome });
      }
    }

    const totalProbs = getTrueProbs_total();
    if(totalProbs) {
      for(const [side, trueProb] of [["Over",totalProbs.home],["Under",totalProbs.away]]) {
        const { bestOdds, bestBook } = bestLine(totals, side);
        if(!bestOdds) continue;
        const point = totals[side]?.[bestBook]?.point;
        tryBet({ id:`ev|total|${gameLabel}|${side}`, type:"Game Total", betType:"Game Total", game:gameLabel, selection:`${side} ${point}`, gameTime:game.commence_time, bestOdds, bestBook, trueProb });
      }
    }
  }
  return bets.sort((a,b)=>b.ev-a.ev);
}

function normTeam(name="") { return name.toLowerCase().split(" ").pop().replace(/[^a-z]/g,""); }

const STANDINGS_FALLBACK = {
  "Boston Celtics":{wins:54,losses:14},"Cleveland Cavaliers":{wins:54,losses:14},
  "Oklahoma City Thunder":{wins:52,losses:16},"Houston Rockets":{wins:42,losses:26},
  "Golden State Warriors":{wins:34,losses:33},"Los Angeles Lakers":{wins:33,losses:34},
  "Memphis Grizzlies":{wins:37,losses:31},"Denver Nuggets":{wins:36,losses:31},
  "Minnesota Timberwolves":{wins:43,losses:25},"New York Knicks":{wins:43,losses:24},
  "Indiana Pacers":{wins:35,losses:33},"Milwaukee Bucks":{wins:26,losses:41},
  "Sacramento Kings":{wins:29,losses:39},"Los Angeles Clippers":{wins:33,losses:35},
  "Dallas Mavericks":{wins:28,losses:40},"Phoenix Suns":{wins:22,losses:46},
  "Miami Heat":{wins:28,losses:41},"Chicago Bulls":{wins:22,losses:46},
  "Orlando Magic":{wins:35,losses:33},"Atlanta Hawks":{wins:28,losses:40},
  "Brooklyn Nets":{wins:19,losses:50},"Toronto Raptors":{wins:20,losses:48},
  "New Orleans Pelicans":{wins:19,losses:50},"Utah Jazz":{wins:19,losses:50},
  "Detroit Pistons":{wins:24,losses:44},"Charlotte Hornets":{wins:18,losses:51},
  "Washington Wizards":{wins:13,losses:56},"Portland Trail Blazers":{wins:18,losses:51},
  "San Antonio Spurs":{wins:22,losses:47},"Philadelphia 76ers":{wins:21,losses:48},
};

async function fetchTeamData(teamName) {
  try {
    const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams");
    if(res.ok) {
      const data = await res.json();
      const team = data.sports?.[0]?.leagues?.[0]?.teams?.find(t=>t.team.displayName===teamName||normTeam(t.team.displayName)===normTeam(teamName));
      if(team) {
        const record = team.team.record?.items?.[0]?.summary||"0-0";
        const [w,l] = record.split("-").map(Number);
        return { wins:w||0, losses:l||0 };
      }
    }
  } catch(e) {}
  return STANDINGS_FALLBACK[teamName]||{wins:0,losses:0};
}

export async function buildConvictionPlays(games) {
  const plays = [];
  for(const game of games) {
    const home=game.home_team, away=game.away_team;
    const [homeRec,awayRec] = await Promise.all([fetchTeamData(home),fetchTeamData(away)]);
    const homeTotal=homeRec.wins+homeRec.losses||1;
    const awayTotal=awayRec.wins+awayRec.losses||1;
    for(const [team,opp,record,oppRecord,isHome] of [[home,away,homeRec,awayRec,true],[away,home,awayRec,homeRec,false]]) {
      const total=record.wins+record.losses||1;
      const winPct=record.wins/total;
      const oppWinPct=oppRecord.wins/(oppRecord.wins+oppRecord.losses||1);
      const winRateScore=Math.round(40+winPct*55);
      const recordEdgeScore=winPct>oppWinPct?Math.round(60+(winPct-oppWinPct)*100):Math.round(40-(oppWinPct-winPct)*60);
      const homeScore=isHome?72:45;
      const signals=[
        {key:"winRate",label:"Season Win Rate",weight:0.22,score:winRateScore},
        {key:"netRating",label:"Record vs Opponent",weight:0.20,score:Math.max(35,Math.min(95,recordEdgeScore))},
        {key:"rest",label:"Rest Advantage",weight:0.18,score:60},
        {key:"ats",label:"ATS Record",weight:0.14,score:55},
        {key:"home",label:"Home/Away Factor",weight:0.12,score:homeScore},
        {key:"h2h",label:"Head-to-Head",weight:0.08,score:55},
        {key:"pace",label:"Pace Mismatch",weight:0.06,score:52},
      ];
      const finalScore=Math.round(signals.reduce((s,sig)=>s+sig.score*sig.weight,0));
      const tier=finalScore>=75?"HIGH":finalScore>=60?"MEDIUM":"WATCHLIST";
      let mlOdds=null,mlBook=null;
      for(const bk of (game.bookmakers||[])) {
        const h2h=bk.markets?.find(m=>m.key==="h2h");
        const outcome=h2h?.outcomes?.find(o=>o.name===team);
        if(outcome&&(mlOdds===null||outcome.price>mlOdds)){mlOdds=outcome.price;mlBook=bk.key;}
      }
      plays.push({ id:`conviction|${away}@${home}|${team}|ML`, type:"Conviction Play", betType:"Moneyline", game:`${away} @ ${home}`, selection:`${team} ML`, gameTime:game.commence_time, convictionScore:finalScore, tier, isHome, bestOdds:mlOdds, bestBook:mlBook, teamRecord:`${record.wins}-${record.losses}`, oppRecord:`${oppRecord.wins}-${oppRecord.losses}`, signals, ourProbability:+(winPct*100).toFixed(1), kellyPct:2 });
    }
  }
  return plays.sort((a,b)=>b.convictionScore-a.convictionScore);
}

export function placeBets(evBets, convictionPlays, currentBankroll, existingHistory) {
  const today=new Date().toDateString();
  const placedToday=new Set(existingHistory.filter(h=>new Date(h.date).toDateString()===today).map(h=>h.betId));
  const newEntries=[];
  let bankroll=currentBankroll;
  for(const bet of evBets) {
    if(placedToday.has(bet.id)) continue;
    const wagerAmt=+(bankroll*(bet.kellyPct/100)).toFixed(2);
    if(wagerAmt<0.01) continue;
    const payout=+(wagerAmt*(americanToDecimal(bet.bestOdds)-1)).toFixed(2);
    newEntries.push({ id:`${bet.id}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, betId:bet.id, date:new Date().toISOString(), game:bet.game, selection:bet.selection, type:bet.type, betType:bet.betType, bestOdds:bet.bestOdds, bestBook:bet.bestBook, kellyPct:bet.kellyPct, wagerAmt, potentialPayout:payout, ev:bet.ev, edge:bet.edge, ourProbability:bet.ourProbability, gameTime:bet.gameTime, status:"pending", bankrollBefore:+bankroll.toFixed(2), bankrollAfter:+bankroll.toFixed(2), result:null, isConviction:false });
    placedToday.add(bet.id);
  }
  for(const play of convictionPlays) {
    if(play.convictionScore<CONVICTION_THRESHOLD) continue;
    if(!play.bestOdds) continue;
    if(placedToday.has(play.id)) continue;
    const wagerAmt=+(bankroll*0.02).toFixed(2);
    const payout=+(wagerAmt*(americanToDecimal(play.bestOdds)-1)).toFixed(2);
    newEntries.push({ id:`${play.id}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, betId:play.id, date:new Date().toISOString(), game:play.game, selection:play.selection, type:"Conviction Play", betType:play.betType, bestOdds:play.bestOdds, bestBook:play.bestBook, kellyPct:2, wagerAmt, potentialPayout:payout, ev:null, edge:null, ourProbability:play.ourProbability, convictionScore:play.convictionScore, gameTime:play.gameTime, status:"pending", bankrollBefore:+bankroll.toFixed(2), bankrollAfter:+bankroll.toFixed(2), result:null, isConviction:true });
    placedToday.add(play.id);
  }
  return { newEntries, bankroll };
}

export function resolveHistory(history, scores) {
  let bankroll=STARTING_BANKROLL;
  let changed=false;
  const updated=history.map(entry => {
    if(entry.status!=="pending") { if(entry.bankrollAfter) bankroll=entry.bankrollAfter; return entry; }
    const gameScore=scores.find(s=>normTeamMatch(entry.game,s.home_team||"",s.away_team||""));
    const gameAge=(Date.now()-new Date(entry.gameTime||entry.date))/3600000;
    const isMockId=/^(ml-fav|sp-fav|tot-)/.test(entry.betId||"");
    if(!gameScore||!gameScore.completed) {
      if(isMockId) return {...entry,status:"removed"};
      if(gameAge>4) {
        const prob=(entry.ourProbability||50)/100;
        const won=Math.random()<prob;
        const wagerAmt=entry.wagerAmt>0?entry.wagerAmt:+(bankroll*0.02).toFixed(2);
        const payout=+(wagerAmt*(americanToDecimal(entry.bestOdds||-110)-1)).toFixed(2);
        if(won) bankroll+=payout; else bankroll-=wagerAmt;
        bankroll=Math.max(0,+bankroll.toFixed(2));
        changed=true;
        return {...entry,status:won?"won":"lost",wagerAmt,potentialPayout:payout,bankrollBefore:+bankroll.toFixed(2),bankrollAfter:bankroll,estimatedResult:true};
      }
      return entry;
    }
    const hScore=gameScore.scores?.find(s=>normTeam(s.name)===normTeam(gameScore.home_team))?.score;
    const aScore=gameScore.scores?.find(s=>normTeam(s.name)===normTeam(gameScore.away_team))?.score;
    if(hScore==null||aScore==null) return entry;
    const h=parseInt(hScore),a=parseInt(aScore);
    const resolveType=entry.betType||entry.type;
    let won=null;
    if(resolveType==="Moneyline") { const homeWon=h>a; const sel=entry.selection.toLowerCase().replace(/ ml$/i,"").trim(); won=sel.includes(normTeam(gameScore.home_team))?homeWon:!homeWon; }
    else if(resolveType==="Spread") { const m=entry.selection.match(/([+-]?\d+\.?\d*)\s*$/); if(m){ const spread=parseFloat(m[1]); const margin=entry.isHome?(h-a):(a-h); won=margin+spread>0; } }
    else if(resolveType==="Game Total") { const isOver=entry.selection.toLowerCase().includes("over"); const lm=entry.selection.match(/(\d+\.?\d*)/); if(lm){ won=isOver?(h+a)>parseFloat(lm[1]):(h+a)<parseFloat(lm[1]); } }
    if(won===null) return entry;
    const wagerAmt=entry.wagerAmt>0?entry.wagerAmt:+(bankroll*0.02).toFixed(2);
    const payout=+(wagerAmt*(americanToDecimal(entry.bestOdds||-110)-1)).toFixed(2);
    if(won) bankroll+=payout; else bankroll-=wagerAmt;
    bankroll=Math.max(0,+bankroll.toFixed(2));
    changed=true;
    return {...entry,status:won?"won":"lost",wagerAmt,potentialPayout:payout,bankrollBefore:+bankroll.toFixed(2),bankrollAfter:bankroll};
  });
  return { history:updated.filter(h=>h.status!=="removed"), bankroll, changed };
}

function normTeamMatch(entryGame="",scoreHome="",scoreAway="") {
  const hN=normTeam(scoreHome),aN=normTeam(scoreAway);
  const g=entryGame.toLowerCase();
  if(g.includes(hN)&&g.includes(aN)) return true;
  const gWords=g.split(/[ @]+/).filter(w=>w.length>3);
  return gWords.some(w=>scoreHome.toLowerCase().includes(w))&&gWords.some(w=>scoreAway.toLowerCase().includes(w));
}
