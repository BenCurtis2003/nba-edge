// pages/index.jsx
// NBA Edge — public portfolio dashboard.
// All data comes from the shared server-side portfolio via /api/portfolio.
// Visitors see the same live track record. No login required.

import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const SPORTSBOOK_COLORS = {
  draftkings:"#53d337", fanduel:"#1493ff", betmgm:"#d4af37",
  caesars:"#00a4e4", pointsbet:"#e8192c", betrivers:"#003087",
  kalshi:"#00e5ff",
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

function ConvictionCard({ play, groupExpanded, onExpand }) {
  const expanded = groupExpanded;
  const tierColor = play.tier==="HIGH"?"#00ff88":play.tier==="MEDIUM"?"#ffd700":"#ff9944";
  const isAutoBet = play.convictionScore >= 70;
  return (
    <div style={{...s.convCard, cursor:"pointer", borderColor: isAutoBet?"#00ff8822":"#172030"}}
      onClick={() => onExpand()}>
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
  kalshi:"Kalshi 🔮",
};

// The 5 major books always shown on every card (in priority order)
const TOP_5_BOOKS = ["draftkings","fanduel","betmgm","betrivers","pinnacle"];

function BookOddsTable({ allLines, bestBook, type }) {
  if(!allLines) return null;
  const hasKalshi = "kalshi" in allLines;

  // Fixed display order: DraftKings, FanDuel, BetMGM, Caesars, Pinnacle, Kalshi
  const slots = [
    ...TOP_5_BOOKS.map(bk => ({ bk, val: allLines[bk] || null, isBest: bk === bestBook })),
    ...(hasKalshi ? [{ bk:"kalshi", val: allLines["kalshi"], isBest: bestBook==="kalshi" }] : []),
  ];

  return (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
        <div style={{fontSize:9, color:"#3a5570", letterSpacing:"0.08em"}}>TOP SPORTSBOOK LINES</div>
        {hasKalshi && (
          <span style={{fontSize:8, color:"#00e5ff", padding:"1px 6px", borderRadius:3,
            background:"rgba(0,229,255,0.08)", border:"1px solid rgba(0,229,255,0.2)"}}>
            🔮 Kalshi included
          </span>
        )}
      </div>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:4}}>
        {slots.map(({bk, val, isBest}) => (
          <div key={bk} style={{
            display:"flex", justifyContent:"space-between", alignItems:"center",
            padding:"5px 8px", borderRadius:6, opacity: val ? 1 : 0.35,
            background: isBest ? "rgba(0,255,136,0.06)" : bk==="kalshi" ? "rgba(0,229,255,0.04)" : "#060d16",
            border: `1px solid ${isBest ? "#00ff8833" : bk==="kalshi" ? "rgba(0,229,255,0.15)" : "#0e1a28"}`,
          }}>
            <div style={{display:"flex", alignItems:"center", gap:5}}>
              {isBest && <span style={{fontSize:7, color:"#00ff88", fontWeight:700}}>★</span>}
              <span style={{fontSize:9, color: isBest ? "#dde3ee" : "#7a90a8"}}>
                {BOOK_DISPLAY[bk] || bk}
              </span>
            </div>
            <div style={{display:"flex", gap:6, alignItems:"center"}}>
              {val?.point != null && <span style={{fontSize:8, color:"#3a5570"}}>{val.point > 0 ? `+${val.point}` : val.point}</span>}
              <span style={{fontSize:10, fontWeight:700, color: !val ? "#3a5570" : val.odds > 0 ? "#ffd700" : "#00bfff"}}>
                {!val ? "—" : val.odds > 0 ? `+${val.odds}` : val.odds}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function EVBetCard({ bet, groupExpanded, onExpand }) {
  const expanded = groupExpanded;
  const typeColor = bet.type==="Moneyline"?"#00bfff":bet.type==="Spread"?"#ffd700":"#ff69b4";
  const edgeStrength = bet.edge >= 20 ? "STRONG" : bet.edge >= 10 ? "SOLID" : "LEAN";
  const edgeColor = bet.edge >= 20 ? "#00ff88" : bet.edge >= 10 ? "#ffd700" : "#ff9944";
  const kellyWidth = Math.min(100, (bet.kellyPct / 8) * 100);

  return (
    <div onClick={() => onExpand()} style={{
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
          <div style={{fontSize:12, fontWeight:600, color:"#fff", marginBottom:2}}>{h.selection.replace(/ ML$/i,"").replace(/ Moneyline$/i,"")}</div>
          <div style={{fontSize:9, color:"#3a5570", marginBottom:4}}>{h.game}</div>
          <div style={{display:"flex", gap:5, flexWrap:"wrap", alignItems:"center"}}>
            {!h.isConviction&&<span style={{...s.badge("#00ff88")}}>⚡ +EV</span>}
            {(() => {
              const btype = h.betType || h.type || "";
              const typeLabel = btype==="Moneyline"?"💰 Moneyline":btype==="Spread"?"📊 Spread":btype==="Game Total"?"🏀 Game Total":btype;
              const typeColor = btype==="Moneyline"?"#00bfff":btype==="Spread"?"#ffd700":"#ff69b4";
              return (<>
                {h.isConviction&&<span style={{...s.badge("#b44fff")}}>🎯 Conviction</span>}
                {typeLabel&&<span style={{...s.badge("transparent"),border:`1px solid ${typeColor}`,color:typeColor,fontWeight:600}}>{typeLabel}</span>}
              </>);
            })()}
            {h.bestOdds&&<span style={{...s.badge("transparent"),border:`1px solid ${h.bestOdds<0?"#00bfff":"#ffd700"}`,color:h.bestOdds<0?"#00bfff":"#ffd700",fontWeight:700}}>{formatOdds(h.bestOdds)}</span>}
            {h.bestBook&&<span style={{...s.badge("transparent"),border:"1px solid #1e3040",color:SPORTSBOOK_COLORS[h.bestBook]||"#8899aa"}}>{BOOK_DISPLAY[h.bestBook]||h.bestBook}</span>}
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


function InfoSection({ title, children }) {
  return (
    <div style={{background:"#0a1220", border:"1px solid #172030", borderRadius:12, padding:"24px 28px", marginBottom:20}}>
      <div style={{fontSize:13, fontWeight:700, color:"#fff", marginBottom:16, letterSpacing:"0.05em"}}>{title}</div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, color="#dde3ee" }) {
  return (
    <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start",
      padding:"10px 0", borderBottom:"1px solid #0e1a28"}}>
      <span style={{fontSize:11, color:"#7a90a8", flexShrink:0, width:160}}>{label}</span>
      <span style={{fontSize:11, color, textAlign:"right", lineHeight:1.5}}>{value}</span>
    </div>
  );
}

function Step({ n, title, desc }) {
  return (
    <div style={{display:"flex", gap:16, padding:"14px 0", borderBottom:"1px solid #0e1a28"}}>
      <div style={{width:28, height:28, borderRadius:"50%", background:"rgba(0,255,136,0.1)",
        border:"1px solid #00ff8833", display:"flex", alignItems:"center", justifyContent:"center",
        flexShrink:0, fontSize:11, fontWeight:700, color:"#00ff88"}}>{n}</div>
      <div>
        <div style={{fontSize:12, fontWeight:700, color:"#fff", marginBottom:4}}>{title}</div>
        <div style={{fontSize:11, color:"#7a90a8", lineHeight:1.6}}>{desc}</div>
      </div>
    </div>
  );
}

function PropCard({ prop }) {
  const [expanded, setExpanded] = React.useState(false);
  const BOOK_DISPLAY = { draftkings:"DraftKings", fanduel:"FanDuel", betmgm:"BetMGM",
    betrivers:"BetRivers", pinnacle:"Pinnacle", caesars:"Caesars", kalshi:"Kalshi 🔮" };
  const SPORTSBOOK_COLORS = { draftkings:"#00d548", fanduel:"#1493ff", betmgm:"#c9a84c",
    betrivers:"#d4213d", pinnacle:"#00e5ff", caesars:"#b8963e", kalshi:"#b44fff" };
  const formatOdds = o => o > 0 ? `+${o}` : `${o}`;
  const edgeColor = prop.edge >= 0.08 ? "#00ff88" : prop.edge >= 0.05 ? "#ffd700" : "#ff9944";
  const convColor = prop.convictionScore >= 75 ? "#00ff88" : prop.convictionScore >= 65 ? "#ffd700" : "#ff9944";
  const autoBet = prop.convictionScore >= 65;

  const marketEmoji = {
    player_points:"🎯", player_rebounds:"🏀", player_assists:"🎪",
    player_threes:"3️⃣", player_points_rebounds_assists:"⚡",
    player_points_rebounds:"💪", player_points_assists:"🎯",
  }[prop.market] || "📊";

  return (
    <div style={{background:"#0a1220", border:`1px solid ${autoBet?"#b44fff55":"#172030"}`,
      borderRadius:12, padding:"14px 16px", position:"relative", overflow:"hidden"}}>
      {autoBet && <div style={{position:"absolute",top:0,left:0,right:0,height:2,
        background:"linear-gradient(90deg,#b44fff,#00bfff)"}}/>}

      {/* Header */}
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8}}>
        <div>
          <div style={{fontSize:13, fontWeight:700, color:"#fff", marginBottom:1}}>
            {marketEmoji} {prop.player}
          </div>
          <div style={{fontSize:9, color:"#3a5570"}}>{prop.game}</div>
          {prop.opponentTeam && <div style={{fontSize:9, color:"#1e3040"}}>vs {prop.opponentTeam}</div>}
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:22, fontWeight:800, color:convColor}}>
            {prop.convictionScore}<span style={{fontSize:10,color:"#3a5570"}}>/100</span>
          </div>
          {autoBet && <div style={{fontSize:8, color:"#b44fff", fontWeight:700}}>✓ AUTO-BET</div>}
        </div>
      </div>

      {/* Bet line */}
      <div style={{background:"#0e1a28", borderRadius:8, padding:"10px 12px", marginBottom:10}}>
        <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:6}}>
          <span style={{fontSize:15, fontWeight:800, color: prop.side==="Over"?"#00ff88":"#ff6b6b"}}>
            {prop.side} {prop.line}
          </span>
          <span style={{fontSize:10, color:"#3a5570"}}>{prop.marketLabel}</span>
          <span style={{fontSize:10, fontWeight:700, color:edgeColor, marginLeft:"auto"}}>
            +{(prop.edge*100).toFixed(1)}% edge
          </span>
        </div>

        {/* Season / L5 context */}
        {(prop.playerSeasonAvg !== null || prop.playerL5Avg !== null) && (
          <div style={{display:"flex", gap:12, marginBottom:6}}>
            {prop.playerSeasonAvg !== null && (
              <div style={{fontSize:9, color:"#3a5570"}}>
                Season avg: <span style={{color:"#8899aa",fontWeight:600}}>{prop.playerSeasonAvg.toFixed(1)}</span>
              </div>
            )}
            {prop.playerL5Avg !== null && (
              <div style={{fontSize:9, color:"#3a5570"}}>
                L5 avg: <span style={{
                  color: prop.side==="Over"
                    ? (prop.playerL5Avg > prop.line ? "#00ff88" : "#ff6b6b")
                    : (prop.playerL5Avg < prop.line ? "#00ff88" : "#ff6b6b"),
                  fontWeight:600
                }}>{prop.playerL5Avg.toFixed(1)}</span>
              </div>
            )}
          </div>
        )}

        <div style={{display:"flex", gap:6, flexWrap:"wrap", alignItems:"center"}}>
          <span style={{fontSize:12, fontWeight:700, color: prop.bestOdds>0?"#ffd700":"#00bfff"}}>
            {formatOdds(prop.bestOdds)}
          </span>
          <span style={{fontSize:9, color:SPORTSBOOK_COLORS[prop.bestBook]||"#8899aa",
            background:"#172030", padding:"2px 6px", borderRadius:4}}>
            {BOOK_DISPLAY[prop.bestBook]||prop.bestBook}
          </span>
        </div>
      </div>

      {/* Signal bars */}
      {prop.signals?.length > 0 && (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:8,color:"#3a5570",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:6}}>
            SIGNAL BREAKDOWN
          </div>
          {prop.signals.map(sig => (
            <div key={sig.key} style={{display:"flex", alignItems:"center", gap:8, marginBottom:4}}>
              <div style={{fontSize:9, color:"#3a5570", width:90, flexShrink:0}}>{sig.label}</div>
              <div style={{flex:1, height:4, background:"#0e1a28", borderRadius:2, overflow:"hidden"}}>
                <div style={{
                  height:"100%", borderRadius:2,
                  width:`${sig.score}%`,
                  background: sig.score>=70?"#00ff88":sig.score>=50?"#ffd700":"#ff6b6b",
                  transition:"width 0.5s ease"
                }}/>
              </div>
              <div style={{fontSize:9, color:"#8899aa", width:30, textAlign:"right"}}>{Math.round(sig.score)}</div>
            </div>
          ))}
        </div>
      )}

      {/* All lines toggle */}
      {prop.allLines && Object.keys(prop.allLines).length > 1 && (
        <div>
          <button onClick={() => setExpanded(e => !e)} style={{
            background:"transparent", border:"none", color:"#3a5570", cursor:"pointer",
            fontSize:9, padding:"0 0 6px", letterSpacing:"0.04em"
          }}>
            {expanded ? "▲ Hide lines" : `▼ All lines (${Object.keys(prop.allLines).length} books)`}
          </button>
          {expanded && (
            <div style={{display:"flex", gap:6, flexWrap:"wrap", marginBottom:6}}>
              {Object.entries(prop.allLines).map(([bk, val]) => (
                <div key={bk} style={{fontSize:9,
                  color: bk===prop.bestBook?"#fff":"#3a5570",
                  background: bk===prop.bestBook?"#172030":"transparent",
                  border:"1px solid #172030", borderRadius:4, padding:"2px 7px"}}>
                  <span style={{color:SPORTSBOOK_COLORS[bk]||"#3a5570", marginRight:3}}>
                    {BOOK_DISPLAY[bk]||bk}
                  </span>
                  <span style={{fontWeight:700}}>{formatOdds(val.odds)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{display:"flex", justifyContent:"space-between", fontSize:9, color:"#3a5570", borderTop:"1px solid #0e1a28", paddingTop:8, marginTop:4}}>
        <span>True prob: <span style={{color:"#8899aa"}}>{prop.trueProb?.toFixed(1)}%</span></span>
        <span>Kelly: <span style={{color:"#b44fff"}}>{prop.kellyPct?.toFixed(1)}%</span></span>
        <span>EV: <span style={{color:"#00ff88"}}>+{prop.ev?.toFixed(1)}%</span></span>
      </div>
    </div>
  );
}


function InfoTab() {
  return (
    <div style={{padding:"0 32px"}}>

      <InfoSection title="🏀 What is NBA Edge?">
        <p style={{fontSize:12, color:"#7a90a8", lineHeight:1.8, marginBottom:12}}>
          NBA Edge is a fully automated betting analysis tool. Every 8 minutes, it scans odds from
          10+ sportsbooks, runs math to find bets where the true probability of winning is higher
          than what the sportsbook is offering — these are called <span style={{color:"#00ff88", fontWeight:700}}>+EV bets</span> (positive expected value).
        </p>
        <p style={{fontSize:12, color:"#7a90a8", lineHeight:1.8}}>
          It also scores every team matchup on a 0–100 scale using stats like win rate, recent form,
          and home/away record — these are called <span style={{color:"#ffd700", fontWeight:700}}>Conviction Plays</span>.
          All bets are tracked on a $100 paper bankroll so you can see the real performance over time.
        </p>
      </InfoSection>

      <InfoSection title="📊 How to Read EV Bets">
        <p style={{fontSize:11, color:"#3a5570", marginBottom:14, lineHeight:1.6}}>
          EV bets appear on the All, Moneyline, Spread, and Game Total tabs. Each card shows you where the math says there is an edge.
        </p>
        <InfoRow label="Edge %" value="How much better your true odds are vs. what the book offers. +5% means you have a 5% mathematical advantage. Higher = better." color="#00ff88"/>
        <InfoRow label="EV %" value="Expected Value — the average profit per $100 bet over thousands of bets. +10% EV means you'd profit $10 per $100 bet long-term." color="#00ff88"/>
        <InfoRow label="Kelly %" value="How much of your bankroll to bet, calculated by the Kelly Criterion formula. A 3% Kelly on a $1,000 bankroll = bet $30." color="#b44fff"/>
        <InfoRow label="True Prob" value="Our calculated probability of this team winning, after removing the sportsbook's built-in profit margin (the 'vig')." color="#00bfff"/>
        <InfoRow label="Book Implied" value="The probability the sportsbook is pricing in. If True Prob > Book Implied, there's an edge." color="#ff6b6b"/>
        <InfoRow label="STRONG / SOLID / LEAN" value="Edge strength labels. STRONG = 20%+ edge. SOLID = 10–20%. LEAN = under 10%. Focus on STRONG and SOLID." color="#ffd700"/>
        <div style={{marginTop:16, padding:"12px 16px", background:"rgba(0,255,136,0.04)",
          border:"1px solid #00ff8822", borderRadius:8}}>
          <div style={{fontSize:10, color:"#00ff88", fontWeight:700, marginBottom:6}}>QUICK EXAMPLE</div>
          <div style={{fontSize:11, color:"#7a90a8", lineHeight:1.7}}>
            Lakers ML +140 on FanDuel. Our model says Lakers have a 45% true chance of winning.
            At +140, you need only 41.7% to break even. 45% {">"} 41.7% = <span style={{color:"#00ff88"}}>+3.3% edge</span>.
            That's an EV bet — bet it consistently and you profit long-term.
          </div>
        </div>
      </InfoSection>

      <InfoSection title="🎯 How to Read Conviction Plays">
        <p style={{fontSize:11, color:"#3a5570", marginBottom:14, lineHeight:1.6}}>
          Conviction Plays score every team in every game from 0–100 using 7 statistical signals.
          They appear alongside EV bets in the Moneyline, Spread, and Game Total tabs.
        </p>
        <InfoRow label="Score 75–100 (HIGH)" value="Strong statistical edge. These are auto-bet at 2% of bankroll." color="#00ff88"/>
        <InfoRow label="Score 58–74 (MEDIUM)" value="Moderate edge. Worth watching — consider betting smaller." color="#ffd700"/>
        <InfoRow label="Score 0–57 (WATCHLIST)" value="Weak edge or a close matchup. Informational only." color="#ff9944"/>
        <div style={{marginTop:16, marginBottom:4, fontSize:10, color:"#3a5570", letterSpacing:"0.08em"}}>THE 7 SIGNALS</div>
        <InfoRow label="Season Win Rate" value="How often the team wins this season. A 60% win rate team scores higher than a 40% team."/>
        <InfoRow label="Record vs Opponent" value="How much better this team's record is compared to tonight's opponent."/>
        <InfoRow label="Recent Form (L10)" value="Win rate over the last 10 games. Hot teams score higher."/>
        <InfoRow label="ATS Tendency" value="How the team performs relative to the spread — useful for judging if the market is mispricing them."/>
        <InfoRow label="Home/Away Record" value="Teams play differently at home vs. on the road. This uses the correct split."/>
        <InfoRow label="Opponent Form (L10)" value="How bad the opponent has been recently. A weak opponent = higher score for your team."/>
        <InfoRow label="Market Implied Prob" value="What the sportsbooks collectively think. If books agree with our model, conviction is higher."/>
      </InfoSection>

      <InfoSection title="📋 How to Actually Place a Bet">
        <Step n="1" title="Find a bet on the All or EV Bets tab"
          desc="Look for STRONG or SOLID edge bets. Click the card to expand and see all sportsbook lines."/>
        <Step n="2" title="Check the best sportsbook (★ star)"
          desc="The card shows which book has the best odds. Open that sportsbook app — DraftKings, FanDuel, BetMGM, etc."/>
        <Step n="3" title="Look up the same game and bet type"
          desc="Find the same team, same bet type (Moneyline, Spread, or Total), and confirm the odds match."/>
        <Step n="4" title="Decide how much to bet using Kelly %"
          desc="Kelly % tells you what fraction of your bankroll to risk. Start conservative — use half the Kelly recommendation until you're comfortable."/>
        <Step n="5" title="Place the bet and track it"
          desc="NBA Edge tracks results automatically. Over time, +EV bets produce profit even if individual bets lose. The edge only works at volume."/>
      </InfoSection>

      <InfoSection title="📖 Glossary">
        <InfoRow label="Moneyline (ML)" value="Bet on which team wins outright. No spread involved. -150 means bet $150 to win $100. +130 means bet $100 to win $130."/>
        <InfoRow label="Spread" value="Betting on the margin of victory. -5.5 means a team must win by 6+. +5.5 means they can lose by up to 5 and still cover."/>
        <InfoRow label="Game Total (O/U)" value="Betting on the combined score of both teams. Over 220.5 means you need both teams to score 221+ combined."/>
        <InfoRow label="Vig / Juice" value="The sportsbook's built-in profit margin. Standard is -110 on both sides of a bet (pay $110 to win $100). It's how books make money."/>
        <InfoRow label="Devigging" value="Removing the vig to find the 'true' probability. If both sides are -110, the true probability of each is 50%."/>
        <InfoRow label="Kelly Criterion" value="A formula that tells you the mathematically optimal bet size based on your edge. Avoids over-betting (ruin) and under-betting (missed profit)."/>
        <InfoRow label="Expected Value (EV)" value="The average outcome of a bet over infinite repetitions. +EV bets profit long-term even if any single bet loses."/>
        <InfoRow label="Pinnacle" value="A sharp, low-vig sportsbook used as the 'market reference' for true probabilities. Their lines are the most accurate in the world."/>
        <InfoRow label="Paper Bankroll" value="A simulated $100 bankroll used to track performance without real money. Shows whether the system works before you risk anything."/>
        <InfoRow label="ROI" value="Return on Investment — total profit divided by total amount wagered. A +8% ROI means you profit $8 for every $100 bet."/>
      </InfoSection>

      <div style={{padding:"0 4px 8px", fontSize:10, color:"#1e3040", lineHeight:1.8, textAlign:"center"}}>
        NBA Edge is a research and analytics tool. Past performance does not guarantee future results.
        Bet responsibly and within your means.
      </div>

    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("All");
  const [lastFetch, setLastFetch] = useState(null);
  const [expandedEvRows, setExpandedEvRows] = useState({});    // { rowIndex: bool }
  const [expandedConvRows, setExpandedConvRows] = useState({}); // { rowIndex: bool }

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

  const tabs = ["All","Moneyline","Spread","Game Total","Props","History","Info"];

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
  const propBets = data?.propBets || [];

  const filteredConviction = tab==="All" ? conviction : conviction.filter(p => (p.betType||"Moneyline")===tab);
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
          value={(() => { const today = new Date().toDateString(); return (data?.history||[]).filter(h => new Date(h.date).toDateString()===today).length; })()}
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
      {(tab==="All"||tab==="Moneyline"||tab==="Spread"||tab==="Game Total") && (
        <div style={s.section}>
          <div style={s.sectionTitle}>
            🎯 {tab==="All" ? "Conviction Plays" : `${tab} Conviction Plays`}
            <span style={{fontSize:9, padding:"2px 8px", borderRadius:10,
              border:"1px solid #172030", color:"#3a5570", fontWeight:400}}>
              Stat-driven · ML-weighted · auto-bet ≥70
            </span>
          </div>
          {filteredConviction.length === 0 ? (
            <div style={{color:"#3a5570", fontSize:12, padding:"20px 0"}}>
              No {tab==="All"?"conviction plays":tab.toLowerCase()+" conviction plays"} yet — engine hasn't run or no games today.
            </div>
          ) : Array.from({length: Math.ceil(filteredConviction.slice(0,9).length / 3)}, (_, rowIdx) => (
            <div key={rowIdx} style={{...s.convGrid, marginBottom:12}}>
              {filteredConviction.slice(0,9).slice(rowIdx*3, rowIdx*3+3).map(p => (
                <ConvictionCard key={p.id} play={p}
                  groupExpanded={!!expandedConvRows[rowIdx]}
                  onExpand={() => setExpandedConvRows(r => ({...r, [rowIdx]: !r[rowIdx]}))}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Current EV Bets */}
      {(tab==="All"||tab==="Moneyline"||tab==="Spread"||tab==="Game Total") && (
        <div style={s.section}>
          <div style={s.sectionTitle}>
            ⚡ {tab==="All"?"All +EV Bets":`${tab} +EV Bets`}
            <span style={{fontSize:9, padding:"2px 8px", borderRadius:10,
              border:"1px solid #00ff8833", color:"#00ff88", fontWeight:400}}>
              +EV · Odds API · {filteredBets.length} bets
            </span>
            <span style={{fontSize:9, color:"#3a5570", fontWeight:400, marginLeft:4}}>
              updated {timeAgo(data?.lastRun)}
            </span>
          </div>
          {filteredBets.length === 0 ? (
            <div style={{color:"#3a5570", fontSize:12, padding:"20px 0"}}>
              {currentBets.length===0
                ? "Engine runs every 8 minutes. Check back soon for today's EV bets."
                : "No bets match this filter."}
            </div>
          ) : (
            Array.from({length: Math.ceil(filteredBets.length / 3)}, (_, rowIdx) => (
              <div key={rowIdx} style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:12}}>
                {filteredBets.slice(rowIdx*3, rowIdx*3+3).map(bet => (
                  <EVBetCard key={bet.id} bet={bet}
                    groupExpanded={!!expandedEvRows[rowIdx]}
                    onExpand={() => setExpandedEvRows(r => ({...r, [rowIdx]: !r[rowIdx]}))}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* History */}
      {tab==="Info" && <InfoTab />}

      {/* Props Tab */}
      {tab==="Props" && (
        <div style={s.section}>
          <div style={{...s.sectionTitle, marginBottom:16}}>
            🏀 Player Props
            <span style={{fontSize:9, color:"#3a5570", fontWeight:400}}>
              {propBets.length} props with edge · auto-bet ≥65 conviction
            </span>
          </div>
          {propBets.length === 0 ? (
            <div style={{padding:"40px", textAlign:"center", color:"#3a5570", fontSize:12, background:"#0a1220", borderRadius:12, border:"1px solid #172030"}}>
              No prop edges found right now. Props are scanned every 8 minutes for pregame lines.
            </div>
          ) : (
            <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:12}}>
              {propBets.map(prop => <PropCard key={prop.id} prop={prop}/>)}
            </div>
          )}
        </div>
      )}

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
