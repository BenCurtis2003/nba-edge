// pages/index.jsx
// NBA Edge — public portfolio dashboard.
// All data comes from the shared server-side portfolio via /api/portfolio.
// Visitors see the same live track record. No login required.

import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const SPORTSBOOK_COLORS = {
  draftkings:"#53d337", fanduel:"#1493ff", betmgm:"#d4af37",
  caesars:"#00a4e4", pointsbet:"#e8192c", betrivers:"#003087"
};

function fmt$(n) { return n == null ? "—" : `$${Math.abs(n).toFixed(2)}`; }
function formatOdds(o) { if(!o) return "—"; return o > 0 ? `+${o}` : `${o}`; }
function timeAgo(iso) {
  if(!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if(mins < 1) return "just now";
  if(mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins/60)}h ${mins%60}m ago`;
}

const s = {
  page: { minHeight:"100vh", background:"#060d16", color:"#dde3ee",
    fontFamily:"'JetBrains Mono','Fira Code',monospace", padding:"0 0 60px" },
  header: { borderBottom:"1px solid #0e1a28", padding:"16px 32px",
    display:"flex", alignItems:"center", justifyContent:"space-between",
    position:"sticky", top:0, background:"#060d16", zIndex:10 },
  logo: { fontSize:18, fontWeight:800, letterSpacing:"0.15em", color:"#fff" },
  sub: { fontSize:10, color:"#3a5570", letterSpacing:"0.1em", marginTop:2 },
  pill: { fontSize:9, padding:"2px 10px", borderRadius:20,
    border:"1px solid #172030", color:"#3a5570" },
  pillGreen: { fontSize:9, padding:"2px 10px", borderRadius:20,
    border:"1px solid #00ff8833", color:"#00ff88", background:"rgba(0,255,136,0.06)" },
  statGrid: { display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12,
    padding:"24px 32px" },
  statCard: { background:"#0a1220", border:"1px solid #172030", borderRadius:12, padding:"16px 18px" },
  statLabel: { fontSize:9, color:"#3a5570", letterSpacing:"0.1em", marginBottom:8 },
  section: { padding:"0 32px", marginBottom:32 },
  sectionTitle: { fontSize:13, fontWeight:700, color:"#fff", marginBottom:14,
    display:"flex", alignItems:"center", gap:8 },
  convGrid: { display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 },
  convCard: { background:"#0a1220", border:"1px solid #172030", borderRadius:12,
    padding:"18px", position:"relative", overflow:"hidden" },
  histCard: { background:"#0a1220", border:"1px solid #172030", borderRadius:12, overflow:"hidden" },
  badge: (c) => ({ fontSize:8, padding:"1px 6px", borderRadius:3, fontWeight:700,
    background:`${c}18`, border:`1px solid ${c}44`, color:c }),
};

function StatCard({ label, value, sub, color="#00ff88" }) {
  return (
    <div style={s.statCard}>
      <div style={s.statLabel}>{label}</div>
      <div style={{fontSize:22, fontWeight:800, color, marginBottom:4}}>{value}</div>
      {sub && <div style={{fontSize:10, color:"#3a5570"}}>{sub}</div>}
    </div>
  );
}

function ConvictionCard({ play }) {
  const [expanded, setExpanded] = useState(false);
  const tierColor = play.tier==="HIGH"?"#00ff88":play.tier==="MEDIUM"?"#ffd700":"#ff9944";
  const isAutoBet = play.convictionScore >= 70;
  return (
    <div style={{...s.convCard, cursor:"pointer", borderColor: isAutoBet?"#00ff8822":"#172030"}}
      onClick={() => setExpanded(e=>!e)}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8}}>
        <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
          <span style={s.badge(tierColor)}>{play.tier}</span>
          {isAutoBet
            ? <span style={s.badge("#00ff88")}>✓ AUTO-BET</span>
            : <span style={s.badge("#3a5570")}>WATCH ONLY</span>}
          <span style={s.badge("#00bfff")}>{play.betType==="Moneyline"?"💰 ML":play.betType==="Spread"?"📊 SPR":"🏀 TOT"}</span>
        </div>
        <div style={{textAlign:"right"}}>
          <span style={{fontSize:28, fontWeight:800, color:tierColor}}>{play.convictionScore}</span>
          <span style={{fontSize:11, color:"#3a5570"}}>/100</span>
        </div>
      </div>
      <div style={{fontSize:14, fontWeight:700, color:"#fff", marginBottom:4}}>{play.selection}</div>
      <div style={{fontSize:10, color:"#3a5570", marginBottom:10}}>{play.game}</div>
      <div style={{display:"flex", gap:8, marginBottom:10}}>
        <span style={{fontSize:11, fontWeight:600, color:"#fff", padding:"2px 8px",
          background:"#0e1a28", borderRadius:4}}>{play.teamRecord}</span>
        <span style={{fontSize:10, color:"#3a5570", padding:"2px 8px", borderRadius:4}}>
          vs {play.oppRecord}
        </span>
      </div>
      {play.bestOdds && (
        <div style={{fontSize:11, color:play.bestOdds<0?"#00bfff":"#ffd700", fontWeight:700, marginBottom:8}}>
          {formatOdds(play.bestOdds)}
          {play.bestBook && <span style={{color:SPORTSBOOK_COLORS[play.bestBook]||"#3a5570",
            marginLeft:6, fontWeight:400}}>{play.bestBook}</span>}
        </div>
      )}
      {expanded && play.signals && (
        <div style={{marginTop:12, borderTop:"1px solid #0e1a28", paddingTop:12}}>
          {/* All book moneyline odds */}
          <BookOddsTable allLines={play.allLines} bestBook={play.bestBook} />

          <div style={{fontSize:9, color:"#3a5570", marginBottom:8, letterSpacing:"0.08em"}}>
            SIGNAL BREAKDOWN
          </div>
          {play.signals.map(sig => (
            <div key={sig.key} style={{marginBottom:6}}>
              <div style={{display:"flex", justifyContent:"space-between", marginBottom:2}}>
                <span style={{fontSize:9, color:"#7a90a8"}}>{sig.label}</span>
                <span style={{fontSize:9, fontWeight:700,
                  color:sig.score>=70?"#00ff88":sig.score>=55?"#ffd700":"#ff6b6b"}}>
                  {sig.score}/100
                </span>
              </div>
              <div style={{height:2, background:"#0e1a28", borderRadius:1}}>
                <div style={{height:"100%", width:`${sig.score}%`, borderRadius:1,
                  background:sig.score>=70?"#00ff88":sig.score>=55?"#ffd700":"#ff6b6b",
                  opacity:0.7}}/>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const BOOK_DISPLAY = {
  draftkings:"DraftKings", fanduel:"FanDuel", betmgm:"BetMGM",
  caesars:"Caesars", pointsbet:"PointsBet", betrivers:"BetRivers",
  lowvig:"LowVig", betonlineag:"BetOnline", bovada:"Bovada",
  mybookieag:"MyBookie", betus:"BetUS", pinnacle:"Pinnacle",
};

function BookOddsTable({ allLines, bestBook, type }) {
  if(!allLines || !Object.keys(allLines).length) return null;
  const sorted = Object.entries(allLines).sort((a,b) => {
    const ao = a[1].odds, bo = b[1].odds;
    return bo - ao; // best odds first
  });
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:9, color:"#3a5570", letterSpacing:"0.08em", marginBottom:8}}>
        ALL SPORTSBOOK LINES
      </div>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:4}}>
        {sorted.map(([bk, val]) => {
          const isBest = bk === bestBook;
          const odds = val.odds;
          const point = val.point;
          return (
            <div key={bk} style={{
              display:"flex", justifyContent:"space-between", alignItems:"center",
              padding:"5px 8px", borderRadius:6,
              background: isBest ? "rgba(0,255,136,0.06)" : "#060d16",
              border: `1px solid ${isBest ? "#00ff8833" : "#0e1a28"}`,
            }}>
              <div style={{display:"flex", alignItems:"center", gap:5}}>
                {isBest && <span style={{fontSize:7, color:"#00ff88", fontWeight:700}}>★</span>}
                <span style={{fontSize:9, color: isBest ? "#dde3ee" : "#7a90a8"}}>
                  {BOOK_DISPLAY[bk] || bk}
                </span>
              </div>
              <div style={{display:"flex", gap:6, alignItems:"center"}}>
                {point != null && <span style={{fontSize:8, color:"#3a5570"}}>{point > 0 ? `+${point}` : point}</span>}
                <span style={{
                  fontSize:10, fontWeight:700,
                  color: odds > 0 ? "#ffd700" : "#00bfff",
                }}>
                  {odds > 0 ? `+${odds}` : odds}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EVBetCard({ bet }) {
  const [expanded, setExpanded] = useState(false);
  const typeColor = bet.type==="Moneyline"?"#00bfff":bet.type==="Spread"?"#ffd700":"#ff69b4";
  const edgeStrength = bet.edge >= 20 ? "STRONG" : bet.edge >= 10 ? "SOLID" : "LEAN";
  const edgeColor = bet.edge >= 20 ? "#00ff88" : bet.edge >= 10 ? "#ffd700" : "#ff9944";
  const kellyWidth = Math.min(100, (bet.kellyPct / 8) * 100);

  return (
    <div onClick={() => setExpanded(e=>!e)} style={{
      background:"#0a1220", border:`1px solid ${expanded?"#00ff8833":"#172030"}`,
      borderRadius:12, padding:"16px", cursor:"pointer", transition:"border-color 0.2s",
    }}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6}}>
        <div style={{display:"flex", gap:5, flexWrap:"wrap"}}>
          <span style={s.badge(typeColor)}>{bet.type}</span>
          <span style={s.badge(edgeColor)}>{edgeStrength}</span>
        </div>
        <span style={{fontSize:10, color:"#3a5570"}}>{expanded?"▲":"▼"}</span>
      </div>
      <div style={{fontSize:14, fontWeight:700, color:"#fff", marginBottom:2}}>{bet.selection}</div>
      <div style={{fontSize:10, color:"#3a5570", marginBottom:10}}>{bet.game}</div>
      <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:10}}>
        <span style={{fontSize:13, fontWeight:700, color:bet.bestOdds<0?"#00bfff":"#ffd700"}}>
          {formatOdds(bet.bestOdds)}
        </span>
        <span style={{fontSize:9, color:SPORTSBOOK_COLORS[bet.bestBook]||"#3a5570", fontWeight:600}}>
          {BOOK_DISPLAY[bet.bestBook]||bet.bestBook}
        </span>
        <span style={{fontSize:8, color:"#1e3040", marginLeft:"auto"}}>★ best line</span>
      </div>
      <div style={{display:"flex", gap:14, fontSize:10}}>
        <div>Edge <span style={{color:"#00ff88", fontWeight:700}}>+{bet.edge?.toFixed(1)}%</span></div>
        <div>EV <span style={{color:"#00ff88", fontWeight:700}}>+{bet.ev?.toFixed(1)}%</span></div>
        <div>Kelly <span style={{color:"#b44fff", fontWeight:700}}>{bet.kellyPct?.toFixed(1)}%</span></div>
      </div>

      {expanded && (
        <div style={{marginTop:14, borderTop:"1px solid #0e1a28", paddingTop:14}}>
          {/* All book lines */}
          <BookOddsTable allLines={bet.allLines} bestBook={bet.bestBook} type={bet.type} />

          {/* Probability breakdown */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:9, color:"#3a5570", letterSpacing:"0.08em", marginBottom:8}}>PROBABILITY ANALYSIS</div>
            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8}}>
              {[
                { label:"True Prob",    value:`${bet.ourProbability?.toFixed(1)}%`, color:"#00ff88" },
                { label:"Book Implied", value:`${bet.bookImplied?.toFixed(1)}%`,    color:"#ff6b6b" },
                { label:"Our Edge",     value:`+${bet.edge?.toFixed(1)}%`,           color:"#00bfff" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{background:"#060d16", borderRadius:6, padding:"8px 10px",
                  border:"1px solid #0e1a28", textAlign:"center"}}>
                  <div style={{fontSize:8, color:"#3a5570", marginBottom:3}}>{label}</div>
                  <div style={{fontSize:13, fontWeight:700, color}}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Kelly sizing bar */}
          <div style={{marginBottom:14}}>
            <div style={{display:"flex", justifyContent:"space-between", marginBottom:4}}>
              <span style={{fontSize:9, color:"#3a5570", letterSpacing:"0.08em"}}>KELLY SIZING</span>
              <span style={{fontSize:9, color:"#b44fff", fontWeight:700}}>{bet.kellyPct?.toFixed(1)}% of bankroll</span>
            </div>
            <div style={{height:4, background:"#0e1a28", borderRadius:2}}>
              <div style={{height:"100%", width:`${kellyWidth}%`, borderRadius:2,
                background:"linear-gradient(90deg, #b44fff, #ff69b4)", opacity:0.8}}/>
            </div>
            <div style={{fontSize:8, color:"#1e3040", marginTop:3}}>Max bet = 8% · This bet = {bet.kellyPct?.toFixed(1)}%</div>
          </div>

          <div style={{background:"#060d16", borderRadius:8, padding:"10px 12px",
            border:"1px solid #0e1a28", fontSize:9, color:"#7a90a8", lineHeight:1.6}}>
            <span style={{color:"#00ff88", fontWeight:700}}>Why this bet? </span>
            True win probability ({bet.ourProbability?.toFixed(1)}%) exceeds the book implied odds ({bet.bookImplied?.toFixed(1)}%),
            a {bet.edge?.toFixed(1)}% edge. At {formatOdds(bet.bestOdds)} on {BOOK_DISPLAY[bet.bestBook]||bet.bestBook},
            this is a {bet.ev?.toFixed(1)}% EV bet. Kelly Criterion recommends {bet.kellyPct?.toFixed(1)}% of bankroll.
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ h }) {
  const isWon = h.status==="won", isLost = h.status==="lost", isPending = h.status==="pending";
  const pnl = isWon ? h.potentialPayout : isLost ? -h.wagerAmt : null;
  const accentColor = isWon?"#00ff88":isLost?"#ff6b6b":isPending?"#ffd700":"#3a5570";
  return (
    <div style={{borderBottom:"1px solid #0e1a28",
      background:isWon?"rgba(0,255,136,0.03)":isLost?"rgba(255,107,107,0.03)":"transparent"}}>
      <div style={{display:"grid", gridTemplateColumns:"100px 1fr auto", gap:12,
        padding:"12px 20px", alignItems:"center"}}>
        <div>
          <div style={{display:"flex", alignItems:"center", gap:5, marginBottom:3}}>
            <div style={{width:5, height:5, borderRadius:"50%", background:accentColor}}/>
            <span style={{fontSize:8, fontWeight:700, color:accentColor, letterSpacing:"0.08em"}}>
              {isWon?(h.estimatedResult?"WIN ~":"WIN ✓"):isLost?(h.estimatedResult?"LOSS ~":"LOSS ✗"):isPending?"PENDING":"VOID"}
            </span>
          </div>
          <div style={{fontSize:9, color:"#3a5570"}}>
            {new Date(h.date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
          </div>
          <div style={{fontSize:8, color:"#1e3040"}}>
            {new Date(h.date).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}
          </div>
        </div>
        <div>
          <div style={{fontSize:12, fontWeight:600, color:"#fff", marginBottom:2}}>{h.selection}</div>
          <div style={{fontSize:9, color:"#3a5570", marginBottom:4}}>{h.game}</div>
          <div style={{display:"flex", gap:5, flexWrap:"wrap", alignItems:"center"}}>
            <span style={{...s.badge(h.isConviction?"#b44fff":h.type==="Moneyline"?"#00bfff":h.type==="Spread"?"#ffd700":"#ff69b4")}}>
              {h.isConviction?`🎯 ${h.betType||"Conviction"}`:h.type}
            </span>
            {h.bestOdds&&<span style={{fontSize:9,fontWeight:700,color:h.bestOdds<0?"#00bfff":"#ffd700"}}>{formatOdds(h.bestOdds)}</span>}
            {h.bestBook&&<span style={{fontSize:8,color:SPORTSBOOK_COLORS[h.bestBook]||"#3a5570"}}>{h.bestBook}</span>}
            <span style={{...s.badge("#b44fff")}}>
              Kelly {h.kellyPct>0?h.kellyPct.toFixed(1):h.wagerAmt&&h.bankrollBefore?(h.wagerAmt/h.bankrollBefore*100).toFixed(1):"2.0"}%
            </span>
            {h.edge>0&&!h.isConviction&&<span style={{...s.badge("#00ff88")}}>+{h.edge?.toFixed(1)}% edge</span>}
          </div>
        </div>
        <div style={{textAlign:"right", minWidth:120}}>
          {pnl !== null && (
            <div style={{fontSize:18, fontWeight:800, color:accentColor}}>
              {pnl>0?"+":""}{fmt$(pnl)}
            </div>
          )}
          <div style={{fontSize:9, color:"#3a5570", marginTop:2}}>
            Wagered <span style={{color:"#ffd700", fontWeight:600}}>{fmt$(h.wagerAmt)}</span>
          </div>
          <div style={{fontSize:9, color:"#3a5570", marginTop:1}}>
            To win <span style={{color:"#00ff88", fontWeight:600}}>
              {(() => {
                const odds = h.bestOdds || -110;
                const wager = h.wagerAmt || 0;
                const profit = odds > 0 ? wager * (odds/100) : wager * (100/Math.abs(odds));
                return `+$${profit.toFixed(2)}`;
              })()}
            </span>
          </div>
          <div style={{fontSize:9, color:"#3a5570", marginTop:1}}>
            Kelly <span style={{color:"#b44fff",fontWeight:600}}>
              {h.kellyPct>0?h.kellyPct.toFixed(1):h.wagerAmt&&h.bankrollBefore?(h.wagerAmt/h.bankrollBefore*100).toFixed(1):"2.0"}%
            </span>
            {" · "}<span style={{color:"#dde3ee"}}>{fmt$(h.bankrollAfter)}</span>
          </div>
        </div>
      </div>
      {!isPending && (
        <div style={{height:1.5, background:"#0e1a28"}}>
          <div style={{height:"100%",
            width:`${Math.min(100,Math.abs(pnl||0)/(h.wagerAmt||1)*50+50)}%`,
            background:accentColor, opacity:0.4}}/>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("All");
  const [lastFetch, setLastFetch] = useState(null);

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastFetch(new Date());
    } catch(e) {
      console.error("Portfolio fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPortfolio();
    const interval = setInterval(fetchPortfolio, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, [fetchPortfolio]);

  const tabs = ["All","Moneyline","Spread","Game Total","Conviction","History"];

  // Chart data
  const chartData = (() => {
    if(!data?.history?.length) return [];
    const resolved = [...data.history]
      .sort((a,b) => new Date(a.date)-new Date(b.date))
      .filter(h => h.status==="won"||h.status==="lost");
    if(!resolved.length) return [{bankroll:100, date:"Start"}];
    const pts = [{bankroll:100, date:"Start", status:"start"}];
    resolved.forEach(h => pts.push({bankroll:h.bankrollAfter, date:h.date, status:h.status}));
    return pts;
  })();

  const conviction = data?.convictionPlays || [];
  const history = data?.history || [];
  const currentBets = data?.currentBets || [];

  const filteredConviction = tab==="Conviction"||tab==="All" ? conviction : [];
  const filteredHistory = tab==="History" ? history : [];
  const filteredBets = tab==="All"||tab==="Moneyline"||tab==="Spread"||tab==="Game Total"
    ? currentBets.filter(b => tab==="All" || b.type===tab)
    : [];

  if(loading) return (
    <div style={{...s.page, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:32, marginBottom:12}}>🏀</div>
        <div style={{fontSize:12, color:"#3a5570", letterSpacing:"0.1em"}}>LOADING NBA EDGE...</div>
      </div>
    </div>
  );

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={{display:"flex", alignItems:"center", gap:10}}>
            <span style={{fontSize:20}}>🏀</span>
            <div style={s.logo}>NBA EDGE</div>
          </div>
          <div style={s.sub}>EV BETTING ENGINE · ML LEARNING · FULLY AUTOMATED</div>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:10}}>
          <div style={{display:"flex", alignItems:"center", gap:6}}>
            <div style={{width:6, height:6, borderRadius:"50%", background:"#00ff88",
              boxShadow:"0 0 6px #00ff88", animation:"pulse 2s infinite"}}/>
            <span style={{fontSize:10, color:"#3a5570"}}>
              Updated {timeAgo(data?.lastRun)}
            </span>
          </div>
          <span style={s.pill}>Auto-runs every 8 min</span>
          <span style={s.pillGreen}>Live Track Record</span>
        </div>
      </div>

      {/* Stats */}
      <div style={s.statGrid}>
        <StatCard label="PAPER BANKROLL"
          value={`$${(data?.bankroll||100).toFixed(2)}`}
          sub={`${data?.totalPnl>=0?"+":""}$${(data?.totalPnl||0).toFixed(2)} P&L`}
          color="#00ff88"/>
        <StatCard label="WIN RATE"
          value={`${data?.winRate||0}%`}
          sub={`${data?.record?.wins||0}W / ${data?.record?.losses||0}L`}
          color="#00bfff"/>
        <StatCard label="ROI"
          value={`${data?.roi>=0?"+":""}${data?.roi||0}%`}
          sub="on resolved bets"
          color={data?.roi>=0?"#00ff88":"#ff6b6b"}/>
        <StatCard label="BETS TODAY"
          value={currentBets.length}
          sub={`${conviction.filter(p=>p.convictionScore>=70).length} auto-bet conviction plays`}
          color="#ffd700"/>
        <StatCard label="ML ENGINE"
          value={data?.mlStatus||"Learning"}
          sub={`${data?.mlBets||0} bets analyzed`}
          color="#b44fff"/>
      </div>

      {/* Tabs */}
      <div style={{padding:"0 32px", marginBottom:20}}>
        <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding:"6px 16px", borderRadius:20, fontSize:11, cursor:"pointer",
              border:`1px solid ${tab===t?"#00ff88":"#172030"}`,
              background: tab===t?"rgba(0,255,136,0.1)":"transparent",
              color: tab===t?"#00ff88":"#3a5570", fontFamily:"inherit",
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Conviction Plays */}
      {(tab==="All"||tab==="Conviction") && conviction.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>
            🎯 Conviction Plays
            <span style={{fontSize:9, padding:"2px 8px", borderRadius:10,
              border:"1px solid #172030", color:"#3a5570", fontWeight:400}}>
              Stat-driven · ML-weighted · EV-agnostic
            </span>
          </div>
          <div style={{fontSize:11, color:"#3a5570", marginBottom:14}}>
            Picks based on team form, rest, point differential & matchup data.
            Plays ≥70/100 are automatically placed in the portfolio.
          </div>
          <div style={s.convGrid}>
            {conviction.slice(0,9).map(p => <ConvictionCard key={p.id} play={p}/>)}
          </div>
        </div>
      )}

      {/* Current EV Bets */}
      {(tab==="All"||tab==="Moneyline"||tab==="Spread"||tab==="Game Total") && (
        <div style={s.section}>
          <div style={s.sectionTitle}>
            📊 {tab==="All"?"Today's EV Bets":tab}
            <span style={{fontSize:9, color:"#3a5570", fontWeight:400}}>
              {filteredBets.length} bets · updated {timeAgo(data?.lastRun)}
            </span>
          </div>
          {filteredBets.length === 0 ? (
            <div style={{color:"#3a5570", fontSize:12, padding:"20px 0"}}>
              {currentBets.length===0
                ? "Engine runs every 8 minutes. Check back soon for today's EV bets."
                : "No bets match this filter."}
            </div>
          ) : (
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:12}}>
              {filteredBets.map(bet => <EVBetCard key={bet.id} bet={bet}/>)}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {tab==="History" && (
        <div style={s.section}>
          {/* Portfolio Chart */}
          <div style={{background:"#0a1220",border:"1px solid #172030",borderRadius:12,padding:"20px 24px",marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
              <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Portfolio Performance</div>
              <div style={{fontSize:10,color:(data?.totalPnl||0)>=0?"#00ff88":"#ff6b6b",fontWeight:700}}>
                {(data?.totalPnl||0)>=0?"+":""}${(data?.totalPnl||0).toFixed(2)} P&L
              </div>
            </div>
            <div style={{fontSize:10,color:"#3a5570",marginBottom:16}}>
              $100 starting bankroll · Kelly Criterion sizing · ML-weighted signals
            </div>
            {chartData.length < 2 ? (
              <div style={{height:140,display:"flex",flexDirection:"column",alignItems:"center",
                justifyContent:"center",borderTop:"1px solid #0e1a28",paddingTop:20}}>
                <div style={{fontSize:28,marginBottom:8,opacity:0.3}}>📈</div>
                <div style={{fontSize:11,color:"#3a5570"}}>Chart populates as bets resolve</div>
                <div style={{fontSize:10,color:"#1e3040",marginTop:4}}>
                  {history.filter(h=>h.status==="pending").length} bets pending · check back after tonight's games
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <XAxis dataKey="date"
                    tickFormatter={d=>d==="Start"?"Start":new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                    tick={{fill:"#3a5570",fontSize:9}} axisLine={false} tickLine={false}/>
                  <YAxis domain={["auto","auto"]} tickFormatter={v=>`$${v.toFixed(0)}`}
                    tick={{fill:"#3a5570",fontSize:9}} axisLine={false} tickLine={false} width={45}/>
                  <Tooltip contentStyle={{background:"#0e1a28",border:"1px solid #172030",borderRadius:8,fontSize:10}}
                    formatter={v=>[`$${v.toFixed(2)}`,"Bankroll"]}
                    labelFormatter={l=>l==="Start"?"Start":new Date(l).toLocaleDateString()}/>
                  <ReferenceLine y={100} stroke="#172030" strokeDasharray="3 3"/>
                  <Line type="monotone" dataKey="bankroll" stroke="#00bfff" strokeWidth={2}
                    dot={p=>p.payload.status!=="start"
                      ?<circle key={p.key} cx={p.cx} cy={p.cy} r={4} fill={p.payload.status==="won"?"#00ff88":"#ff6b6b"} stroke="none"/>
                      :<circle key={p.key} cx={p.cx} cy={p.cy} r={3} fill="#3a5570" stroke="none"/>}/>
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div style={s.sectionTitle}>
            📋 Bet History
            <span style={{fontSize:9, color:"#3a5570", fontWeight:400}}>
              {history.length} total · {data?.record?.wins||0} won · {data?.record?.losses||0} lost
            </span>
          </div>
          <div style={s.histCard}>
            {history.length === 0 ? (
              <div style={{padding:"40px", textAlign:"center", color:"#3a5570", fontSize:12}}>
                No bets recorded yet. The engine runs every 8 minutes automatically.
              </div>
            ) : (
              [...history].reverse().map(h => <HistoryRow key={h.id} h={h}/>)
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        button { font-family: inherit; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #060d16; }
        ::-webkit-scrollbar-thumb { background: #172030; border-radius: 2px; }
      `}</style>
    </div>
  );
}
