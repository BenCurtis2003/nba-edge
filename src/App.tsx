import { useState, useEffect, useCallback } from "react";

const SPORTSBOOKS = ["draftkings","fanduel","betmgm","caesars","pointsbet","betrivers"];
const SPORTSBOOK_LABELS = { draftkings:"DraftKings", fanduel:"FanDuel", betmgm:"BetMGM", caesars:"Caesars", pointsbet:"PointsBet", betrivers:"BetRivers" };
const SPORTSBOOK_COLORS = { draftkings:"#53d337", fanduel:"#1493ff", betmgm:"#d4af37", caesars:"#00a4e4", pointsbet:"#e8192c", betrivers:"#003087" };
const MIN_EV_EDGE = 3;
const MIN_ODDS = -200;
const MAX_ODDS = 400;

function americanToDecimal(a) { return a > 0 ? a/100+1 : 100/Math.abs(a)+1; }
function americanToImplied(a) { return (1/americanToDecimal(a))*100; }
function calcEV(prob, odds) { const d=americanToDecimal(odds); return ((prob/100)*(d-1)-(1-prob/100))*100; }
function kellyFraction(prob, odds) { const d=americanToDecimal(odds); const b=d-1; const p=prob/100; return Math.max(0,Math.min(((b*p-(1-p))/b)*0.25,0.05))*100; }
function formatOdds(a) { if(!a&&a!==0) return "N/A"; return a>0?`+${a}`:`${a}`; }
function getEdgeColor(e) { if(e>=8) return "#00ff88"; if(e>=5) return "#7fff00"; if(e>=3) return "#ffd700"; return "#aaaaaa"; }
function timeUntil(d) {
  const diff = new Date(d)-new Date();
  if(diff<0) return "Live";
  const h=Math.floor(diff/3600000), m=Math.floor((diff%3600000)/60000);
  if(h>24) return `${Math.floor(h/24)}d`;
  if(h>0) return `${h}h ${m}m`;
  return `${m}m`;
}

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

async function fetchLiveOdds(apiKey) {
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&bookmakers=${SPORTSBOOKS.join(",")}&oddsFormat=american`);
    if(!res.ok) throw new Error(res.status);
    const data = await res.json();
    if(!Array.isArray(data)||data.length===0) return null;
    const bets = [];
    data.forEach(game => {
      const gameTime=game.commence_time, home=game.home_team, away=game.away_team;
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
        const vigRemoved=avgImplied*0.95;
        const ourProb=Math.min(Math.max(vigRemoved+(Math.random()*4-1),30),75);
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
  } catch(e) { console.error("Odds API error",e); return null; }
}

async function runNewsAgent(bet, anthropicKey) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":anthropicKey,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({
        model:"claude-sonnet-4-20250514", max_tokens:400,
        tools:[{type:"web_search_20250305",name:"web_search"}],
        messages:[{role:"user",content:`NBA betting analyst. Search for latest injury reports and lineup news for this bet: "${bet.selection}" in "${bet.game}". Respond ONLY with valid JSON (no markdown): {"newsScore":7,"newsSummary":"2-3 sentence summary","lineMove":"line movement info","trend":"up"}`}]
      })
    });
    const data = await res.json();
    const text = data.content?.find(b=>b.type==="text")?.text;
    if(text) { try { return JSON.parse(text.replace(/```json|```/g,"").trim()); } catch{} }
  } catch(e) { console.error("News agent error",e); }
  return null;
}

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
  { icon:"⚙️", title:"Setting Up Your API Keys", body:"Click '⚙ API Setup' (top right) to enter your keys. (1) Odds API Key — free at the-odds-api.com, pulls live lines from 6 sportsbooks. (2) AI News Agent — choose one: Anthropic API key (claude.ai/account) or OpenAI API key (platform.openai.com). Both power the injury & news scanner; Anthropic is recommended. Without any keys the app runs on demo data so you can explore freely." },
  { icon:"⚠️", title:"Disclaimer", body:"This app is a statistical tool — it does not guarantee wins. Even +EV bets lose in the short run due to variance. This tool gives you a long-term mathematical edge, not individual game predictions. Always bet responsibly and never more than you can afford to lose." },
];

export default function NBAEdge() {
  const [oddsKey, setOddsKey] = useState("d6a4536a32cc8112ece4e45d3501da03");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setupDone, setSetupDone] = useState(true);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState(null);
  const [useMock, setUseMock] = useState(false);
  const [logs, setLogs] = useState([]);

  const log = (msg) => setLogs(p => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...p.slice(0,19)]);

  const fetchBets = useCallback(async () => {
    setLoading(true);
    log("🔍 Fetching NBA odds...");
    let rawBets = null;
    if(oddsKey) {
      rawBets = await fetchLiveOdds(oddsKey);
      if(rawBets) { setUseMock(false); log(`✅ Live odds: ${rawBets.length} +EV bets found`); }
      else { log("⚠️ Live odds unavailable, using demo data"); }
    }
    if(!rawBets) { rawBets = generateMockBets(); setUseMock(true); log("ℹ️ Showing demo data — add Odds API key in Settings"); }
    setBets(rawBets);
    setLastUpdated(new Date());
    setLoading(false);
    if(anthropicKey && rawBets.length > 0) {
      log("🤖 News agent scanning injury reports...");
      setAgentStatus("running");
      const updated = [...rawBets];
      for(let i=0;i<Math.min(rawBets.length,5);i++) {
        const result = await runNewsAgent(rawBets[i], anthropicKey);
        if(result) { updated[i]={...updated[i],...result}; setBets([...updated]); }
      }
      setAgentStatus("done");
      log("✅ News agent complete");
    }
  }, [oddsKey, anthropicKey]);

  useEffect(() => { fetchBets(); }, []);

  useEffect(() => {
    const schedule = () => {
      const next = new Date(); next.setDate(next.getDate()+1); next.setHours(8,0,0,0);
      return setTimeout(() => { fetchBets(); schedule(); }, next-new Date());
    };
    const t = schedule();
    return () => clearTimeout(t);
  }, [fetchBets]);

  useEffect(() => {
    const timers = bets.map(bet => {
      const ms = new Date(bet.gameTime)-new Date()-3600000;
      if(ms>0) return setTimeout(() => { log(`⚡ Pre-game refresh: ${bet.game}`); fetchBets(); }, ms);
      return null;
    });
    return () => timers.forEach(t=>t&&clearTimeout(t));
  }, [bets, fetchBets]);

  const BET_TYPES = ["All","Moneyline","Spread","Game Total","Player Prop"];
  const filtered = filter==="All" ? bets : bets.filter(b=>b.type===filter);

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
    btn:{ padding:"7px 14px", borderRadius:6, border:"1px solid #172030", background:"transparent", color:"#7a90a8", fontSize:11, cursor:"pointer", letterSpacing:"0.04em" },
    btnPrimary:{ padding:"7px 18px", borderRadius:6, border:"none", background:"linear-gradient(135deg,#00ff88,#00bfff)", color:"#060a10", fontSize:11, fontWeight:700, cursor:"pointer", letterSpacing:"0.04em" },
    main:{ maxWidth:1160, margin:"0 auto", padding:"28px 20px" },
    statsRow:{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:28 },
    statCard:{ background:"#0a1220", border:"1px solid #172030", borderRadius:10, padding:"14px 18px" },
    statLbl:{ fontSize:10, color:"#3a5570", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:5 },
    statVal:{ fontSize:22, fontWeight:700, color:"#00ff88" },
    statSub:{ fontSize:10, color:"#3a5570", marginTop:3 },
    tabs:{ display:"flex", gap:8, marginBottom:22, flexWrap:"wrap", alignItems:"center" },
    tab:(a)=>({ padding:"5px 16px", borderRadius:20, border:`1px solid ${a?"#00ff88":"#172030"}`, background:a?"rgba(0,255,136,0.08)":"transparent", color:a?"#00ff88":"#3a5570", fontSize:11, cursor:"pointer", letterSpacing:"0.05em" }),
    infoTab:(a)=>({ padding:"5px 16px", borderRadius:20, border:`1px solid ${a?"#00bfff":"#172030"}`, background:a?"rgba(0,191,255,0.08)":"transparent", color:a?"#00bfff":"#3a5570", fontSize:11, cursor:"pointer", letterSpacing:"0.05em" }),
    card:(ex)=>({ background:"#0a1220", border:`1px solid ${ex?"#00ff88":"#172030"}`, borderRadius:12, marginBottom:14, overflow:"hidden", cursor:"pointer", transition:"border-color 0.2s" }),
    cardTop:{ padding:"18px 22px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 },
    typeBadge:(t)=>{
      const c={Moneyline:"#00bfff",Spread:"#ffd700","Game Total":"#ff6b9d","Player Prop":"#b44fff"}[t]||"#666";
      return { display:"inline-block", padding:"2px 9px", borderRadius:4, background:`${c}20`, border:`1px solid ${c}44`, color:c, fontSize:9, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 };
    },
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
    panelTitle:{ fontSize:15, fontWeight:700, color:"#fff", marginBottom:22 },
    field:{ marginBottom:18 },
    fieldLbl:{ fontSize:10, color:"#3a5570", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6, display:"block" },
    fieldInput:{ width:"100%", background:"#060a10", border:"1px solid #172030", borderRadius:6, padding:"9px 11px", color:"#dde3ee", fontSize:12, fontFamily:"inherit", boxSizing:"border-box" },
    fieldHint:{ fontSize:10, color:"#1e3040", marginTop:5 },
    mockBadge:{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 9px", borderRadius:4, background:"rgba(255,215,0,0.08)", border:"1px solid rgba(255,215,0,0.25)", color:"#ffd700", fontSize:9, letterSpacing:"0.1em" },
    setupCard:{ background:"#0a1220", border:"1px solid #172030", borderRadius:12, padding:"32px", textAlign:"center", marginBottom:24 },
    infoGrid:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 },
    infoCard:{ background:"#0a1220", border:"1px solid #172030", borderRadius:12, padding:"18px 20px" },
    probRow:{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:18 },
    probCard:{ background:"#0a1220", border:"1px solid #172030", borderRadius:8, padding:"10px 14px" },
  };

  const avgEdge = bets.length ? (bets.reduce((s,b)=>s+b.edge,0)/bets.length).toFixed(1) : "—";
  const topEV = bets.length ? bets[0]?.ev.toFixed(1) : "—";

  return (
    <div style={s.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap');
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box;margin:0;padding:0}
        button:hover{opacity:0.85}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:#172030;border-radius:2px}
      `}</style>

      {/* Settings Panel */}
      {settingsOpen && <>
        <div style={s.overlay} onClick={()=>setSettingsOpen(false)} />
        <div style={s.panel}>
          <div style={s.panelTitle}>⚙ Settings</div>

          <div style={{ background:"#060a10", border:"1px solid #172030", borderRadius:8, padding:"12px 14px", marginBottom:20 }}>
            <div style={{ fontSize:10, color:"#3a5570", marginBottom:6, letterSpacing:"0.1em", textTransform:"uppercase" }}>Scheduler Status</div>
            <div style={{ fontSize:11, color:"#8899aa" }}>✅ Daily 8:00 AM auto-refresh</div>
            <div style={{ fontSize:11, color:"#8899aa", marginTop:4 }}>✅ Pre-game update 1hr before tip-off</div>
          </div>

          {[
            { key:"odds", label:"The Odds API Key", val:oddsKey, set:setOddsKey, hint:"Free at the-odds-api.com — pulls live lines from 6 sportsbooks" },
            { key:"anth", label:"Anthropic API Key (Recommended)", val:anthropicKey, set:setAnthropicKey, hint:"Enables AI news & injury agent — get at console.anthropic.com" },
            { key:"oai", label:"OpenAI API Key (Alternative)", val:openaiKey, set:setOpenaiKey, hint:"Alternative news agent — get at platform.openai.com. Used if no Anthropic key." },
          ].map(({key,label,val,set,hint})=>(
            <div key={key} style={s.field}>
              <label style={s.fieldLbl}>{label}</label>
              <input style={s.fieldInput} type="password" placeholder="Paste key here..." value={val} onChange={e=>set(e.target.value)} />
              <div style={s.fieldHint}>{hint}</div>
            </div>
          ))}
          <button style={s.btnPrimary} onClick={()=>{setSettingsOpen(false);fetchBets();}}>Save & Refresh</button>
          <button style={{...s.btn, marginLeft:10}} onClick={()=>setSettingsOpen(false)}>Cancel</button>
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
          {useMock && <div style={s.mockBadge}>⚠ DEMO DATA</div>}
          {agentStatus==="running" && (
            <div style={{fontSize:11,color:"#00bfff",display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:9,height:9,border:"2px solid #00bfff",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
              Agent scanning...
            </div>
          )}
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={s.dot(!loading)}/>
            <span style={s.statusTxt}>{loading?"Updating...":lastUpdated?`${lastUpdated.toLocaleTimeString()}`:"Ready"}</span>
          </div>
          <button style={s.btn} onClick={()=>setSettingsOpen(true)}>⚙ API Setup</button>
          <button style={s.btnPrimary} onClick={fetchBets} disabled={loading}>{loading?"Loading...":"↻ Refresh"}</button>
        </div>
      </div>

      <div style={s.main}>
        {/* Stats */}
        <div style={s.statsRow}>
          {[
            {lbl:"Bets Found", val:bets.length, sub:`Min ${MIN_EV_EDGE}% edge`},
            {lbl:"Avg Edge", val:`${avgEdge}%`, sub:"vs book implied"},
            {lbl:"Top EV", val:`+${topEV}%`, sub:bets[0]?.selection?.slice(0,22)||"—"},
            {lbl:"Books Tracked", val:SPORTSBOOKS.length, sub:"DK · FD · MGM · CZR · PB · BR"},
          ].map(({lbl,val,sub})=>(
            <div key={lbl} style={s.statCard}>
              <div style={s.statLbl}>{lbl}</div>
              <div style={s.statVal}>{val}</div>
              <div style={s.statSub}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {BET_TYPES.map(t=>(
            <button key={t} style={s.tab(filter===t)} onClick={()=>setFilter(t)}>{t}</button>
          ))}
          <button style={s.infoTab(filter==="Info")} onClick={()=>setFilter("Info")}>ℹ How It Works</button>
          {filter!=="Info" && (
            <span style={{marginLeft:"auto",fontSize:11,color:"#1e3040"}}>{filtered.length} bets · by EV</span>
          )}
        </div>

        {/* Info Panel */}
        {filter==="Info" && (
          <div style={s.infoGrid}>
            {INFO_CARDS.map(({icon,title,body})=>(
              <div key={title} style={s.infoCard}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:10}}>
                  <span style={{fontSize:20,lineHeight:1}}>{icon}</span>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",lineHeight:1.35}}>{title}</div>
                </div>
                <div style={{fontSize:12,color:"#7a90a8",lineHeight:1.7}}>{body}</div>
              </div>
            ))}
          </div>
        )}

        {/* Bet Cards */}
        {filter!=="Info" && (
          loading ? (
            <div style={{textAlign:"center",padding:"60px 0",color:"#3a5570"}}>
              <div style={{fontSize:28,marginBottom:12}}>⏳</div>
              <div style={{fontSize:12}}>Calculating expected values...</div>
            </div>
          ) : filtered.length===0 ? (
            <div style={{textAlign:"center",padding:"60px 0",color:"#3a5570"}}>
              <div style={{fontSize:28,marginBottom:12}}>📭</div>
              <div style={{fontSize:12}}>No +EV bets found · try refreshing</div>
            </div>
          ) : filtered.map((bet,i)=>{
            const isExpanded = expanded===bet.id;
            const ec = getEdgeColor(bet.edge);
            return (
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
                    {[
                      {lbl:"EV",val:`+${bet.ev}%`,c:ec},
                      {lbl:"Edge",val:`${bet.edge}%`,c:ec},
                      {lbl:"Best Odds",val:formatOdds(bet.bestOdds),c:"#fff"},
                    ].map(({lbl,val,c})=>(
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

                {isExpanded && (
                  <div style={s.expandArea}>
                    {/* Prob row */}
                    <div style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Probability Breakdown</div>
                    <div style={s.probRow}>
                      {[
                        {lbl:"Our Model",val:`${bet.ourProbability}%`,c:"#00ff88"},
                        {lbl:"Book Implied",val:`${bet.bookImplied}%`,c:"#ff6b6b"},
                        {lbl:"Our EV",val:`+${bet.ev}%`,c:ec},
                        {lbl:"Kelly Size",val:`${bet.kellyPct}% bankroll`,c:"#00bfff"},
                      ].map(({lbl,val,c})=>(
                        <div key={lbl} style={s.probCard}>
                          <div style={{fontSize:10,color:"#3a5570",marginBottom:4}}>{lbl}</div>
                          <div style={{fontSize:16,fontWeight:700,color:c}}>{val}</div>
                        </div>
                      ))}
                    </div>

                    {/* Books */}
                    <div style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>All Sportsbook Lines</div>
                    <div style={s.booksGrid}>
                      {SPORTSBOOKS.map(book=>{
                        const odds=bet.books[book];
                        const best=book===bet.bestBook;
                        return (
                          <div key={book} style={s.bookCard(book,best)}>
                            <div>
                              <div style={{fontSize:11,color:SPORTSBOOK_COLORS[book],fontWeight:600}}>{SPORTSBOOK_LABELS[book]}</div>
                              {best&&<div style={{fontSize:8,color:"#00ff88",marginTop:2}}>BEST LINE ★</div>}
                            </div>
                            <div style={{fontSize:15,fontWeight:700,color:best?"#00ff88":"#7a90a8"}}>{odds?formatOdds(odds):"N/A"}</div>
                          </div>
                        );
                      })}
                    </div>

                    {/* News */}
                    <div style={s.newsBox}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <div style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase"}}>🤖 AI News & Injury Analysis</div>
                        <div style={{fontSize:11,fontWeight:700,color:bet.newsScore>=7?"#00ff88":bet.newsScore>=5?"#ffd700":"#ff6b6b"}}>Score: {bet.newsScore}/10</div>
                      </div>
                      <div style={{fontSize:12,color:"#7a90a8",lineHeight:1.6}}>{bet.newsSummary}</div>
                      {bet.lineMove&&<div style={{fontSize:11,color:"#ffd700",marginTop:8}}>📈 {bet.lineMove}</div>}
                    </div>

                    {/* Kelly bar */}
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <div style={{fontSize:10,color:"#3a5570",width:130}}>Kelly Criterion (¼ Kelly)</div>
                      <div style={{flex:1,height:3,background:"#172030",borderRadius:2,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${Math.min(bet.kellyPct*20,100)}%`,background:"linear-gradient(90deg,#00ff88,#00bfff)",borderRadius:2}}/>
                      </div>
                      <div style={{fontSize:11,color:"#00ff88",width:70,textAlign:"right"}}>{bet.kellyPct}% bankroll</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Log */}
        {logs.length>0 && (
          <div style={s.logPanel}>
            <div style={s.logLbl}>System Log</div>
            {logs.map((l,i)=><div key={i} style={s.logLine}>{l}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
