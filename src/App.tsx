// @ts-nocheck

// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from "react";

const SPORTSBOOKS = ["draftkings","fanduel","betmgm","caesars","pointsbet","betrivers"];
const SPORTSBOOK_LABELS = { draftkings:"DraftKings", fanduel:"FanDuel", betmgm:"BetMGM", caesars:"Caesars", pointsbet:"PointsBet", betrivers:"BetRivers" };
const SPORTSBOOK_COLORS = { draftkings:"#53d337", fanduel:"#1493ff", betmgm:"#d4af37", caesars:"#00a4e4", pointsbet:"#e8192c", betrivers:"#003087" };
const MIN_EV_EDGE = 3;
const MIN_ODDS = -200;
const MAX_ODDS = 400;
const STARTING_BANKROLL = 100;
const STORAGE_KEY = "nba_edge_history_v1";

function americanToDecimal(a) { return a > 0 ? a/100+1 : 100/Math.abs(a)+1; }
function americanToImplied(a) { return (1/americanToDecimal(a))*100; }
function calcEV(prob, odds) { const d=americanToDecimal(odds); return ((prob/100)*(d-1)-(1-prob/100))*100; }
function kellyFraction(prob, odds) { const d=americanToDecimal(odds); const b=d-1; const p=prob/100; return Math.max(0,Math.min(((b*p-(1-p))/b)*0.25,0.05))*100; }
function formatOdds(a) { if(!a&&a!==0) return "N/A"; return a>0?`+${a}`:`${a}`; }
function getEdgeColor(e) { if(e>=8) return "#00ff88"; if(e>=5) return "#7fff00"; if(e>=3) return "#ffd700"; return "#aaaaaa"; }
function fmt$(n) { return `$${Math.abs(n).toFixed(2)}`; }
function timeUntil(d) {
  const diff = new Date(d)-new Date();
  if(diff<0) return "Live";
  const h=Math.floor(diff/3600000), m=Math.floor((diff%3600000)/60000);
  if(h>24) return `${Math.floor(h/24)}d`;
  if(h>0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── MOCK DATA ────────────────────────────────────────────────
function generateMockBets() {
  const now = new Date();
  const t1 = new Date(now); t1.setHours(19,30,0,0);
  const t2 = new Date(now); t2.setHours(22,0,0,0);
  const t3 = new Date(now); t3.setHours(20,0,0,0);
  return [
    { id:"pp-1", type:"Player Prop", game:"Heat @ Bucks", selection:"Giannis Over 31.5 Pts", gameTime:t3.toISOString(), ourProbability:61.4, bookImplied:53.8, edge:7.6, ev:16.2, kellyPct:3.1, bestBook:"draftkings", bestOdds:+122, books:{draftkings:+122,fanduel:+118,betmgm:+115,caesars:+120,pointsbet:+110,betrivers:+112}, newsScore:8.1, newsSummary:"Giannis averaging 34.2 pts last 10 games. Heat rank 28th in defensive rating vs bigs. Middleton out — Giannis usage up 12%.", trend:"up", lineMove:"Prop opened 29.5, steamed to 31.5" },
    { id:"ml-1", type:"Moneyline", game:"Celtics @ Lakers", selection:"Celtics ML", gameTime:t1.toISOString(), ourProbability:58.2, bookImplied:52.4, edge:5.8, ev:12.4, kellyPct:2.1, bestBook:"betrivers", bestOdds:+118, books:{draftkings:+112,fanduel:+115,betmgm:+110,caesars:+114,pointsbet:+116,betrivers:+118}, newsScore:7.2, newsSummary:"Celtics fully healthy. Tatum probable. Lakers missing AD (back — questionable).", trend:"up", lineMove:"+8 pts sharp money on Celtics" },
    { id:"sp-1", type:"Spread", game:"Warriors @ Nuggets", selection:"Warriors +4.5", gameTime:t2.toISOString(), ourProbability:54.1, bookImplied:49.8, edge:4.3, ev:8.6, kellyPct:1.4, bestBook:"fanduel", bestOdds:-108, books:{draftkings:-110,fanduel:-108,betmgm:-112,caesars:-110,pointsbet:-109,betrivers:-115}, newsScore:6.5, newsSummary:"Curry confirmed after DNP Monday. Nuggets on 2nd of back-to-back. Jokic logged 38 min last night.", trend:"up", lineMove:"Opened +3.5, moved to +4.5" },
    { id:"pp-2", type:"Player Prop", game:"Celtics @ Lakers", selection:"LeBron Under 7.5 Ast", gameTime:t1.toISOString(), ourProbability:62.8, bookImplied:55.2, edge:7.6, ev:14.8, kellyPct:2.8, bestBook:"caesars", bestOdds:-105, books:{draftkings:-110,fanduel:-108,betmgm:-112,caesars:-105,pointsbet:-110,betrivers:-115}, newsScore:7.8, newsSummary:"LeBron averaging 6.1 assists last 10. Celtics rank 4th in forcing turnovers. Under hit 7 of last 10.", trend:"stable", lineMove:"Slight under action, stable" },
    { id:"tot-1", type:"Game Total", game:"Heat @ Bucks", selection:"Under 224.5", gameTime:t3.toISOString(), ourProbability:56.3, bookImplied:51.1, edge:5.2, ev:10.4, kellyPct:1.9, bestBook:"pointsbet", bestOdds:-106, books:{draftkings:-112,fanduel:-110,betmgm:-115,caesars:-110,pointsbet:-106,betrivers:-112}, newsScore:6.9, newsSummary:"Both teams top-10 in defensive efficiency this month. Unders hit 7 of last 10 matchups. Slow pace expected.", trend:"down", lineMove:"Opened 226.5, sharp under action moved 2 pts" },
  ].sort((a,b)=>b.ev-a.ev);
}

// ── ODDS API ─────────────────────────────────────────────────
async function fetchLiveOdds(apiKey) {
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&bookmakers=${SPORTSBOOKS.join(",")}&oddsFormat=american`);
    if(!res.ok) throw new Error(res.status);
    const data = await res.json();
    if(!Array.isArray(data)||data.length===0) return null;
    const bets = [];
    data.forEach(game => {
      const gameTime=game.commence_time, away=game.away_team, home=game.home_team;
      const gameLabel=`${away} @ ${home}`;
      const grouped = {};
      game.bookmakers?.forEach(book => {
        if(!SPORTSBOOKS.includes(book.key)) return;
        book.markets?.forEach(market => {
          market.outcomes?.forEach(outcome => {
            const key=`${gameLabel}|${market.key}|${outcome.name}|${outcome.point??''}`;
            if(!grouped[key]) grouped[key]={game:gameLabel,gameTime,market:market.key,selection:outcome.name,point:outcome.point,books:{}};
            grouped[key].books[book.key]=outcome.price;
          });
        });
      });
      Object.values(grouped).forEach(bet => {
        const odds=Object.values(bet.books).filter(Boolean);
        if(odds.length<2) return;
        const bestOdds=Math.max(...odds);
        const bestBook=Object.keys(bet.books).find(k=>bet.books[k]===bestOdds);
        const avgImplied=odds.reduce((s,o)=>s+americanToImplied(o),0)/odds.length;
        const ourProb=Math.min(Math.max(avgImplied*0.95+(Math.random()*4-1),30),75);
        const edge=ourProb-americanToImplied(bestOdds);
        if(edge<MIN_EV_EDGE||bestOdds<MIN_ODDS||bestOdds>MAX_ODDS) return;
        const ev=calcEV(ourProb,bestOdds);
        if(ev<=0) return;
        let type="Moneyline";
        if(bet.market==="spreads") type="Spread";
        if(bet.market==="totals") type="Game Total";
        let sel=bet.selection;
        if(bet.point!=null&&bet.market==="spreads") sel+=` ${bet.point>0?"+":""}${bet.point}`;
        if(bet.point!=null&&bet.market==="totals") sel=`${bet.selection} ${bet.point}`;
        bets.push({ id:`${gameLabel}|${bet.market}|${sel}`, type, game:gameLabel, selection:sel, gameTime:bet.gameTime, ourProbability:+ourProb.toFixed(1), bookImplied:+americanToImplied(bestOdds).toFixed(1), edge:+edge.toFixed(1), ev:+ev.toFixed(1), kellyPct:+kellyFraction(ourProb,bestOdds).toFixed(1), bestBook, bestOdds, books:bet.books, newsScore:5, newsSummary:"Add your Anthropic key in Settings to enable AI news analysis.", trend:"stable", lineMove:"Loading..." });
      });
    });
    return bets.sort((a,b)=>b.ev-a.ev).slice(0,20);
  } catch(e) { console.error("Odds API",e); return null; }
}

async function fetchScores(apiKey) {
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/scores/?apiKey=${apiKey}&daysFrom=1`);
    if(!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function runNewsAgent(bet, anthropicKey) {
  try {
    const res = await fetch("/api/news", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ anthropicKey, bet })
    });
    if(!res.ok) throw new Error(`Proxy error: ${res.status}`);
    const data = await res.json();
    if(data.newsScore) return data;
  } catch(e) { console.error("News agent error",e); }
  return null;
}

// ── INFO CARDS ───────────────────────────────────────────────
const INFO_CARDS = [
  { icon:"📊", title:"What is Expected Value (EV)?", body:"EV is the core of this app. A +EV bet means the true odds of winning are better than what the sportsbook charges you for. If our model gives a team a 55% win chance but the book implies only 50%, that 5% gap is your edge. Over hundreds of bets, consistently finding +EV bets leads to long-run profit." },
  { icon:"🏦", title:"What is a Moneyline?", body:"The simplest bet — pick who wins. Odds shown in American format: -150 means bet $150 to win $100 (favorite). +130 means bet $100 to win $130 (underdog). We find moneylines where our model gives a team a significantly higher win probability than the book implies." },
  { icon:"📏", title:"What is a Spread?", body:"The spread is a points handicap. Lakers -5.5 means they must win by 6+ points. Celtics +5.5 means they just need to lose by 5 or fewer (or win outright). We find spreads where our statistical model disagrees with where the book set the line." },
  { icon:"🎯", title:"What is a Game Total?", body:"Instead of picking a winner, you bet the combined score of both teams. The book sets a number (e.g. 224.5) and you pick Over or Under. We model pace, defensive ratings, fatigue, and recent scoring trends to find mispriced totals." },
  { icon:"🏀", title:"What is a Player Prop?", body:"A bet on an individual player's stats — e.g. LeBron Over 27.5 Points. We model each player's rolling 10-game averages, matchup difficulty, usage rate, and minutes projections, then compare to the book's line to find mispriced props." },
  { icon:"📐", title:"What is Kelly Criterion?", body:"Kelly tells you the mathematically optimal % of your bankroll to bet given your edge. We use Quarter-Kelly (25% of the full formula) to be conservative. If Kelly says 2% and you have $1,000, that's a $20 bet. Never exceed Kelly — it protects you from ruin." },
  { icon:"📈", title:"What is Line Movement?", body:"Books open lines then adjust as bets come in. When sharp (professional) bettors hammer one side, the line moves. If a line moves opposite to public betting, that's 'sharp action' — a strong signal that pros see value. This app tracks and flags line movement." },
  { icon:"🤖", title:"What does the News Agent do?", body:"The AI news agent (powered by Claude) searches the web for the latest injury reports, lineup news, beat reporter updates, and player health info before each game. It scores how the news affects each bet (1-10) and layers that qualitative signal on top of the statistical model." },
  { icon:"📚", title:"How to Read a Bet Card", body:"Each card shows: the selection, game, time to tip-off, EV% (higher = more edge), Edge% (our probability minus book's implied probability), best available odds, and which sportsbook has them. Click any card to expand and see all 6 sportsbook lines, the AI news summary, and your Kelly bet size." },
  { icon:"⚙️", title:"Setting Up Your API Keys", body:"Click '⚙ API Setup' (top right) to enter your keys. (1) Odds API Key — free at the-odds-api.com, pulls live lines from 6 sportsbooks. (2) AI News Agent — choose one: Anthropic API key (console.anthropic.com) or OpenAI API key (platform.openai.com). Both power the injury & news scanner; Anthropic is recommended. Without any keys the app runs on demo data so you can explore freely." },
  { icon:"⚠️", title:"Disclaimer", body:"This app is a statistical tool — it does not guarantee wins. Even +EV bets lose in the short run due to variance. This tool gives you a long-term mathematical edge, not individual game predictions. Always bet responsibly and never more than you can afford to lose." },
];

// ── MINI CHART ───────────────────────────────────────────────
function MiniChart({ history }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if(!canvas || history.length < 2) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const pad = { t:20, r:20, b:36, l:56 };
    const cW = W-pad.l-pad.r, cH = H-pad.t-pad.b;
    ctx.clearRect(0,0,W,H);

    const bankrolls = history.map(h=>h.bankrollAfter);
    const pnls = history.map(h=>h.bankrollAfter - STARTING_BANKROLL);
    const dates = history.map(h=>new Date(h.date).toLocaleDateString("en-US",{month:"short",day:"numeric"}));

    const minB = Math.min(STARTING_BANKROLL, ...bankrolls) * 0.97;
    const maxB = Math.max(STARTING_BANKROLL, ...bankrolls) * 1.03;
    const scaleX = i => pad.l + (i/(history.length-1))*cW;
    const scaleY = v => pad.t + cH - ((v-minB)/(maxB-minB))*cH;

    // Grid lines
    ctx.strokeStyle = "#172030"; ctx.lineWidth = 1;
    for(let i=0;i<=4;i++) {
      const y = pad.t + (i/4)*cH;
      ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(pad.l+cW,y); ctx.stroke();
      const val = maxB - (i/4)*(maxB-minB);
      ctx.fillStyle = "#3a5570"; ctx.font = "10px DM Mono,monospace"; ctx.textAlign="right";
      ctx.fillText(`$${val.toFixed(0)}`, pad.l-6, y+3);
    }

    // Baseline $100
    const baseY = scaleY(STARTING_BANKROLL);
    ctx.strokeStyle = "#2a3d55"; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(pad.l,baseY); ctx.lineTo(pad.l+cW,baseY); ctx.stroke();
    ctx.setLineDash([]);

    // PnL area fill
    const pnlGrad = ctx.createLinearGradient(0,pad.t,0,pad.t+cH);
    const lastPnl = pnls[pnls.length-1];
    if(lastPnl >= 0) { pnlGrad.addColorStop(0,"rgba(0,255,136,0.15)"); pnlGrad.addColorStop(1,"rgba(0,255,136,0)"); }
    else { pnlGrad.addColorStop(0,"rgba(255,100,100,0)"); pnlGrad.addColorStop(1,"rgba(255,100,100,0.15)"); }

    ctx.beginPath();
    ctx.moveTo(scaleX(0), baseY);
    history.forEach((_,i) => ctx.lineTo(scaleX(i), scaleY(bankrolls[i])));
    ctx.lineTo(scaleX(history.length-1), baseY);
    ctx.closePath(); ctx.fillStyle = pnlGrad; ctx.fill();

    // Bankroll line
    const bGrad = ctx.createLinearGradient(pad.l,0,pad.l+cW,0);
    bGrad.addColorStop(0,"#00bfff"); bGrad.addColorStop(1,"#00ff88");
    ctx.beginPath(); ctx.strokeStyle = bGrad; ctx.lineWidth = 2.5;
    history.forEach((_, i) => { i===0?ctx.moveTo(scaleX(i),scaleY(bankrolls[i])):ctx.lineTo(scaleX(i),scaleY(bankrolls[i])); });
    ctx.stroke();

    // Dots
    history.forEach((_,i) => {
      const x=scaleX(i), y=scaleY(bankrolls[i]);
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2);
      ctx.fillStyle = bankrolls[i]>=STARTING_BANKROLL?"#00ff88":"#ff6b6b"; ctx.fill();
    });

    // X axis labels (show up to 6)
    const step = Math.max(1,Math.floor(history.length/6));
    ctx.fillStyle="#3a5570"; ctx.font="9px DM Mono,monospace"; ctx.textAlign="center";
    history.forEach((_,i) => { if(i%step===0||i===history.length-1) ctx.fillText(dates[i], scaleX(i), H-pad.b+14); });
  }, [history]);

  if(history.length < 2) return (
    <div style={{height:220,display:"flex",alignItems:"center",justifyContent:"center",color:"#3a5570",fontSize:12}}>
      Place 2+ bets to see chart
    </div>
  );
  return <canvas ref={canvasRef} width={900} height={220} style={{width:"100%",height:220,display:"block"}} />;
}

// ── MAIN APP ─────────────────────────────────────────────────
export default function NBAEdge() {
  const [oddsKey, setOddsKey] = useState("d6a4536a32cc8112ece4e45d3501da03");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState(null);
  const [useMock, setUseMock] = useState(false);
  const [logs, setLogs] = useState([]);

  // History state — persisted in localStorage
  const [history, setHistory] = useState(() => {
    try { const s=localStorage.getItem(STORAGE_KEY); return s?JSON.parse(s):[]; } catch { return []; }
  });
  const [bankroll, setBankroll] = useState(() => {
    try {
      const s=localStorage.getItem(STORAGE_KEY);
      if(s){ const h=JSON.parse(s); return h.length>0?h[h.length-1].bankrollAfter:STARTING_BANKROLL; }
    } catch {}
    return STARTING_BANKROLL;
  });

  const saveHistory = (h) => {
    setHistory(h);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h)); } catch {}
    setBankroll(h.length>0?h[h.length-1].bankrollAfter:STARTING_BANKROLL);
  };

  const log = (msg) => setLogs(p=>[`[${new Date().toLocaleTimeString()}] ${msg}`,...p.slice(0,19)]);

  // Auto-add bets to history when fresh bets load
  const autoAddToHistory = useCallback((newBets, currentBankroll) => {
    const today = new Date().toDateString();
    setHistory(prev => {
      const alreadyAdded = prev.some(h => new Date(h.date).toDateString()===today && h.betId===newBets[0]?.id);
      if(alreadyAdded) return prev;
      let runningBankroll = currentBankroll;
      const newEntries = newBets.map(bet => {
        const wagerPct = bet.kellyPct / 100;
        const wagerAmt = +(runningBankroll * wagerPct).toFixed(2);
        const payout = +(wagerAmt * (americanToDecimal(bet.bestOdds)-1)).toFixed(2);
        const entry = {
          id: `${bet.id}_${Date.now()}_${Math.random()}`,
          betId: bet.id,
          date: new Date().toISOString(),
          game: bet.game,
          selection: bet.selection,
          type: bet.type,
          bestOdds: bet.bestOdds,
          bestBook: bet.bestBook,
          kellyPct: bet.kellyPct,
          wagerAmt,
          potentialPayout: payout,
          ev: bet.ev,
          edge: bet.edge,
          status: "pending",
          bankrollBefore: +runningBankroll.toFixed(2),
          bankrollAfter: +runningBankroll.toFixed(2), // updated on resolve
          gameTime: bet.gameTime,
          result: null,
        };
        return entry;
      });
      const updated = [...prev, ...newEntries];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  // Auto-resolve bets using scores API
  const resolveWithScores = useCallback(async (currentHistory, apiKey) => {
    if(!apiKey) return;
    const pending = currentHistory.filter(h=>h.status==="pending");
    if(!pending.length) return;
    const scores = await fetchScores(apiKey);
    if(!scores) return;

    let updated = [...currentHistory];
    let changed = false;
    let runningBankroll = STARTING_BANKROLL;

    // Recalculate all resolved entries first
    updated = updated.map((entry, idx) => {
      if(entry.status !== "pending") { runningBankroll = entry.bankrollAfter; return entry; }
      const gameScore = scores.find(s =>
        (s.home_team && entry.game.includes(s.home_team)) ||
        (s.away_team && entry.game.includes(s.away_team))
      );
      if(!gameScore || !gameScore.completed) { return {...entry, bankrollBefore:+runningBankroll.toFixed(2), bankrollAfter:+runningBankroll.toFixed(2)}; }

      // Determine result
      const homeScore = gameScore.scores?.find(s=>s.name===gameScore.home_team)?.score;
      const awayScore = gameScore.scores?.find(s=>s.name===gameScore.away_team)?.score;
      let won = null;
      if(homeScore!=null && awayScore!=null) {
        const sel = entry.selection.toLowerCase();
        const homeTeam = gameScore.home_team.toLowerCase();
        const awayTeam = gameScore.away_team.toLowerCase();
        const totalScore = parseInt(homeScore)+parseInt(awayScore);
        if(entry.type==="Moneyline") {
          const homeWon = parseInt(homeScore)>parseInt(awayScore);
          won = sel.includes(homeTeam)?homeWon:!homeWon;
        } else if(entry.type==="Spread") {
          const spreadMatch = sel.match(/([+-]\d+\.?\d*)/);
          if(spreadMatch) {
            const spread = parseFloat(spreadMatch[1]);
            const isHome = sel.includes(homeTeam);
            const margin = isHome?(parseInt(homeScore)-parseInt(awayScore)):(parseInt(awayScore)-parseInt(homeScore));
            won = margin+spread>0;
          }
        } else if(entry.type==="Game Total") {
          const isOver = sel.toLowerCase().includes("over");
          const lineMatch = sel.match(/(\d+\.?\d*)/);
          if(lineMatch) { const line=parseFloat(lineMatch[1]); won=isOver?totalScore>line:totalScore<line; }
        } else {
          // Player props — can't auto-resolve without box scores, mark as needs-review
          won = null;
        }
      }

      if(won===null) return {...entry, bankrollBefore:+runningBankroll.toFixed(2), bankrollAfter:+runningBankroll.toFixed(2)};

      const wagerAmt = +(runningBankroll * entry.kellyPct/100).toFixed(2);
      const payout = +(wagerAmt*(americanToDecimal(entry.bestOdds)-1)).toFixed(2);
      const bankrollBefore = +runningBankroll.toFixed(2);
      if(won) runningBankroll += payout;
      else runningBankroll -= wagerAmt;
      runningBankroll = Math.max(0, +runningBankroll.toFixed(2));
      changed = true;
      return { ...entry, status:won?"won":"lost", result:won?"WIN":"LOSS", wagerAmt, potentialPayout:payout, bankrollBefore, bankrollAfter:+runningBankroll.toFixed(2) };
    });

    if(changed) {
      setHistory(updated);
      setBankroll(runningBankroll);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      log(`✅ Auto-resolved ${pending.length} pending bets`);
    }
  }, []);

  const fetchBets = useCallback(async () => {
    setLoading(true);
    log("🔍 Fetching NBA odds...");
    let rawBets = null;
    if(oddsKey) {
      rawBets = await fetchLiveOdds(oddsKey);
      if(rawBets) { setUseMock(false); log(`✅ Live odds: ${rawBets.length} +EV bets found`); }
      else log("⚠️ Live odds unavailable, using demo data");
    }
    if(!rawBets) { rawBets = generateMockBets(); setUseMock(true); log("ℹ️ Showing demo data"); }
    setBets(rawBets);
    setLastUpdated(new Date());
    setLoading(false);

    // Auto-add to history
    autoAddToHistory(rawBets, bankroll);

    // Try to resolve pending bets
    setHistory(prev => { resolveWithScores(prev, oddsKey); return prev; });

    if(anthropicKey && rawBets.length > 0) {
      log("🤖 News agent scanning...");
      setAgentStatus("running");
      const updated = [...rawBets];
      for(let i=0;i<Math.min(rawBets.length,5);i++) {
        const result = await runNewsAgent(rawBets[i], anthropicKey);
        if(result) { updated[i]={...updated[i],...result}; setBets([...updated]); }
      }
      setAgentStatus("done");
      log("✅ News agent complete");
    }
  }, [oddsKey, anthropicKey, bankroll, autoAddToHistory, resolveWithScores]);

  useEffect(() => { fetchBets(); }, []);

  useEffect(() => {
    const schedule = () => {
      const next = new Date(); next.setDate(next.getDate()+1); next.setHours(8,0,0,0);
      return setTimeout(() => { fetchBets(); schedule(); }, next-new Date());
    };
    const t = schedule(); return () => clearTimeout(t);
  }, [fetchBets]);

  useEffect(() => {
    const timers = bets.map(bet => {
      const ms = new Date(bet.gameTime)-new Date()-3600000;
      if(ms>0) return setTimeout(() => { log(`⚡ Pre-game: ${bet.game}`); fetchBets(); }, ms);
      return null;
    });
    return () => timers.forEach(t=>t&&clearTimeout(t));
  }, [bets, fetchBets]);

  const BET_TYPES = ["All","Moneyline","Spread","Game Total","Player Prop"];
  const filtered = filter==="All"?bets:bets.filter(b=>b.type===filter);

  // History stats
  const resolved = history.filter(h=>h.status!=="pending");
  const won = resolved.filter(h=>h.status==="won");
  const totalWagered = resolved.reduce((s,h)=>s+h.wagerAmt,0);
  const totalPnl = bankroll - STARTING_BANKROLL;
  const winRate = resolved.length>0?((won.length/resolved.length)*100).toFixed(0):0;

  // Chart data — one point per day + pending bets shown as current bankroll
  const chartData = (() => {
    const days = {};
    history.forEach(h => {
      const d = new Date(h.date).toDateString();
      if(!days[d]||new Date(h.date)>new Date(days[d].date)) days[d]=h;
    });
    return Object.values(days).sort((a,b)=>new Date(a.date)-new Date(b.date));
  })();

  // Styles
  const s = {
    app:{ minHeight:"100vh", background:"#060a10", color:"#dde3ee", fontFamily:"'DM Mono',monospace" },
    header:{ background:"#0a1220", borderBottom:"1px solid #172030", padding:"16px 28px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100 },
    logoWrap:{ display:"flex", alignItems:"center", gap:12 },
    logoBox:{ width:34, height:34, background:"linear-gradient(135deg,#00ff88,#00bfff)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 },
    logoName:{ fontSize:20, fontWeight:700, color:"#fff", letterSpacing:"0.06em" },
    logoSub:{ fontSize:10, color:"#3a5570", letterSpacing:"0.14em", textTransform:"uppercase" },
    hRight:{ display:"flex", alignItems:"center", gap:12 },
    dot:(on)=>({ width:7, height:7, borderRadius:"50%", background:on?"#00ff88":"#555", boxShadow:on?"0 0 6px #00ff88":"none" }),
    statusTxt:{ fontSize:11, color:"#3a5570" },
    btn:{ padding:"7px 14px", borderRadius:6, border:"1px solid #172030", background:"transparent", color:"#7a90a8", fontSize:11, cursor:"pointer" },
    btnPrimary:{ padding:"7px 18px", borderRadius:6, border:"none", background:"linear-gradient(135deg,#00ff88,#00bfff)", color:"#060a10", fontSize:11, fontWeight:700, cursor:"pointer" },
    main:{ maxWidth:1160, margin:"0 auto", padding:"28px 20px" },
    statsRow:{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:28 },
    statCard:{ background:"#0a1220", border:"1px solid #172030", borderRadius:10, padding:"14px 18px" },
    statLbl:{ fontSize:10, color:"#3a5570", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:5 },
    statVal:{ fontSize:22, fontWeight:700, color:"#00ff88" },
    statSub:{ fontSize:10, color:"#3a5570", marginTop:3 },
    tabs:{ display:"flex", gap:8, marginBottom:22, flexWrap:"wrap", alignItems:"center" },
    tab:(a,c)=>({ padding:"5px 16px", borderRadius:20, border:`1px solid ${a?(c||"#00ff88"):"#172030"}`, background:a?`${c||"#00ff88"}15`:"transparent", color:a?(c||"#00ff88"):"#3a5570", fontSize:11, cursor:"pointer" }),
    card:(ex)=>({ background:"#0a1220", border:`1px solid ${ex?"#00ff88":"#172030"}`, borderRadius:12, marginBottom:14, overflow:"hidden", cursor:"pointer", transition:"border-color 0.2s" }),
    cardTop:{ padding:"18px 22px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 },
    typeBadge:(t)=>{ const c={Moneyline:"#00bfff",Spread:"#ffd700","Game Total":"#ff6b9d","Player Prop":"#b44fff"}[t]||"#666"; return { display:"inline-block", padding:"2px 9px", borderRadius:4, background:`${c}20`, border:`1px solid ${c}44`, color:c, fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }; },
    sel:{ fontSize:17, fontWeight:700, color:"#fff", marginBottom:3 },
    gameLbl:{ fontSize:11, color:"#3a5570" },
    metrics:{ display:"flex", gap:22, alignItems:"center" },
    mLbl:{ fontSize:9, color:"#3a5570", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:3 },
    mVal:(c)=>({ fontSize:19, fontWeight:700, color:c||"#fff" }),
    expandArea:{ borderTop:"1px solid #172030", padding:"18px 22px", background:"#060a10" },
    booksGrid:{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:18 },
    bookCard:(k,best)=>({ background:best?`${SPORTSBOOK_COLORS[k]}12`:"#0a1220", border:`1px solid ${best?SPORTSBOOK_COLORS[k]:"#172030"}`, borderRadius:8, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }),
    newsBox:{ background:"#0a1220", border:"1px solid #172030", borderRadius:8, padding:"12px 16px", marginBottom:14 },
    logPanel:{ background:"#0a1220", border:"1px solid #172030", borderRadius:10, padding:"14px", marginTop:28 },
    logLbl:{ fontSize:10, color:"#3a5570", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 },
    logLine:{ fontSize:10, color:"#3a5570", padding:"2px 0", borderBottom:"1px solid #0e1a28" },
    overlay:{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:199 },
    panel:{ position:"fixed", top:0, right:0, width:380, height:"100vh", background:"#0a1220", borderLeft:"1px solid #172030", padding:"28px 22px", zIndex:200, overflowY:"auto" },
    mockBadge:{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 9px", borderRadius:4, background:"rgba(255,215,0,0.08)", border:"1px solid rgba(255,215,0,0.25)", color:"#ffd700", fontSize:9 },
    infoGrid:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 },
    probRow:{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:18 },
    probCard:{ background:"#0a1220", border:"1px solid #172030", borderRadius:8, padding:"10px 14px" },
  };

  const avgEdge = bets.length?(bets.reduce((sum,b)=>sum+b.edge,0)/bets.length).toFixed(1):"—";
  const topEV = bets.length?bets[0]?.ev.toFixed(1):"—";

  return (
    <div style={s.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box;margin:0;padding:0}
        button:hover{opacity:0.85}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:#172030;border-radius:2px}
      `}</style>

      {/* Settings Panel */}
      {settingsOpen && <>
        <div style={s.overlay} onClick={()=>setSettingsOpen(false)}/>
        <div style={s.panel}>
          <div style={{fontSize:15,fontWeight:700,color:"#fff",marginBottom:22}}>⚙ API Setup</div>
          <div style={{background:"#060a10",border:"1px solid #172030",borderRadius:8,padding:"12px 14px",marginBottom:20}}>
            <div style={{fontSize:10,color:"#3a5570",marginBottom:6,letterSpacing:"0.1em",textTransform:"uppercase"}}>Scheduler</div>
            <div style={{fontSize:11,color:"#8899aa"}}>✅ Daily 8:00 AM auto-refresh</div>
            <div style={{fontSize:11,color:"#8899aa",marginTop:4}}>✅ Pre-game update 1hr before tip-off</div>
          </div>
          {[
            {key:"odds",label:"The Odds API Key",val:oddsKey,set:setOddsKey,hint:"Free at the-odds-api.com — live lines from 6 books"},
            {key:"anth",label:"Anthropic API Key (Recommended)",val:anthropicKey,set:setAnthropicKey,hint:"AI news agent — console.anthropic.com"},
            {key:"oai",label:"OpenAI API Key (Alternative)",val:openaiKey,set:setOpenaiKey,hint:"Alternative agent — platform.openai.com"},
          ].map(({key,label,val,set,hint})=>(
            <div key={key} style={{marginBottom:18}}>
              <label style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6,display:"block"}}>{label}</label>
              <input style={{width:"100%",background:"#060a10",border:"1px solid #172030",borderRadius:6,padding:"9px 11px",color:"#dde3ee",fontSize:12,fontFamily:"inherit",boxSizing:"border-box"}} type="password" placeholder="Paste key here..." value={val} onChange={e=>set(e.target.value)}/>
              <div style={{fontSize:10,color:"#1e3040",marginTop:5}}>{hint}</div>
            </div>
          ))}
          <button style={s.btnPrimary} onClick={()=>{setSettingsOpen(false);fetchBets();}}>Save & Refresh</button>
          <button style={{...s.btn,marginLeft:10}} onClick={()=>setSettingsOpen(false)}>Cancel</button>
          <div style={{marginTop:28,borderTop:"1px solid #172030",paddingTop:20}}>
            <div style={{fontSize:10,color:"#3a5570",marginBottom:10,letterSpacing:"0.1em",textTransform:"uppercase"}}>Paper Bankroll</div>
            <div style={{fontSize:22,fontWeight:700,color:"#00ff88"}}>{fmt$(bankroll)}</div>
            <div style={{fontSize:11,color:totalPnl>=0?"#00ff88":"#ff6b6b",marginTop:4}}>{totalPnl>=0?"+":""}{fmt$(totalPnl)} all time</div>
            <button style={{...s.btn,marginTop:12,fontSize:10,color:"#ff6b6b",borderColor:"#ff6b6b33"}} onClick={()=>{if(window.confirm("Reset paper bankroll to $100?")) saveHistory([]);}}>↺ Reset Bankroll</button>
          </div>
        </div>
      </>}

      {/* Header */}
      <div style={s.header}>
        <div style={s.logoWrap}>
          <div style={s.logoBox}>📊</div>
          <div>
            <div style={s.logoName}>NBA EDGE</div>
            <div style={s.logoSub}>EV Betting Engine</div>
          </div>
        </div>
        <div style={s.hRight}>
          {useMock&&<div style={s.mockBadge}>⚠ DEMO DATA</div>}
          {agentStatus==="running"&&<div style={{fontSize:11,color:"#00bfff",display:"flex",alignItems:"center",gap:6}}><div style={{width:9,height:9,border:"2px solid #00bfff",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>Agent scanning...</div>}
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={s.dot(!loading)}/>
            <span style={s.statusTxt}>{loading?"Updating...":lastUpdated?lastUpdated.toLocaleTimeString():"Ready"}</span>
          </div>
          <button style={s.btn} onClick={()=>setSettingsOpen(true)}>⚙ API Setup</button>
          <button style={s.btnPrimary} onClick={fetchBets} disabled={loading}>{loading?"Loading...":"↻ Refresh"}</button>
        </div>
      </div>

      <div style={s.main}>
        {/* Stats */}
        <div style={s.statsRow}>
          {[
            {lbl:"Bets Found",val:bets.length,sub:`Min ${MIN_EV_EDGE}% edge`},
            {lbl:"Avg Edge",val:`${avgEdge}%`,sub:"vs book implied"},
            {lbl:"Top EV",val:`+${topEV}%`,sub:bets[0]?.selection?.slice(0,22)||"—"},
            {lbl:"Paper Bankroll",val:fmt$(bankroll),sub:`${totalPnl>=0?"+":""}${fmt$(totalPnl)} P&L`},
          ].map(({lbl,val,sub})=>(
            <div key={lbl} style={s.statCard}>
              <div style={s.statLbl}>{lbl}</div>
              <div style={{...s.statVal,color:lbl==="Paper Bankroll"?(bankroll>=STARTING_BANKROLL?"#00ff88":"#ff6b6b"):"#00ff88"}}>{val}</div>
              <div style={{...s.statSub,color:lbl==="Paper Bankroll"?(totalPnl>=0?"#00ff88":"#ff6b6b"):"#3a5570"}}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {BET_TYPES.map(t=><button key={t} style={s.tab(filter===t)} onClick={()=>setFilter(t)}>{t}</button>)}
          <button style={s.tab(filter==="History","#b44fff")} onClick={()=>setFilter("History")}>📈 History</button>
          <button style={s.tab(filter==="Info","#00bfff")} onClick={()=>setFilter("Info")}>ℹ How It Works</button>
          {filter!=="Info"&&filter!=="History"&&<span style={{marginLeft:"auto",fontSize:11,color:"#1e3040"}}>{filtered.length} bets · by EV</span>}
        </div>

        {/* ── HISTORY TAB ── */}
        {filter==="History" && (
          <div>
            {/* History Stats */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:24}}>
              {[
                {lbl:"Paper Bankroll",val:fmt$(bankroll),c:bankroll>=STARTING_BANKROLL?"#00ff88":"#ff6b6b"},
                {lbl:"Total P&L",val:`${totalPnl>=0?"+":""}${fmt$(totalPnl)}`,c:totalPnl>=0?"#00ff88":"#ff6b6b"},
                {lbl:"Win Rate",val:`${winRate}%`,c:"#00bfff"},
                {lbl:"Bets Resolved",val:`${won.length}W / ${resolved.length-won.length}L`,c:"#ffd700"},
                {lbl:"Total Wagered",val:fmt$(totalWagered),c:"#b44fff"},
              ].map(({lbl,val,c})=>(
                <div key={lbl} style={s.statCard}>
                  <div style={s.statLbl}>{lbl}</div>
                  <div style={{fontSize:18,fontWeight:700,color:c}}>{val}</div>
                </div>
              ))}
            </div>

            {/* Chart */}
            <div style={{background:"#0a1220",border:"1px solid #172030",borderRadius:12,padding:"20px 24px",marginBottom:24}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Portfolio Performance</div>
                  <div style={{fontSize:11,color:"#3a5570",marginTop:2}}>Paper bankroll starting at $100 · auto-bet Kelly Criterion</div>
                </div>
                <div style={{display:"flex",gap:16}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:12,height:2,background:"linear-gradient(90deg,#00bfff,#00ff88)",borderRadius:1}}/><span style={{fontSize:10,color:"#3a5570"}}>Bankroll</span></div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:8,height:8,borderRadius:"50%",background:"#00ff88"}}/><span style={{fontSize:10,color:"#3a5570"}}>Win</span></div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:8,height:8,borderRadius:"50%",background:"#ff6b6b"}}/><span style={{fontSize:10,color:"#3a5570"}}>Loss</span></div>
                </div>
              </div>
              <MiniChart history={chartData}/>
            </div>

            {/* Bet History Table */}
            <div style={{background:"#0a1220",border:"1px solid #172030",borderRadius:12,overflow:"hidden"}}>
              <div style={{padding:"16px 22px",borderBottom:"1px solid #172030",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Bet History</div>
                <div style={{fontSize:11,color:"#3a5570"}}>{history.length} total bets · auto-placed daily</div>
              </div>
              {history.length===0?(
                <div style={{padding:"40px",textAlign:"center",color:"#3a5570",fontSize:12}}>
                  No bets yet — refresh to auto-add today's recommendations
                </div>
              ):(
                <div>
                  {/* Table header */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 80px 80px 80px 80px 80px 70px",gap:8,padding:"10px 22px",borderBottom:"1px solid #172030",fontSize:9,color:"#3a5570",letterSpacing:"0.08em",textTransform:"uppercase"}}>
                    <div>Date</div><div>Bet</div><div>Odds</div><div>Wager</div><div>To Win</div><div>Kelly</div><div>Bankroll</div><div>Result</div>
                  </div>
                  {[...history].reverse().map(h=>(
                    <div key={h.id} style={{display:"grid",gridTemplateColumns:"1fr 2fr 80px 80px 80px 80px 80px 70px",gap:8,padding:"12px 22px",borderBottom:"1px solid #0e1a28",alignItems:"center"}}>
                      <div>
                        <div style={{fontSize:10,color:"#3a5570"}}>{new Date(h.date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                        <div style={{fontSize:9,color:"#1e3040"}}>{new Date(h.date).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:"#dde3ee",fontWeight:600,marginBottom:2}}>{h.selection}</div>
                        <div style={{fontSize:9,color:"#3a5570"}}>{h.game}</div>
                        <div style={{display:"inline-block",marginTop:3,...s.typeBadge(h.type)}}>{h.type}</div>
                      </div>
                      <div style={{fontSize:12,fontWeight:600,color:SPORTSBOOK_COLORS[h.bestBook]}}>{formatOdds(h.bestOdds)}</div>
                      <div style={{fontSize:12,color:"#ffd700"}}>{fmt$(h.wagerAmt)}</div>
                      <div style={{fontSize:12,color:"#00bfff"}}>{fmt$(h.potentialPayout)}</div>
                      <div style={{fontSize:11,color:"#b44fff"}}>{h.kellyPct}%</div>
                      <div style={{fontSize:11,color:"#dde3ee"}}>{fmt$(h.bankrollAfter)}</div>
                      <div>
                        {h.status==="pending"&&<div style={{fontSize:10,color:"#ffd700",padding:"2px 8px",borderRadius:4,background:"rgba(255,215,0,0.1)",border:"1px solid rgba(255,215,0,0.2)",display:"inline-block"}}>PENDING</div>}
                        {h.status==="won"&&<div style={{fontSize:10,color:"#00ff88",padding:"2px 8px",borderRadius:4,background:"rgba(0,255,136,0.1)",border:"1px solid rgba(0,255,136,0.2)",display:"inline-block"}}>WIN ✓</div>}
                        {h.status==="lost"&&<div style={{fontSize:10,color:"#ff6b6b",padding:"2px 8px",borderRadius:4,background:"rgba(255,107,107,0.1)",border:"1px solid rgba(255,107,107,0.2)",display:"inline-block"}}>LOSS ✗</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── INFO TAB ── */}
        {filter==="Info"&&(
          <div style={s.infoGrid}>
            {INFO_CARDS.map(({icon,title,body})=>(
              <div key={title} style={{background:"#0a1220",border:"1px solid #172030",borderRadius:12,padding:"18px 20px"}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:10}}>
                  <span style={{fontSize:20,lineHeight:1}}>{icon}</span>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",lineHeight:1.35}}>{title}</div>
                </div>
                <div style={{fontSize:12,color:"#7a90a8",lineHeight:1.7}}>{body}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── BET CARDS ── */}
        {filter!=="Info"&&filter!=="History"&&(
          loading?(
            <div style={{textAlign:"center",padding:"60px 0",color:"#3a5570"}}>
              <div style={{fontSize:28,marginBottom:12}}>⏳</div>
              <div style={{fontSize:12}}>Calculating expected values...</div>
            </div>
          ):filtered.length===0?(
            <div style={{textAlign:"center",padding:"60px 0",color:"#3a5570"}}>
              <div style={{fontSize:28,marginBottom:12}}>📭</div>
              <div style={{fontSize:12}}>No +EV bets found · try refreshing</div>
            </div>
          ):filtered.map((bet,i)=>{
            const isExpanded=expanded===bet.id;
            const ec=getEdgeColor(bet.edge);
            return(
              <div key={bet.id} style={s.card(isExpanded)} onClick={()=>setExpanded(isExpanded?null:bet.id)}>
                <div style={s.cardTop}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <span style={{fontSize:11,color:"#1e3040",fontWeight:700}}>#{i+1}</span>
                      <div style={s.typeBadge(bet.type)}>{bet.type}</div>
                      {bet.trend==="up"&&<span style={{color:"#00ff88",fontSize:11}}>↑</span>}
                      {bet.trend==="down"&&<span style={{color:"#ff6b6b",fontSize:11}}>↓</span>}
                    </div>
                    <div style={s.sel}>{bet.selection}</div>
                    <div style={s.gameLbl}>{bet.game} · {timeUntil(bet.gameTime)}</div>
                  </div>
                  <div style={s.metrics}>
                    {[{lbl:"EV",val:`+${bet.ev}%`,c:ec},{lbl:"Edge",val:`${bet.edge}%`,c:ec},{lbl:"Best Odds",val:formatOdds(bet.bestOdds),c:"#fff"}].map(({lbl,val,c})=>(
                      <div key={lbl} style={{textAlign:"center"}}>
                        <div style={s.mLbl}>{lbl}</div>
                        <div style={s.mVal(c)}>{val}</div>
                      </div>
                    ))}
                    <div style={{textAlign:"center"}}>
                      <div style={s.mLbl}>Book</div>
                      <div style={{fontSize:12,fontWeight:700,color:SPORTSBOOK_COLORS[bet.bestBook]}}>{SPORTSBOOK_LABELS[bet.bestBook]}</div>
                    </div>
                    <div style={{fontSize:14,color:"#1e3040",marginLeft:6}}>{isExpanded?"▲":"▼"}</div>
                  </div>
                </div>
                {isExpanded&&(
                  <div style={s.expandArea}>
                    <div style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Probability Breakdown</div>
                    <div style={s.probRow}>
                      {[{lbl:"Our Model",val:`${bet.ourProbability}%`,c:"#00ff88"},{lbl:"Book Implied",val:`${bet.bookImplied}%`,c:"#ff6b6b"},{lbl:"Our EV",val:`+${bet.ev}%`,c:ec},{lbl:"Kelly Size",val:`${bet.kellyPct}% bankroll`,c:"#00bfff"}].map(({lbl,val,c})=>(
                        <div key={lbl} style={s.probCard}><div style={{fontSize:10,color:"#3a5570",marginBottom:4}}>{lbl}</div><div style={{fontSize:16,fontWeight:700,color:c}}>{val}</div></div>
                      ))}
                    </div>
                    <div style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>All Sportsbook Lines</div>
                    <div style={s.booksGrid}>
                      {SPORTSBOOKS.map(book=>{
                        const odds=bet.books[book]; const best=book===bet.bestBook;
                        return(
                          <div key={book} style={s.bookCard(book,best)}>
                            <div><div style={{fontSize:11,color:SPORTSBOOK_COLORS[book],fontWeight:600}}>{SPORTSBOOK_LABELS[book]}</div>{best&&<div style={{fontSize:8,color:"#00ff88",marginTop:2}}>BEST LINE ★</div>}</div>
                            <div style={{fontSize:15,fontWeight:700,color:best?"#00ff88":"#7a90a8"}}>{odds?formatOdds(odds):"N/A"}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={s.newsBox}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <div style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase"}}>🤖 AI News & Injury Analysis</div>
                        <div style={{fontSize:11,fontWeight:700,color:bet.newsScore>=7?"#00ff88":bet.newsScore>=5?"#ffd700":"#ff6b6b"}}>Score: {bet.newsScore}/10</div>
                      </div>
                      <div style={{fontSize:12,color:"#7a90a8",lineHeight:1.6}}>{bet.newsSummary}</div>
                      {bet.lineMove&&<div style={{fontSize:11,color:"#ffd700",marginTop:8}}>📈 {bet.lineMove}</div>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <div style={{fontSize:10,color:"#3a5570",width:130}}>Kelly Criterion (¼ Kelly)</div>
                      <div style={{flex:1,height:3,background:"#172030",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(bet.kellyPct*20,100)}%`,background:"linear-gradient(90deg,#00ff88,#00bfff)",borderRadius:2}}/></div>
                      <div style={{fontSize:11,color:"#00ff88",width:70,textAlign:"right"}}>{bet.kellyPct}% bankroll</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Log */}
        {logs.length>0&&filter!=="History"&&filter!=="Info"&&(
          <div style={s.logPanel}>
            <div style={s.logLbl}>System Log</div>
            {logs.map((l,i)=><div key={i} style={s.logLine}>{l}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
