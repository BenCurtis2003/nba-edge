// pages/index.jsx — NBA Edge v2 Professional UI
import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from "recharts";

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const BOOK_META = {
  draftkings: { label:"DraftKings", color:"#53d337", short:"DK"  },
  fanduel:    { label:"FanDuel",    color:"#1493ff", short:"FD"  },
  betmgm:     { label:"BetMGM",     color:"#d4af37", short:"MGM" },
  betrivers:  { label:"BetRivers",  color:"#d4213d", short:"BR"  },
  caesars:    { label:"Caesars",    color:"#00a4e4", short:"CZR" },
  pinnacle:   { label:"Pinnacle",   color:"#e8e8e8", short:"PIN" },
  lowvig:     { label:"LowVig",     color:"#aaffaa", short:"LV"  },
  betonlineag:{ label:"BetOnline",  color:"#ff9933", short:"BOL" },
  bovada:     { label:"Bovada",     color:"#cc0000", short:"BOV" },
  kalshi:     { label:"Kalshi",     color:"#b44fff", short:"KAL" },
  espnbet:    { label:"ESPN Bet",   color:"#e31837", short:"ESPN" },
  fanatics:   { label:"Fanatics",   color:"#022B5B", short:"FAN" },
  fliff:      { label:"Fliff",      color:"#00d4ff", short:"FLF" },
  prizepicks: { label:"PrizePicks", color:"#7c3aed", short:"PP"  },
};

const ALL_BOOKS = [
  { id:"draftkings", label:"DraftKings", color:"#53d337" },
  { id:"fanduel",    label:"FanDuel",    color:"#1493ff" },
  { id:"betmgm",     label:"BetMGM",     color:"#d4af37" },
  { id:"betrivers",  label:"BetRivers",  color:"#d4213d" },
  { id:"caesars",    label:"Caesars",    color:"#00a4e4" },
  { id:"pinnacle",   label:"Pinnacle",   color:"#e8e8e8" },
  { id:"lowvig",     label:"LowVig",     color:"#aaffaa" },
  { id:"kalshi",     label:"Kalshi",     color:"#b44fff" },
  { id:"espnbet",    label:"ESPN Bet",   color:"#e31837" },
  { id:"fanatics",   label:"Fanatics",   color:"#022B5B" },
  { id:"fliff",      label:"Fliff",      color:"#00d4ff" },
  { id:"prizepicks", label:"PrizePicks", color:"#7c3aed" },
];

const TOP_5_BOOKS = ["draftkings","fanduel","betmgm","betrivers","pinnacle"];

const PROP_MARKET_FILTERS = [
  { id:"all",                              label:"All Props" },
  { id:"player_points",                    label:"Points" },
  { id:"player_rebounds",                  label:"Rebounds" },
  { id:"player_assists",                   label:"Assists" },
  { id:"player_threes",                    label:"3-Pointers" },
  { id:"player_points_rebounds_assists",   label:"PRA" },
  { id:"player_points_rebounds",           label:"Pts+Reb" },
  { id:"player_points_assists",            label:"Pts+Ast" },
];

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt$    = n  => n == null ? "—" : `$${Math.abs(n).toFixed(2)}`;
const fmtOdds = o  => !o ? "—" : o > 0 ? `+${o}` : `${o}`;
const timeAgo = iso => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins/60)}h ${mins%60}m ago`;
};

// Engine cron schedule: 8:30am, 11:30am, 3:30pm, 6:15pm PST
const CRON_SCHEDULE_PST = [
  { h:8,  m:30 }, { h:11, m:30 }, { h:15, m:30 }, { h:18, m:15 },
];
function getNextRunTime() {
  const now = new Date();
  // Convert to PST (UTC-8, or UTC-7 PDT)
  const pstOffset = -8 * 60;
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const pstMins = ((utcMins + pstOffset) % 1440 + 1440) % 1440;
  const pstH = Math.floor(pstMins / 60), pstM = pstMins % 60;
  for (const slot of CRON_SCHEDULE_PST) {
    const slotMins = slot.h * 60 + slot.m;
    if (slotMins > pstH * 60 + pstM) {
      const hh = slot.h % 12 || 12;
      const mm = String(slot.m).padStart(2,"0");
      const ampm = slot.h >= 12 ? "PM" : "AM";
      return `${hh}:${mm} ${ampm} PST`;
    }
  }
  return "8:30 AM PST tomorrow";
}
function getStatusDotColor(lastRun) {
  if (!lastRun) return T.red;
  const hrs = (Date.now() - new Date(lastRun)) / 3600000;
  if (hrs < 6) return T.green;
  if (hrs < 12) return T.gold;
  return T.red;
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:       "#060c14",
  surface:  "#0b1520",
  border:   "#13233a",
  borderHi: "#1c3350",
  text:     "#c8d8e8",
  textDim:  "#4a6480",
  textMid:  "#7a90a8",
  green:    "#00e87a",
  blue:     "#38bdf8",
  gold:     "#f59e0b",
  red:      "#f87171",
  purple:   "#a78bfa",
  discord:  "#5865f2",
};

// ── Live Scores Bar ───────────────────────────────────────────────────────────
function ScoresBar({ games }) {
  if (!games || !games.length) return null;
  return (
    <div style={{
      background: T.bg, borderBottom: `1px solid ${T.border}`,
      display: "flex", alignItems: "center",
      overflowX: "auto", WebkitOverflowScrolling: "touch",
      scrollbarWidth: "none", msOverflowStyle: "none",
      padding: "10px 28px", gap: 8,
    }}>
      {games.map((g, i) => (
        <div key={i} style={{
          flexShrink: 0, width: 140, height: 56,
          background: T.surface,
          border: `1px solid ${g.live ? T.green + "55" : T.border}`,
          borderLeft: g.live ? `2px solid ${T.green}` : `1px solid ${T.border}`,
          borderRadius: 10,
          padding: "7px 10px",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
          opacity: g.final ? 0.5 : 1,
        }}>
          {/* Teams row */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:10, fontWeight:700, color:"#fff", letterSpacing:"0.05em" }}>{g.away}</span>
            <span style={{ fontSize:9, color: T.textDim }}>·</span>
            <span style={{ fontSize:10, fontWeight:700, color:"#fff", letterSpacing:"0.05em" }}>{g.home}</span>
          </div>
          {/* Scores / tip time row */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            {(g.live || g.final) ? (
              <>
                <span style={{ fontSize:17, fontWeight:800, color:"#fff",
                  fontFamily:"'DM Mono',monospace" }}>{g.awayScore}</span>
                <span style={{ fontSize:17, fontWeight:800, color:"#fff",
                  fontFamily:"'DM Mono',monospace" }}>{g.homeScore}</span>
              </>
            ) : (
              <span style={{ fontSize:11, fontWeight:600, color: T.textMid, width:"100%", textAlign:"center" }}>{g.tipTime}</span>
            )}
          </div>
          {/* Status row */}
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            {g.live && (
              <span style={{
                fontSize:7, fontWeight:800, padding:"1px 5px", borderRadius:3,
                background:`${T.green}20`, border:`1px solid ${T.green}55`, color:T.green,
                letterSpacing:"0.08em", flexShrink:0,
              }}>LIVE</span>
            )}
            <span style={{ fontSize:9, color: T.textDim, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {g.live ? g.status.replace(/^LIVE · /,"") : g.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
const badge = (c, text) => (
  <span style={{
    display:"inline-flex", alignItems:"center",
    fontSize:9, fontWeight:700, letterSpacing:"0.06em",
    padding:"2px 7px", borderRadius:4,
    background:`${c}18`, border:`1px solid ${c}33`, color:c,
  }}>{text}</span>
);

// ── Pill ──────────────────────────────────────────────────────────────────────
const Pill = ({ color, children, glow }) => (
  <span style={{
    display:"inline-flex", alignItems:"center", gap:4,
    fontSize:9, padding:"3px 10px", borderRadius:20,
    border:`1px solid ${color}44`,
    background: glow ? `${color}12` : "transparent",
    color, fontWeight: glow ? 700 : 400,
    boxShadow: glow ? `0 0 10px ${color}20` : "none",
  }}>{children}</span>
);

// ── Score Ring ────────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 52 }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 75 ? T.green : score >= 60 ? T.gold : T.red;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.border} strokeWidth={3}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          style={{ transition:"stroke-dasharray 0.6s ease" }}/>
      </svg>
      <div style={{
        position:"absolute", inset:0, display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
      }}>
        <span style={{ fontSize:size > 48 ? 14 : 11, fontWeight:800, color, lineHeight:1,
          fontFamily:"'DM Mono',monospace" }}>{score}</span>
      </div>
    </div>
  );
}

// ── Signal Bar ────────────────────────────────────────────────────────────────
function SignalBar({ label, score }) {
  const color = score >= 70 ? T.green : score >= 50 ? T.gold : T.red;
  return (
    <div style={{ marginBottom:6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
        <span style={{ fontSize:10, color:T.textMid }}>{label}</span>
        <span style={{ fontSize:10, fontWeight:700, color }}>{score}</span>
      </div>
      <div style={{ height:3, background:T.border, borderRadius:2, overflow:"hidden" }}>
        <div style={{
          height:"100%", width:`${score}%`, borderRadius:2,
          background:`linear-gradient(90deg, ${color}99, ${color})`,
          transition:"width 0.5s ease",
        }}/>
      </div>
    </div>
  );
}

// ── Book Odds Row ─────────────────────────────────────────────────────────────
function BookLine({ bk, val, isBest }) {
  const meta = BOOK_META[bk] || { label:bk, color:T.textDim, short:bk.slice(0,3).toUpperCase() };
  return (
    <div style={{
      display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"6px 10px", borderRadius:7, marginBottom:3,
      background: isBest ? `${T.green}0a` : "transparent",
      border:`1px solid ${isBest ? T.green + "33" : T.border}`,
      opacity: val ? 1 : 0.3,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:7 }}>
        {isBest && <span style={{ fontSize:8, color:T.green }}>★</span>}
        <span style={{ fontSize:11, color: isBest ? T.text : T.textMid, fontWeight: isBest ? 600 : 400 }}>
          {meta.label}
        </span>
      </div>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        {val?.point != null && (
          <span style={{ fontSize:10, color:T.textDim }}>
            {val.point > 0 ? `+${val.point}` : val.point}
          </span>
        )}
        <span style={{
          fontSize:13, fontWeight:700,
          color: !val ? T.textDim : val.odds > 0 ? T.gold : T.blue,
        }}>
          {!val ? "—" : fmtOdds(val.odds)}
        </span>
        {isBest && <span style={{ fontSize:8, color:T.green, padding:"1px 5px", borderRadius:3, background:`${T.green}15`, border:`1px solid ${T.green}33` }}>BEST</span>}
      </div>
    </div>
  );
}

function BookOddsTable({ allLines, bestBook }) {
  if (!allLines) return null;
  const hasKalshi = "kalshi" in allLines;
  const slots = [
    ...TOP_5_BOOKS.map(bk => ({ bk, val: allLines[bk] || null, isBest: bk === bestBook })),
    ...(hasKalshi ? [{ bk:"kalshi", val: allLines["kalshi"], isBest: bestBook==="kalshi" }] : []),
  ];
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:9, color:T.textDim, letterSpacing:"0.1em", marginBottom:8, textTransform:"uppercase" }}>
        Sportsbook Lines
      </div>
      {slots.map(({ bk, val, isBest }) => (
        <BookLine key={bk} bk={bk} val={val} isBest={isBest} />
      ))}
    </div>
  );
}

// ── Get At Or Better chip ─────────────────────────────────────────────────────
function GetAtOrBetter({ value, color = T.gold }) {
  if (!value) return null;
  return (
    <div style={{
      display:"flex", alignItems:"center", justifyContent:"space-between",
      padding:"10px 14px", borderRadius:9, marginTop:10,
      background:`${color}08`, border:`1px solid ${color}30`,
    }}>
      <div>
        <div style={{ fontSize:8, color:T.textDim, letterSpacing:"0.12em", marginBottom:2 }}>GET AT OR BETTER</div>
        <div style={{ fontSize:9, color:T.textMid }}>Walk away if line moves past this</div>
      </div>
      <div style={{ textAlign:"right" }}>
        <div style={{ fontSize:22, fontWeight:800, color, letterSpacing:"0.02em" }}>{fmtOdds(value)}</div>
      </div>
    </div>
  );
}

// ── Value Quality Signal ──────────────────────────────────────────────────────
function ValueQualityTag({ bestOdds, getAtOrBetter }) {
  if (bestOdds == null || getAtOrBetter == null) return null;
  // For negative odds (favorites): bestOdds closer to 0 is better (e.g. -105 > -120)
  // For positive odds (underdogs): higher is better
  const isGoodValue = bestOdds >= 0
    ? bestOdds >= getAtOrBetter
    : bestOdds >= getAtOrBetter;
  if (isGoodValue) {
    return (
      <span style={{
        fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
        color: "#00e87a", background: "#00e87a12", border: "1px solid #00e87a33",
        marginLeft: 6,
      }}>✓ Good value</span>
    );
  }
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
      color: "#f59e0b", background: "#f59e0b12", border: "1px solid #f59e0b33",
      marginLeft: 6,
    }}>⚠ Line moved</span>
  );
}

// ── Inline Book Chips ─────────────────────────────────────────────────────────
function BookChips({ allLines, bestBook }) {
  if (!allLines) return null;
  const entries = Object.entries(allLines)
    .filter(([, val]) => val != null)
    .slice(0, 6);
  if (!entries.length) return null;
  return (
    <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:8 }}>
      {entries.map(([bk, val]) => {
        const isBest = bk === bestBook;
        const meta = BOOK_META[bk] || { short: bk.slice(0,3).toUpperCase() };
        const oddsColor = val.odds > 0 ? T.gold : T.blue;
        return (
          <span key={bk} style={{
            padding:"3px 7px", borderRadius:6, fontSize:9, fontFamily:"inherit",
            background: T.bg,
            border: isBest ? `1px solid ${T.green}55` : `1px solid ${T.border}`,
            color: isBest ? T.green : oddsColor,
          }}>
            {meta.short} {fmtOdds(val.odds)}
          </span>
        );
      })}
    </div>
  );
}

// ── Conviction Card ───────────────────────────────────────────────────────────
function ConvictionCard({ play, expanded, onExpand }) {
  const isAutoBet = play.convictionScore >= 70;
  const accentColor = play.tier === "HIGH" ? T.green : play.tier === "MEDIUM" ? T.gold : T.red;
  const betTypeLabel = play.betType === "Moneyline" ? "ML" : play.betType === "Spread" ? "SPR" : "TOT";
  const betTypeColor = play.betType === "Moneyline" ? T.blue : play.betType === "Spread" ? T.gold : "#f472b6";

  return (
    <div onClick={onExpand} style={{
      background: T.surface,
      border:`1px solid ${isAutoBet ? accentColor + "55" : expanded ? accentColor + "44" : T.border}`,
      borderRadius:14, cursor:"pointer", overflow:"hidden",
      transition:"border-color 0.2s, box-shadow 0.2s",
      boxShadow: expanded ? `0 4px 24px ${accentColor}12, inset 0 0 32px ${accentColor}05` : "none",
    }}>
      {/* Top accent bar */}
      <div style={{ height:2, background:`linear-gradient(90deg, ${accentColor}cc, ${accentColor}22, transparent)` }}/>

      <div style={{ padding:"16px 18px" }}>
        {/* Header row */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", flex:1, marginRight:12 }}>
            {isAutoBet
              ? <Pill color={T.green} glow>✓ AUTO-BET</Pill>
              : <Pill color={T.textDim}>WATCH</Pill>}
            <Pill color={betTypeColor}>{betTypeLabel}</Pill>
            {play.tier && <Pill color={accentColor}>{play.tier}</Pill>}
            {play.crossConfirmed && <Pill color={T.purple}>⚡ CONFIRMED</Pill>}
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
            <ScoreRing score={play.convictionScore} size={52} />
          </div>
        </div>

        {/* Selection */}
        <div style={{ fontSize:16, fontWeight:700, color:T.text, marginBottom:3, lineHeight:1.3,
          letterSpacing:"-0.01em" }}>
          {play.selection}
        </div>
        <div style={{ fontSize:10, color:T.textDim, marginBottom:10 }}>{play.game}</div>

        {/* Records row */}
        {(play.teamRecord || play.oppRecord) && (
          <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
            {play.teamRecord && (
              <span style={{ fontSize:10, fontWeight:700, color:T.text,
                padding:"3px 10px", background:T.bg, borderRadius:6, border:`1px solid ${T.border}` }}>
                {play.teamRecord}
              </span>
            )}
            {play.teamRecord && play.oppRecord && (
              <span style={{ fontSize:9, color:T.textDim, fontWeight:400, padding:"0 2px" }}>vs</span>
            )}
            {play.oppRecord && (
              <span style={{ fontSize:10, color:T.textMid,
                padding:"3px 10px", background:T.bg, borderRadius:6, border:`1px solid ${T.border}` }}>
                {play.oppRecord}
              </span>
            )}
          </div>
        )}

        {/* Best odds */}
        <div style={{ marginBottom:10 }}>
          {play.bestOdds != null ? (
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <span style={{ fontSize:18, fontWeight:800, color: play.bestOdds < 0 ? T.blue : T.gold,
                fontFamily:"'DM Mono',monospace" }}>
                {fmtOdds(play.bestOdds)}
              </span>
              {play.bestBook && (
                <span style={{ fontSize:10, fontWeight:600,
                  color: BOOK_META[play.bestBook]?.color || T.textMid }}>
                  {BOOK_META[play.bestBook]?.label || play.bestBook}
                </span>
              )}
              <ValueQualityTag bestOdds={play.bestOdds} getAtOrBetter={play.getAtOrBetter} />
            </div>
          ) : (
            <span style={{ fontSize:11, color:T.textDim, fontStyle:"italic" }}>
              {(!play.allLines || Object.keys(play.allLines).length === 0)
                ? "🔒 No lines available — check your sportsbook directly"
                : "Lines loading..."}
            </span>
          )}
          <BookChips allLines={play.allLines} bestBook={play.bestBook} />
        </div>

        <GetAtOrBetter value={play.getAtOrBetter} color={T.gold} />

        {/* Expanded */}
        {expanded && play.signals && (
          <div style={{ marginTop:16, paddingTop:16, borderTop:`1px solid ${T.border}` }}>
            <BookOddsTable allLines={play.allLines} bestBook={play.bestBook} />
            <div style={{ fontSize:9, color:T.textDim, letterSpacing:"0.1em", marginBottom:10, textTransform:"uppercase" }}>
              Signal Breakdown
            </div>
            {play.signals.map(sig => <SignalBar key={sig.key} label={sig.label} score={sig.score} />)}
          </div>
        )}

        {/* Expand toggle */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:12 }}>
          <div style={{ flex:1, height:1, background:T.border }}/>
          <span style={{ fontSize:8, color:T.textDim, letterSpacing:"0.1em", flexShrink:0 }}>
            {expanded ? "▲ COLLAPSE" : "▼ EXPAND"}
          </span>
          <div style={{ flex:1, height:1, background:T.border }}/>
        </div>
      </div>
    </div>
  );
}

// ── EV Bet Card ───────────────────────────────────────────────────────────────
function EVBetCard({ bet, expanded, onExpand }) {
  const typeColor = bet.type === "Moneyline" ? T.blue : bet.type === "Spread" ? T.gold : "#f472b6";
  const edgeColor = bet.edge >= 20 ? T.green : bet.edge >= 10 ? T.gold : "#fb923c";
  const edgeLabel = bet.edge >= 20 ? "STRONG" : bet.edge >= 10 ? "SOLID" : "LEAN";
  const kellyWidth = Math.min(100, (bet.kellyPct / 8) * 100);

  return (
    <div onClick={onExpand} style={{
      background:T.surface, border:`1px solid ${expanded ? T.green + "44" : T.border}`,
      borderRadius:14, cursor:"pointer", overflow:"hidden",
      transition:"border-color 0.2s, box-shadow 0.2s",
      boxShadow: expanded ? `0 0 20px ${T.green}08` : "none",
    }}>
      <div style={{ padding:"16px 18px" }}>
        {/* Tags */}
        <div style={{ display:"flex", gap:5, marginBottom:10, flexWrap:"wrap" }}>
          {badge(typeColor, bet.type || "Moneyline")}
          {badge(edgeColor, edgeLabel)}
        </div>

        {/* Selection */}
        <div style={{ fontSize:15, fontWeight:700, color:T.text, marginBottom:3 }}>{bet.selection}</div>
        <div style={{ fontSize:11, color:T.textMid, marginBottom:12 }}>{bet.game}</div>

        {/* Best odds + book */}
        <div style={{ marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <span style={{ fontSize:22, fontWeight:800, color: bet.bestOdds < 0 ? T.blue : T.gold,
              fontFamily:"'DM Mono',monospace" }}>
              {fmtOdds(bet.bestOdds)}
            </span>
            <div>
              <div style={{ fontSize:10, fontWeight:600, color: BOOK_META[bet.bestBook]?.color || T.textMid }}>
                {BOOK_META[bet.bestBook]?.label || bet.bestBook}
              </div>
              <div style={{ fontSize:9, color:T.textDim }}>Best available</div>
            </div>
            <ValueQualityTag bestOdds={bet.bestOdds} getAtOrBetter={bet.getAtOrBetter} />
          </div>
          <BookChips allLines={bet.allLines} bestBook={bet.bestBook} />
        </div>

        {/* Stats row */}
        <div style={{
          display:"grid", gridTemplateColumns:"1fr 1fr 1fr",
          gap:8, marginBottom:12,
        }}>
          {[
            { label:"Edge",  value:`+${bet.edge?.toFixed(1)}%`,       color:T.green  },
            { label:"EV",    value:`+${bet.ev?.toFixed(1)}%`,          color:T.green  },
            { label:"Kelly", value:`${bet.kellyPct?.toFixed(1)}%`,    color:T.purple },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background:T.bg, borderRadius:8, padding:"8px 10px", textAlign:"center",
              border:`1px solid ${T.border}`,
            }}>
              <div style={{ fontSize:8, color:T.textDim, marginBottom:3, letterSpacing:"0.06em" }}>{label}</div>
              <div style={{ fontSize:13, fontWeight:800, color }}>{value}</div>
            </div>
          ))}
        </div>

        <GetAtOrBetter value={bet.getAtOrBetter} color={T.green} />

        {/* Expanded */}
        {expanded && (
          <div style={{ marginTop:16, paddingTop:16, borderTop:`1px solid ${T.border}` }}>
            <BookOddsTable allLines={bet.allLines} bestBook={bet.bestBook} />

            {/* Probability analysis */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:9, color:T.textDim, letterSpacing:"0.1em", marginBottom:10, textTransform:"uppercase" }}>
                Probability Analysis
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                {[
                  { label:"True Prob",    value:`${bet.ourProbability?.toFixed(1)}%`, color:T.green },
                  { label:"Book Implied", value:`${bet.bookImplied?.toFixed(1)}%`,    color:T.red   },
                  { label:"Our Edge",     value:`+${bet.edge?.toFixed(1)}%`,           color:T.blue  },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{
                    background:T.bg, borderRadius:8, padding:"10px",
                    border:`1px solid ${T.border}`, textAlign:"center",
                  }}>
                    <div style={{ fontSize:8, color:T.textDim, marginBottom:4 }}>{label}</div>
                    <div style={{ fontSize:14, fontWeight:700, color }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Kelly bar */}
            <div style={{ marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <span style={{ fontSize:9, color:T.textDim, letterSpacing:"0.08em" }}>KELLY SIZING</span>
                <span style={{ fontSize:9, color:T.purple, fontWeight:700 }}>{bet.kellyPct?.toFixed(1)}% of bankroll</span>
              </div>
              <div style={{ height:4, background:T.border, borderRadius:2, overflow:"hidden" }}>
                <div style={{
                  height:"100%", width:`${kellyWidth}%`, borderRadius:2,
                  background:`linear-gradient(90deg, ${T.purple}, #ec4899)`,
                }}/>
              </div>
              <div style={{ fontSize:8, color:T.textDim, marginTop:4 }}>
                Capped at 8% max · This bet = {bet.kellyPct?.toFixed(1)}%
              </div>
            </div>

            {/* Rationale */}
            <div style={{
              background:T.bg, borderRadius:10, padding:"12px 14px",
              border:`1px solid ${T.border}`, fontSize:10, color:T.textMid, lineHeight:1.7,
            }}>
              <span style={{ color:T.green, fontWeight:700 }}>Why this bet? </span>
              True probability ({bet.ourProbability?.toFixed(1)}%) exceeds book implied ({bet.bookImplied?.toFixed(1)}%),
              a {bet.edge?.toFixed(1)}% edge. Kelly recommends {bet.kellyPct?.toFixed(1)}% of bankroll
              at {fmtOdds(bet.bestOdds)} on {BOOK_META[bet.bestBook]?.label || bet.bestBook}.
            </div>
          </div>
        )}

        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:12 }}>
          <div style={{ flex:1, height:1, background:T.border }}/>
          <span style={{ fontSize:8, color:T.textDim, letterSpacing:"0.1em", flexShrink:0 }}>
            {expanded ? "▲ COLLAPSE" : "▼ EXPAND"}
          </span>
          <div style={{ flex:1, height:1, background:T.border }}/>
        </div>
      </div>
    </div>
  );
}

// ── History Row ───────────────────────────────────────────────────────────────
function HistoryRow({ h }) {
  const isWon = h.status === "won";
  const isLost = h.status === "lost";
  const isPending = h.status === "pending";
  const pnl = isWon ? h.potentialPayout : isLost ? -h.wagerAmt : null;
  const accent = isWon ? T.green : isLost ? T.red : isPending ? T.gold : T.textDim;
  const btype = h.betType || h.type || "";
  const typeColor = btype === "Moneyline" ? T.blue : btype === "Spread" ? T.gold : "#f472b6";

  return (
    <div style={{
      borderBottom:`1px solid ${T.border}`,
      background: isWon ? `${T.green}04` : isLost ? `${T.red}04` : "transparent",
      transition:"background 0.15s",
    }}>
      <div className="hist-row" style={{
        display:"grid", gridTemplateColumns:"90px 1fr auto",
        gap:12, padding:"14px 20px", alignItems:"start",
      }}>
        {/* Status col */}
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:accent,
              boxShadow: isPending ? `0 0 6px ${accent}` : "none" }}/>
            <span style={{ fontSize:9, fontWeight:800, color:accent, letterSpacing:"0.08em" }}>
              {isWon ? (h.estimatedResult ? "WIN ~" : "WIN") : isLost ? (h.estimatedResult ? "LOSS ~" : "LOSS") : isPending ? "PENDING" : "VOID"}
            </span>
          </div>
          <div style={{ fontSize:10, color:T.textMid }}>
            {new Date(h.date).toLocaleDateString("en-US", { month:"short", day:"numeric" })}
          </div>
          <div style={{ fontSize:9, color:T.textDim }}>
            {new Date(h.date).toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" })}
          </div>
        </div>

        {/* Bet info col */}
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:3, lineHeight:1.3 }}>
            {h.selection?.replace(/ ML$/i,"")?.replace(/ Moneyline$/i,"")}
          </div>
          <div style={{ fontSize:10, color:T.textMid, marginBottom:6 }}>{h.game}</div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
            {h.isConviction
              ? badge(T.purple, "🎯 Conviction")
              : badge(T.green, "⚡ +EV")}
            {btype && badge(typeColor, btype === "Moneyline" ? "ML" : btype === "Spread" ? "Spread" : "Total")}
            {h.bestOdds && (
              <span style={{
                fontSize:10, fontWeight:700, padding:"1px 6px", borderRadius:4,
                color: h.bestOdds < 0 ? T.blue : T.gold,
                background: T.bg, border:`1px solid ${T.border}`,
              }}>{fmtOdds(h.bestOdds)}</span>
            )}
            {h.bestBook && (
              <span style={{ fontSize:9, color: BOOK_META[h.bestBook]?.color || T.textMid }}>
                {BOOK_META[h.bestBook]?.label || h.bestBook}
              </span>
            )}
            {h.edge > 0 && !h.isConviction && badge(T.green, `+${h.edge?.toFixed(1)}% edge`)}
          </div>
        </div>

        {/* P&L col */}
        <div style={{ textAlign:"right", minWidth:110 }}>
          {pnl !== null && (
            <div style={{ fontSize:20, fontWeight:800, color:accent, marginBottom:2,
              fontFamily:"'DM Mono',monospace" }}>
              {pnl > 0 ? "+" : ""}{fmt$(pnl)}
            </div>
          )}
          <div style={{ fontSize:9, color:T.textDim }}>
            Wagered <span style={{ color:T.text, fontWeight:600 }}>{fmt$(h.wagerAmt)}</span>
          </div>
          <div style={{ fontSize:9, color:T.textDim, marginTop:1 }}>
            Kelly <span style={{ color:T.purple, fontWeight:600 }}>
              {h.kellyPct > 0 ? h.kellyPct.toFixed(1) : h.wagerAmt && h.bankrollBefore ? (h.wagerAmt / h.bankrollBefore * 100).toFixed(1) : "2.0"}%
            </span>
          </div>
          <div style={{ fontSize:9, color:T.textDim, marginTop:1 }}>
            Balance <span style={{ color:T.text }}>{fmt$(h.bankrollAfter)}</span>
          </div>
        </div>
      </div>
      {/* P&L accent bar */}
      {!isPending && (
        <div style={{ height:1, background:`${accent}22` }}>
          <div style={{
            height:"100%",
            width:`${Math.min(100, Math.abs(pnl || 0) / (h.wagerAmt || 1) * 50 + 50)}%`,
            background: accent, opacity:0.4,
          }}/>
        </div>
      )}
    </div>
  );
}

// ── Props Table ───────────────────────────────────────────────────────────────
// Grid-based data-dense layout — Bloomberg terminal aesthetic
// UI/UX: 36px row height, semantic color per value, overflow-x-auto on mobile
function PropsTable({ props, ppMap, isMobile }) {
  if (!props.length) return null;

  const cols = isMobile
    ? "1fr 60px 90px 72px"
    : "1fr 72px 88px 88px 68px 68px 72px 80px";

  const hdr = {
    fontSize:9, color:T.textDim, fontWeight:700, letterSpacing:"0.12em",
    textTransform:"uppercase", textAlign:"center",
  };

  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, overflow:"hidden" }}>
      <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        <div style={{ minWidth: isMobile ? 340 : 680 }}>
          {/* Header row */}
          <div style={{
            display:"grid", gridTemplateColumns:cols,
            padding:"9px 18px", borderBottom:`1px solid ${T.border}`,
            background:T.bg,
          }}>
            <div style={{ ...hdr, textAlign:"left" }}>Player</div>
            <div style={hdr}>Line</div>
            {!isMobile && <div style={hdr}>Over</div>}
            {!isMobile && <div style={hdr}>Under</div>}
            {isMobile  && <div style={hdr}>Odds</div>}
            {!isMobile && <div style={hdr}>Avg</div>}
            {!isMobile && <div style={hdr}>Proj</div>}
            {!isMobile && <div style={hdr}>Hit%</div>}
            <div style={{ ...hdr, textAlign:"right" }}>Edge</div>
          </div>

          {/* Data rows */}
          {props.map((prop, i) => {
            const ppKey     = `${(prop.player||"").toLowerCase()}:${prop.market}`;
            const ppData    = ppMap?.[ppKey] || null;
            const isAutobet = prop.convictionScore >= 70;
            const edgeColor = (prop.edge*100) >= 7 ? T.green : (prop.edge*100) >= 4 ? T.gold : "#fb923c";
            const hitColor  = (prop.hitRate||0) >= 65 ? T.green : (prop.hitRate||0) >= 55 ? T.gold : T.textMid;
            const avgGood   = prop.playerSeasonAvg != null && (
              prop.side === "Over" ? prop.playerSeasonAvg > prop.line : prop.playerSeasonAvg < prop.line);
            const projGood  = prop.projectedLine != null && (
              prop.side === "Over" ? prop.projectedLine > prop.line : prop.projectedLine < prop.line);

            return (
              <div key={prop.id} style={{
                display:"grid", gridTemplateColumns:cols,
                padding:"13px 18px",
                borderBottom: i < props.length-1 ? `1px solid ${T.border}` : "none",
                alignItems:"center",
                borderLeft:`3px solid ${isAutobet ? T.purple : "transparent"}`,
                background: isAutobet ? `${T.purple}05` : "transparent",
                transition:"background 0.15s",
              }}>

                {/* Player column */}
                <div style={{ minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5, flexWrap:"wrap", marginBottom:3 }}>
                    <span style={{
                      fontSize:13, fontWeight:700, color:T.text,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                    }}>{prop.player}</span>
                    {isAutobet && (
                      <span style={{
                        fontSize:8, fontWeight:800, padding:"1px 6px", borderRadius:3, flexShrink:0,
                        background:`${T.purple}22`, color:T.purple, border:`1px solid ${T.purple}44`,
                      }}>AUTO-BET</span>
                    )}
                    {ppData && (
                      <span style={{
                        fontSize:8, fontWeight:700, padding:"1px 6px", borderRadius:3, flexShrink:0,
                        background: ppData.isGoblin ? `${T.green}18` : ppData.isDemon ? `${T.red}18` : `${T.purple}12`,
                        color: ppData.isGoblin ? T.green : ppData.isDemon ? T.red : "#a78bfa",
                        border:`1px solid ${ppData.isGoblin ? T.green : ppData.isDemon ? T.red : "#a78bfa"}33`,
                      }}>
                        PP {ppData.isGoblin ? "🟢" : ppData.isDemon ? "🔴" : ""}{ppData.recommendation}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:10, color:T.textMid }}>
                    {prop.marketLabel}
                    {prop.game && ` · ${prop.game.split("@")[1]?.trim() || prop.game}`}
                  </div>
                </div>

                {/* Line */}
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:15, fontWeight:800, color:T.text }}>{prop.line}</div>
                  {prop.projectedLine != null && (
                    <div style={{ fontSize:8, color: projGood ? T.green : T.red }}>
                      proj {prop.projectedLine}
                    </div>
                  )}
                </div>

                {/* Over odds */}
                {!isMobile && (
                  <div style={{ textAlign:"center" }}>
                    <span style={{
                      display:"inline-block", padding:"3px 10px", borderRadius:6,
                      fontSize:11, fontWeight:700,
                      background: prop.side==="Over" ? `${T.green}18` : `${T.border}55`,
                      color: prop.side==="Over" ? T.green : T.textDim,
                      border:`1px solid ${prop.side==="Over" ? T.green+"44" : T.border}`,
                    }}>
                      {prop.side==="Over" ? fmtOdds(prop.bestOdds) : "—"}
                    </span>
                  </div>
                )}

                {/* Under odds */}
                {!isMobile && (
                  <div style={{ textAlign:"center" }}>
                    <span style={{
                      display:"inline-block", padding:"3px 10px", borderRadius:6,
                      fontSize:11, fontWeight:700,
                      background: prop.side==="Under" ? "rgba(248,113,113,0.15)" : `${T.border}55`,
                      color: prop.side==="Under" ? T.red : T.textDim,
                      border:`1px solid ${prop.side==="Under" ? T.red+"44" : T.border}`,
                    }}>
                      {prop.side==="Under" ? fmtOdds(prop.bestOdds) : "—"}
                    </span>
                  </div>
                )}

                {/* Mobile: combined odds pill */}
                {isMobile && (
                  <div style={{ textAlign:"center" }}>
                    <span style={{
                      display:"inline-block", padding:"3px 10px", borderRadius:6,
                      fontSize:11, fontWeight:700,
                      background: prop.side==="Over" ? `${T.green}18` : "rgba(248,113,113,0.15)",
                      color: prop.side==="Over" ? T.green : T.red,
                      border:`1px solid ${prop.side==="Over" ? T.green+"44" : T.red+"44"}`,
                    }}>
                      {prop.side==="Over" ? "O" : "U"} {fmtOdds(prop.bestOdds)}
                    </span>
                  </div>
                )}

                {/* Season avg */}
                {!isMobile && (
                  <div style={{ textAlign:"center", fontSize:12, fontWeight:600,
                    color: prop.playerSeasonAvg != null ? (avgGood ? T.green : T.red) : T.textDim }}>
                    {prop.playerSeasonAvg?.toFixed(1) ?? "—"}
                  </div>
                )}

                {/* Projected */}
                {!isMobile && (
                  <div style={{ textAlign:"center", fontSize:12, fontWeight:700,
                    color: prop.projectedLine != null ? (projGood ? T.green : T.red) : T.textDim }}>
                    {prop.projectedLine ?? "—"}
                  </div>
                )}

                {/* Hit rate */}
                {!isMobile && (
                  <div style={{ textAlign:"center" }}>
                    <span style={{ fontSize:12, fontWeight:700, color:hitColor }}>
                      {prop.hitRate ? `${prop.hitRate}%` : "—"}
                    </span>
                  </div>
                )}

                {/* Edge */}
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:13, fontWeight:800, color:edgeColor }}>
                    +{(prop.edge*100).toFixed(1)}%
                  </div>
                  <div style={{ fontSize:8, color:T.textDim, marginTop:1 }}>
                    {BOOK_META[prop.bestBook]?.short || prop.bestBook || "—"}
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Prop Card ─────────────────────────────────────────────────────────────────
function PropCard({ prop }) {
  const [expanded, setExpanded] = useState(false);
  const edgeColor = prop.edge >= 0.08 ? T.green : prop.edge >= 0.05 ? T.gold : "#fb923c";
  const convColor = prop.convictionScore >= 75 ? T.green : prop.convictionScore >= 70 ? T.gold : "#fb923c";
  const autoBet = prop.convictionScore >= 70;
  const sideColor = prop.side === "Over" ? T.green : T.red;

  const MARKET_LABEL = {
    player_points:"PTS", player_rebounds:"REB", player_assists:"AST",
    player_threes:"3PM", player_points_rebounds_assists:"PRA",
    player_points_rebounds:"PR", player_points_assists:"PA",
  };

  return (
    <div style={{
      background:T.surface, border:`1px solid ${autoBet ? T.purple + "55" : T.border}`,
      borderRadius:14, overflow:"hidden",
      boxShadow: autoBet ? `0 0 16px ${T.purple}10` : "none",
    }}>
      {autoBet && (
        <div style={{ height:2, background:`linear-gradient(90deg, ${T.purple}, ${T.blue})` }}/>
      )}
      <div style={{ padding:"16px 18px" }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div style={{ flex:1, marginRight:10 }}>
            <div style={{ fontSize:15, fontWeight:700, color:T.text, marginBottom:2 }}>{prop.player}</div>
            <div style={{ fontSize:10, color:T.textMid }}>{prop.game}</div>
            {prop.opponentTeam && <div style={{ fontSize:9, color:T.textDim }}>vs {prop.opponentTeam}</div>}
          </div>
          <div style={{ textAlign:"right" }}>
            <ScoreRing score={prop.convictionScore} size={48} />
            {autoBet && <div style={{ fontSize:8, color:T.purple, fontWeight:700, marginTop:3 }}>AUTO-BET</div>}
          </div>
        </div>

        {/* Bet line hero */}
        <div style={{
          background:T.bg, borderRadius:10, padding:"12px 14px", marginBottom:10,
          border:`1px solid ${T.border}`,
        }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
              <span style={{ fontSize:20, fontWeight:800, color:sideColor }}>{prop.side}</span>
              <span style={{ fontSize:22, fontWeight:800, color:T.text }}>{prop.line}</span>
              <span style={{ fontSize:11, color:T.textMid }}>
                {MARKET_LABEL[prop.market] || prop.marketLabel}
              </span>
            </div>
            <span style={{ fontSize:12, fontWeight:700, color:edgeColor }}>
              +{(prop.edge * 100).toFixed(1)}% edge
            </span>
          </div>

          {/* Season / L5 */}
          {(prop.playerSeasonAvg != null || prop.playerL5Avg != null) && (
            <div style={{ display:"flex", gap:16, marginBottom:8 }}>
              {prop.playerSeasonAvg != null && (
                <div style={{ fontSize:9, color:T.textDim }}>
                  Season <span style={{ color:T.text, fontWeight:600 }}>{prop.playerSeasonAvg.toFixed(1)}</span>
                </div>
              )}
              {prop.playerL5Avg != null && (
                <div style={{ fontSize:9, color:T.textDim }}>
                  L5 avg <span style={{
                    fontWeight:700,
                    color: prop.side === "Over"
                      ? (prop.playerL5Avg > prop.line ? T.green : T.red)
                      : (prop.playerL5Avg < prop.line ? T.green : T.red),
                  }}>{prop.playerL5Avg.toFixed(1)}</span>
                </div>
              )}
            </div>
          )}

          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:15, fontWeight:800, color: prop.bestOdds > 0 ? T.gold : T.blue }}>
              {fmtOdds(prop.bestOdds)}
            </span>
            <span style={{
              fontSize:9, fontWeight:600, padding:"2px 8px", borderRadius:5,
              color: BOOK_META[prop.bestBook]?.color || T.textMid,
              background:T.surface, border:`1px solid ${T.border}`,
            }}>
              {BOOK_META[prop.bestBook]?.label || prop.bestBook}
            </span>
          </div>
        </div>

        <GetAtOrBetter value={prop.getAtOrBetter} color={T.purple} />

        {/* Signals */}
        {prop.signals?.length > 0 && (
          <div style={{ marginTop:12 }}>
            <div style={{ fontSize:9, color:T.textDim, letterSpacing:"0.1em", marginBottom:8, textTransform:"uppercase" }}>
              Signal Breakdown
            </div>
            {prop.signals.map(sig => <SignalBar key={sig.key} label={sig.label} score={sig.score} />)}
          </div>
        )}

        {/* All lines toggle */}
        {prop.allLines && Object.keys(prop.allLines).length > 1 && (
          <div style={{ marginTop:10 }}>
            <button onClick={() => setExpanded(e => !e)} style={{
              background:"transparent", border:"none", color:T.textDim, cursor:"pointer",
              fontSize:9, padding:0, letterSpacing:"0.04em", fontFamily:"inherit",
            }}>
              {expanded ? "▲ Hide lines" : `▼ All lines (${Object.keys(prop.allLines).length} books)`}
            </button>
            {expanded && (
              <div style={{ marginTop:8 }}>
                {Object.entries(prop.allLines).map(([bk, val]) => (
                  <BookLine key={bk} bk={bk} val={val} isBest={bk === prop.bestBook} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer stats */}
        <div style={{
          display:"flex", justifyContent:"space-between",
          fontSize:9, color:T.textDim, borderTop:`1px solid ${T.border}`,
          paddingTop:10, marginTop:10,
        }}>
          <span>True prob <span style={{ color:T.textMid }}>{prop.trueProb?.toFixed(1)}%</span></span>
          <span>Kelly <span style={{ color:T.purple }}>{prop.kellyPct?.toFixed(1)}%</span></span>
          <span>EV <span style={{ color:T.green }}>+{prop.ev?.toFixed(1)}%</span></span>
        </div>
      </div>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = T.green, icon }) {
  return (
    <div style={{
      background:T.surface,
      border:`1px solid ${T.border}`,
      borderLeft:`2px solid ${color}`,
      borderRadius:14, padding:"20px 22px", position:"relative", overflow:"hidden",
      boxShadow:`inset 0 0 24px ${color}06`,
    }}>
      <div style={{ fontSize:9, color:T.textDim, letterSpacing:"0.08em", marginBottom:8, textTransform:"uppercase" }}>
        {label}
      </div>
      <div style={{ height:1, background:`${color}20`, marginBottom:10 }}/>
      <div style={{ fontSize:26, fontWeight:800, color, marginBottom:4, lineHeight:1,
        fontFamily:"'DM Mono',monospace" }}>{value}</div>
      {sub && <div style={{ fontSize:10, color:T.textMid, marginTop:4 }}>{sub}</div>}
    </div>
  );
}

// ── Info components ───────────────────────────────────────────────────────────
function InfoSection({ title, children }) {
  return (
    <div style={{
      background:T.surface, border:`1px solid ${T.border}`,
      borderRadius:14, padding:"24px 28px", marginBottom:16,
    }}>
      <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:16 }}>{title}</div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{
      display:"flex", justifyContent:"space-between", alignItems:"flex-start",
      padding:"10px 0", borderBottom:`1px solid ${T.border}`,
    }}>
      <span style={{ fontSize:11, color:T.textMid, flexShrink:0, width:170 }}>{label}</span>
      <span style={{ fontSize:11, color:T.text, textAlign:"right", lineHeight:1.5 }}>{value}</span>
    </div>
  );
}

function Step({ n, title, desc }) {
  return (
    <div style={{ display:"flex", gap:16, padding:"14px 0", borderBottom:`1px solid ${T.border}` }}>
      <div style={{
        width:30, height:30, borderRadius:"50%",
        background:`${T.green}12`, border:`1px solid ${T.green}33`,
        display:"flex", alignItems:"center", justifyContent:"center",
        flexShrink:0, fontSize:12, fontWeight:800, color:T.green,
      }}>{n}</div>
      <div>
        <div style={{ fontSize:12, fontWeight:700, color:T.text, marginBottom:4 }}>{title}</div>
        <div style={{ fontSize:11, color:T.textMid, lineHeight:1.7 }}>{desc}</div>
      </div>
    </div>
  );
}

// ── Info Tab ──────────────────────────────────────────────────────────────────
function InfoTab() {
  return (
    <div style={{ padding:"0 20px" }}>
      {/* Discord card */}
      <div style={{
        background:`${T.discord}0c`, border:`1px solid ${T.discord}33`,
        borderRadius:14, padding:"20px 24px", marginBottom:16,
        display:"flex", alignItems:"center", justifyContent:"space-between",
        flexWrap:"wrap", gap:12,
      }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill={T.discord}>
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
            </svg>
            <span style={{ fontSize:15, fontWeight:700, color:T.text }}>Get Bet Alerts on Discord</span>
          </div>
          <div style={{ fontSize:11, color:T.textMid, lineHeight:1.7, maxWidth:500 }}>
            Every time the algorithm places a bet, you'll receive an instant notification
            with the pick, odds, book, and Kelly sizing — follow along in real time.
          </div>
        </div>
        <a href="https://discord.gg/TRZQRu58au" target="_blank" rel="noopener noreferrer"
          style={{
            display:"inline-flex", alignItems:"center", gap:8,
            padding:"10px 22px", borderRadius:10,
            background:T.discord, color:"#fff", fontWeight:700,
            fontSize:12, textDecoration:"none", fontFamily:"inherit",
            letterSpacing:"0.05em", whiteSpace:"nowrap",
            boxShadow:`0 0 20px ${T.discord}44`,
          }}>
          Join Discord
        </a>
      </div>

      <InfoSection title="🏀 What is NBA Edge?">
        <p style={{ fontSize:12, color:T.textMid, lineHeight:1.8, marginBottom:0 }}>
          NBA Edge is a fully automated betting analysis tool. Four times daily, it scans odds
          from 10+ sportsbooks, runs mathematics to find bets where the true probability of
          winning exceeds the bookmaker's implied probability. These are called +EV (positive
          expected value) bets — they're profitable long-term even if individual bets lose.
        </p>
      </InfoSection>

      <InfoSection title="📊 How to Read EV Bets">
        <InfoRow label="Edge %" value="How much better our probability estimate is vs the book's. +5% means we think the bet wins 5% more often than the book implies." />
        <InfoRow label="EV %" value="Expected profit per dollar wagered, long-term. +5% EV = profit $5 for every $100 bet." />
        <InfoRow label="Kelly %" value="Optimal bankroll percentage to wager. Based on edge size and odds." />
        <InfoRow label="True Probability" value="Our devigged estimate of the actual win probability." />
        <InfoRow label="Book Implied" value="What the sportsbook's odds imply the win probability is (after removing vig)." />
      </InfoSection>

      <InfoSection title="🎯 How to Read Conviction Plays">
        <InfoRow label="Conviction Score" value="0–100 composite score from 7 signals: win rate, record, recent form, ATS tendency, home/away, opponent form, market probability." />
        <InfoRow label="AUTO-BET" value="Score ≥70. The algorithm places this bet automatically using Kelly Criterion sizing." />
        <InfoRow label="WATCH ONLY" value="Score below 70. Worth monitoring but not auto-bet." />
        <InfoRow label="Signal Breakdown" value="Expand the card to see how each of the 7 signals contributed to the score." />
      </InfoSection>

      <InfoSection title="📋 How to Place a Bet">
        <Step n="1" title="Find a bet on the All or +EV tab"
          desc="Look for STRONG or SOLID edge bets. Click to expand and see all sportsbook lines." />
        <Step n="2" title="Check the best sportsbook (★ BEST)"
          desc="The card shows which book has the best odds. Open that app — DraftKings, FanDuel, etc." />
        <Step n="3" title="Use the Get At Or Better line"
          desc="If the line has moved, only take the bet if it's at this price or better. Otherwise skip." />
        <Step n="4" title="Size using the Kelly %"
          desc="Kelly % tells you what fraction of your bankroll to bet. Start conservative — use half Kelly until comfortable." />
        <Step n="5" title="Track automatically"
          desc="NBA Edge tracks results. Over time, +EV bets produce profit even when individual bets lose." />
      </InfoSection>

      <InfoSection title="📖 Glossary">
        <InfoRow label="Moneyline (ML)" value="Bet on which team wins outright. -150 = bet $150 to win $100. +130 = bet $100 to win $130." />
        <InfoRow label="Spread" value="Betting the margin of victory. -5.5 means win by 6+. +5.5 means lose by ≤5 and still cover." />
        <InfoRow label="Game Total (O/U)" value="Combined score of both teams. Over 220.5 = both teams score 221+ combined." />
        <InfoRow label="Devigging" value="Removing the sportsbook's built-in profit margin to find true probabilities." />
        <InfoRow label="Pinnacle" value="Sharp, low-vig book used as market reference for true probabilities. Most accurate lines in the world." />
        <InfoRow label="Kelly Criterion" value="Formula for mathematically optimal bet sizing based on edge. Avoids over-betting (ruin) and under-betting." />
        <InfoRow label="EV (Expected Value)" value="Average outcome of a bet over infinite trials. +EV = profitable long-term." />
        <InfoRow label="Paper Bankroll" value="Simulated $100 bankroll tracking performance without real money." />
        <InfoRow label="ROI" value="Return on Investment. +8% ROI = $8 profit per $100 wagered." />
      </InfoSection>

      <div style={{ padding:"8px 4px 16px", fontSize:10, color:T.textDim, lineHeight:1.8, textAlign:"center" }}>
        NBA Edge is a research and analytics tool. Past performance does not guarantee future results. Bet responsibly.
      </div>
    </div>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ icon, title, badge: badgeEl, count }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:10, marginBottom:16,
      paddingBottom:12,
      background:`linear-gradient(90deg, ${T.border} 0%, transparent 80%) bottom / 100% 1px no-repeat`,
    }}>
      <span style={{ fontSize:16 }}>{icon}</span>
      <span style={{ fontSize:15, fontWeight:700, color:T.text, letterSpacing:"-0.01em" }}>{title}</span>
      {count != null && (
        <span style={{
          fontSize:9, fontWeight:700, padding:"2px 8px", borderRadius:10,
          background:T.bg, border:`1px solid ${T.border}`, color:T.textMid,
          fontFamily:"'DM Mono',monospace",
        }}>{count}</span>
      )}
      {badgeEl && <div style={{ marginLeft:"auto" }}>{badgeEl}</div>}
    </div>
  );
}

// ── PrizePicks Card ───────────────────────────────────────────────────────────
function PrizePicksCard({ pick }) {
  const recColor = pick.recommendation === "OVER" ? T.green : T.red;
  const oddsTypeBadge = pick.isDemon
    ? { label:"🔴 DEMON",    color:"#f87171", sub:"Harder line" }
    : pick.isGoblin
    ? { label:"🟢 GOBLIN",   color:"#00e87a", sub:"Easier line" }
    : { label:"STANDARD",    color:T.textMid,  sub:"Normal line" };
  const edgeColor = pick.ppEdgePct >= 7 ? T.green : pick.ppEdgePct >= 4 ? T.gold : "#fb923c";

  return (
    <div style={{
      background:T.surface, borderRadius:14, overflow:"hidden",
      border:`1px solid ${pick.isValueBet ? T.purple + "55" : T.border}`,
      boxShadow: pick.isValueBet ? `0 0 20px ${T.purple}10` : "none",
    }}>
      {pick.isValueBet && (
        <div style={{ height:2, background:`linear-gradient(90deg, ${T.purple}, ${T.blue})` }}/>
      )}
      <div style={{ padding:"16px 18px" }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div style={{ flex:1, marginRight:10 }}>
            <div style={{ fontSize:15, fontWeight:700, color:T.text, marginBottom:2 }}>{pick.player}</div>
            <div style={{ fontSize:10, color:T.textMid }}>{pick.team} · {pick.marketLabel}</div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
            {pick.isValueBet && (
              <span style={{ fontSize:8, fontWeight:800, padding:"2px 8px", borderRadius:4,
                background:`${T.purple}18`, border:`1px solid ${T.purple}44`, color:T.purple }}>
                ⚡ VALUE
              </span>
            )}
            <span style={{ fontSize:8, fontWeight:700, padding:"2px 8px", borderRadius:4,
              background:`${oddsTypeBadge.color}15`, border:`1px solid ${oddsTypeBadge.color}44`,
              color:oddsTypeBadge.color }}>
              {oddsTypeBadge.label}
            </span>
          </div>
        </div>

        {/* Main line */}
        <div style={{ background:T.bg, borderRadius:10, padding:"12px 14px", marginBottom:10,
          border:`1px solid ${T.border}` }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:6 }}>
            <span style={{ fontSize:22, fontWeight:800, color:recColor }}>{pick.recommendation}</span>
            <span style={{ fontSize:26, fontWeight:800, color:T.text }}>{pick.line}</span>
            <span style={{ fontSize:11, color:T.textMid }}>{pick.marketLabel}</span>
          </div>
          <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, color:T.textDim }}>
              PP Line: <span style={{ color:T.text, fontWeight:600 }}>{pick.line}</span>
            </span>
            {pick.ourLine != null && pick.lineDiff !== 0 && (
              <span style={{ fontSize:10, color:T.textDim }}>
                Books: <span style={{ color: pick.lineDiff > 0 ? T.green : T.red, fontWeight:600 }}>
                  {pick.ourLine} ({pick.lineDiff > 0 ? "+" : ""}{pick.lineDiff} vs PP)
                </span>
              </span>
            )}
            {pick.playerSeasonAvg != null && (
              <span style={{ fontSize:10, color:T.textDim }}>
                Season avg: <span style={{ color:T.textMid, fontWeight:600 }}>{pick.playerSeasonAvg.toFixed(1)}</span>
              </span>
            )}
            {pick.playerL5Avg != null && (
              <span style={{ fontSize:10, color:T.textDim }}>
                L5 avg: <span style={{
                  fontWeight:700,
                  color: pick.recommendation === "OVER"
                    ? (pick.playerL5Avg > pick.line ? T.green : T.red)
                    : (pick.playerL5Avg < pick.line ? T.green : T.red)
                }}>{pick.playerL5Avg.toFixed(1)}</span>
              </span>
            )}
          </div>
        </div>

        {/* Edge stats grid */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:10 }}>
          {[
            { label:"PP Edge",    value:`+${pick.ppEdgePct.toFixed(1)}%`,  color:edgeColor },
            { label:"True Prob",  value:`${pick.trueProb}%`,               color:T.blue    },
            { label:"PP Implied", value:`${pick.ppImplied}%`,              color:T.textMid },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background:T.bg, borderRadius:8, padding:"8px 10px",
              border:`1px solid ${T.border}`, textAlign:"center" }}>
              <div style={{ fontSize:8, color:T.textDim, marginBottom:3 }}>{label}</div>
              <div style={{ fontSize:13, fontWeight:800, color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Odds type context */}
        <div style={{ fontSize:9, color:T.textDim, marginBottom:10 }}>
          {oddsTypeBadge.sub} · {pick.oddsType === "goblin"
            ? "PrizePicks boosted this line — easier for bettors"
            : pick.oddsType === "demon"
            ? "PrizePicks reduced this line — harder for bettors"
            : "Standard PrizePicks line"}
        </div>

        {/* Why box */}
        <div style={{ background:T.bg, borderRadius:10, padding:"10px 14px",
          border:`1px solid ${T.border}`, fontSize:10, color:T.textMid, lineHeight:1.7 }}>
          <span style={{ color:T.purple, fontWeight:700 }}>Why this pick? </span>
          Our model gives {pick.player} a {pick.trueProb}% chance of going {pick.recommendation} {pick.line} {pick.marketLabel}.
          PrizePicks implies {pick.ppImplied}%, giving us a +{pick.ppEdgePct.toFixed(1)}% edge.
          {pick.isDemon && " This is a demon line — PrizePicks has moved it against bettors, making our edge even more meaningful."}
          {pick.isGoblin && " This is a goblin line — PrizePicks has made it easier, confirming direction."}
        </div>
      </div>
    </div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
function EmptyState({ icon, message, sub }) {
  return (
    <div style={{
      textAlign:"center", padding:"48px 20px",
      background:T.surface, borderRadius:14, border:`1px solid ${T.border}`,
    }}>
      <div style={{ fontSize:28, marginBottom:10 }}>{icon}</div>
      <div style={{ fontSize:13, fontWeight:600, color:T.textMid, marginBottom:6 }}>{message}</div>
      {sub && <div style={{ fontSize:11, color:T.textDim }}>{sub}</div>}
    </div>
  );
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const color = d.status === "won" ? T.green : d.status === "lost" ? T.red : T.textMid;
  return (
    <div style={{
      background:T.surface, border:`1px solid ${T.border}`,
      borderRadius:9, padding:"10px 14px", fontSize:11,
    }}>
      <div style={{ color:T.textDim, marginBottom:4, fontSize:9 }}>
        {d.date !== "Start" ? new Date(d.date).toLocaleDateString("en-US", { month:"short", day:"numeric" }) : "Start"}
      </div>
      <div style={{ fontWeight:800, color: d.bankroll >= 100 ? T.green : T.red, fontSize:15 }}>
        ${d.bankroll?.toFixed(2)}
      </div>
      {d.status && d.status !== "start" && (
        <div style={{ color, fontSize:9, marginTop:3, fontWeight:700 }}>
          {d.status.toUpperCase()}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── Main App ──────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const isMobile = useIsMobile();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("All");
  const [expandedConvRows, setExpandedConvRows] = useState({});
  const [expandedEvRows, setExpandedEvRows]   = useState({});
  const [convSort, setConvSort]   = useState("score");
  const [evSort,   setEvSort]     = useState("edge");
  const [propCat,  setPropCat]    = useState("All");
  const [propMarketFilter, setPropMarketFilter] = useState("all");
  const [propSort, setPropSort] = useState("conviction");
  const [scoresData, setScoresData] = useState([]);

  // Sportsbook filter
  const [selectedBooks, setSelectedBooks] = useState(() => {
    if (typeof window === "undefined") return new Set(["all"]);
    try {
      const saved = localStorage.getItem("nba_edge_books");
      return saved ? new Set(JSON.parse(saved)) : new Set(["all"]);
    } catch { return new Set(["all"]); }
  });

  function toggleBook(id) {
    setSelectedBooks(prev => {
      let next;
      if (id === "all") {
        next = new Set(["all"]);
      } else {
        const without = new Set([...prev].filter(b => b !== "all"));
        if (without.has(id)) {
          without.delete(id);
          next = without.size === 0 ? new Set(["all"]) : without;
        } else {
          without.add(id);
          next = without.size === ALL_BOOKS.length ? new Set(["all"]) : without;
        }
      }
      try { localStorage.setItem("nba_edge_books", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  function bookVisible(item) {
    if (selectedBooks.has("all")) return true;
    const book = item?.bestBook;
    if (!book) return true;
    return selectedBooks.has(book);
  }

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch(e) {
      console.error("Portfolio fetch failed:", e);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchPortfolio();
    const id = setInterval(fetchPortfolio, 60000);
    return () => clearInterval(id);
  }, [fetchPortfolio]);

  useEffect(() => {
    const parseScores = (d) => (d.events || []).map(ev => {
      const comp = ev.competitions?.[0];
      const st = comp?.status?.type;
      const home = comp?.competitors?.find(c => c.homeAway === "home");
      const away = comp?.competitors?.find(c => c.homeAway === "away");
      const live = st?.state === "in";
      const final = st?.completed;
      const period = comp?.status?.period;
      const clock = comp?.status?.displayClock;
      const statusStr = live
        ? (clock ? `LIVE · Q${period} ${clock}` : "LIVE")
        : final
          ? "FINAL"
          : ev.date
            ? new Date(ev.date).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZoneName:"short"})
            : "";
      return {
        away: away?.team?.abbreviation || "",
        home: home?.team?.abbreviation || "",
        awayScore: away?.score ?? "",
        homeScore: home?.score ?? "",
        tipTime: ev.date ? new Date(ev.date).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}) : "",
        live, final, status: statusStr,
      };
    });
    const fetchScores = () =>
      fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard")
        .then(r => r.json()).then(d => setScoresData(parseScores(d))).catch(() => {});
    fetchScores();
    const sid = setInterval(fetchScores, 60000);
    return () => clearInterval(sid);
  }, []);

  const tabs = ["All","Moneyline","Spread","Game Total","Props","History","Info"];

  // ── Chart data ───────────────────────────────────────────────────────────────
  const chartData = (() => {
    if (!data?.history?.length) return [];
    const allResolved = [...data.history]
      .sort((a,b) => new Date(a.date) - new Date(b.date))
      .filter(h => h.status === "won" || h.status === "lost");
    if (!allResolved.length) return [{ bankroll:100, date:"Start" }];

    const isFiltered = !selectedBooks.has("all");
    if (!isFiltered) {
      return [{ bankroll:100, date:"Start", status:"start" },
        ...allResolved.map(h => ({ bankroll:h.bankrollAfter, date:h.date, status:h.status }))];
    }
    const filtered = allResolved.filter(bookVisible);
    if (!filtered.length) return [{ bankroll:100, date:"Start" }];
    let runningBankroll = 100;
    return [{ bankroll:100, date:"Start", status:"start" },
      ...filtered.map(h => {
        if (h.status === "won") runningBankroll += (h.potentialPayout || 0);
        else runningBankroll -= (h.wagerAmt || 0);
        runningBankroll = Math.max(0, +runningBankroll.toFixed(2));
        return { bankroll:runningBankroll, date:h.date, status:h.status };
      })];
  })();

  // ── Filtered data ────────────────────────────────────────────────────────────
  const conviction   = data?.convictionPlays || [];
  const history      = data?.history || [];
  const currentBets  = data?.currentBets || [];
  const propBets       = (data?.propBets || []).filter(bookVisible);
  const prizePicksBets = data?.prizePicksBets || [];
  const prizePicksMap  = data?.prizePicksMap  || {};

  const matchType = (t, tab) => {
    if (tab === "All") return true;
    if (tab === "Spread")     return t === "Spread"     || t === "spreads" || t === "ATS";
    if (tab === "Game Total") return t === "Game Total" || t === "totals"  || t === "Total";
    return t === tab;
  };

  const filteredConviction = conviction
    .filter(p => matchType(p.betType || "Moneyline", tab === "Props" || tab === "History" || tab === "Info" ? "skip" : tab))
    .filter(bookVisible)
    .slice().sort((a, b) => {
      if (convSort === "score") return (b.convictionScore || 0) - (a.convictionScore || 0);
      if (convSort === "edge")  return (b.edge || 0) - (a.edge || 0);
      if (convSort === "odds")  return (a.bestOdds || 0) - (b.bestOdds || 0);
      return 0;
    });

  const filteredBets = ((tab === "All" || tab === "Moneyline" || tab === "Spread" || tab === "Game Total")
    ? currentBets.filter(b => matchType(b.type || b.betType || "Moneyline", tab)).filter(bookVisible)
    : []).slice().sort((a, b) => {
      if (evSort === "edge")   return (b.edge || 0) - (a.edge || 0);
      if (evSort === "ev")     return (b.ev || 0) - (a.ev || 0);
      if (evSort === "kelly")  return (b.kellyPct || 0) - (a.kellyPct || 0);
      return 0;
    });

  const filteredHistory = tab === "History" ? history.filter(bookVisible) : [];

  const PROP_CAT_MAP = {
    "Points":    "player_points",
    "Rebounds":  "player_rebounds",
    "Assists":   "player_assists",
    "3PM":       "player_threes",
    "PRA":       "player_points_rebounds_assists",
  };
  const filterPropCat = arr => propCat === "All" ? arr : arr.filter(p => p.market === PROP_CAT_MAP[propCat]);

  const convictionProps = filterPropCat(propBets.filter(p => p.convictionScore >= 70));
  const evProps         = filterPropCat(propBets.filter(p => p.convictionScore < 70));

  const filteredPnl = (() => {
    const resolved = (tab === "History" ? filteredHistory : history.filter(bookVisible))
      .filter(h => h.status === "won" || h.status === "lost");
    return resolved.reduce((sum, h) =>
      sum + (h.status === "won" ? (h.potentialPayout || 0) : -(h.wagerAmt || 0)), 0);
  })();

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{
      minHeight:"100vh", background:T.bg, display:"flex",
      alignItems:"center", justifyContent:"center",
      fontFamily:"'DM Sans','IBM Plex Sans',system-ui,sans-serif",
    }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:36, marginBottom:16 }}>🏀</div>
        <div style={{ fontSize:12, color:T.textDim, letterSpacing:"0.2em" }}>LOADING NBA EDGE</div>
      </div>
    </div>
  );

  const isBookFiltered = !selectedBooks.has("all");
  const activeBookLabels = isBookFiltered
    ? [...selectedBooks].map(id => ALL_BOOKS.find(b => b.id === id)?.label || id)
    : [];

  return (
    <div style={{
      minHeight:"100vh",
      background:`linear-gradient(160deg, ${T.bg} 0%, #030810 60%, #060c14 100%)`,
      color:T.text,
      fontFamily:"'DM Sans','IBM Plex Sans',system-ui,sans-serif",
      padding:"0 0 80px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
          70%  { box-shadow: 0 0 0 5px transparent; opacity: 0.7; }
          100% { box-shadow: 0 0 0 0 transparent; opacity: 1; }
        }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        .card-enter { animation: fadeIn 0.2s ease; }
        body::before {
          content:""; position:fixed; inset:0; pointer-events:none; z-index:0;
          opacity:0.025;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 200px 200px;
        }
        @media (max-width:900px) {
          .stat-grid  { grid-template-columns: repeat(2,1fr) !important; padding: 14px !important; gap:10px !important; }
          .conv-grid  { grid-template-columns: repeat(auto-fill,minmax(280px,1fr)) !important; }
        }
        @media (max-width:600px) {
          .conv-grid  { grid-template-columns: 1fr !important; }
          .stat-grid  { grid-template-columns: repeat(2,1fr) !important; padding:10px !important; gap:8px !important; }
          .hist-row   { grid-template-columns: 1fr !important; }
        }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:${T.border}; border-radius:2px; }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{
        borderBottom:`1px solid ${T.border}`,
        padding: isMobile ? "12px 16px" : "14px 28px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        position:"sticky", top:0, background:`${T.bg}e8`,
        backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
        zIndex:20, flexWrap:"wrap", gap:8,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:22 }}>🏀</span>
          <div>
            <div style={{ fontSize: isMobile ? 15 : 18, fontWeight:800, color:"#fff", letterSpacing:"0.1em",
              textShadow:`0 0 20px ${T.green}44` }}>
              NBA EDGE
            </div>
            {!isMobile && (
              <div style={{ fontSize:8, color:T.textDim, letterSpacing:"0.15em" }}>
                EV BETTING ENGINE · ML LEARNING · FULLY AUTOMATED
              </div>
            )}
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:6, height:6, borderRadius:"50%",
              background: getStatusDotColor(data?.lastRun),
              animation:"pulse 2s infinite",
              boxShadow:`0 0 6px ${getStatusDotColor(data?.lastRun)}` }}/>
            <span style={{ fontSize:10, color:T.textMid }}>
              Updated {timeAgo(data?.lastRun)} · Next: {getNextRunTime()}
            </span>
          </div>
          <Pill color={T.green} glow>Live Track Record</Pill>
          <a href="https://discord.gg/TRZQRu58au" target="_blank" rel="noopener noreferrer"
            style={{
              display:"flex", alignItems:"center", gap:5,
              fontSize:9, padding:"3px 10px", borderRadius:20,
              border:`1px solid ${T.discord}44`, color:T.discord,
              background:`${T.discord}10`, textDecoration:"none", fontWeight:600,
            }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill={T.discord}>
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
            </svg>
            DISCORD
          </a>
        </div>
      </header>

      <ScoresBar games={scoresData} />

      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      <div className="stat-grid" style={{
        display:"grid", gridTemplateColumns:"repeat(5,1fr)",
        gap:14, padding:"20px 28px",
      }}>
        <StatCard label="Paper Bankroll"
          value={`$${(data?.bankroll||100).toFixed(2)}`}
          sub={`${(data?.totalPnl||0) >= 0 ? "+" : ""}$${(data?.totalPnl||0).toFixed(2)} P&L`}
          color={T.green}/>
        <StatCard label="Win Rate"
          value={`${data?.winRate||0}%`}
          sub={`${data?.record?.wins||0}W / ${data?.record?.losses||0}L`}
          color={T.blue}/>
        <StatCard label="ROI"
          value={`${(data?.roi||0) >= 0 ? "+" : ""}${data?.roi||0}%`}
          sub="on resolved bets"
          color={(data?.roi||0) >= 0 ? T.green : T.red}/>
        <StatCard label="Bets Today"
          value={(() => {
            const today = new Date().toDateString();
            return (data?.history||[]).filter(h => new Date(h.date).toDateString()===today).length;
          })()}
          sub={`${conviction.filter(p=>p.convictionScore>=70).length} auto-bet conviction`}
          color={T.gold}/>
        <StatCard label="ML Engine"
          value={data?.mlStatus||"Learning"}
          sub={`${data?.mlBets||0} bets analyzed`}
          color={T.purple}/>
      </div>

      {/* ── Book Filter Toolbar ───────────────────────────────────────────────── */}
      <div style={{ margin:"0 28px 14px", background:T.surface, borderRadius:14, padding:"10px 16px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:8, fontWeight:700, color:T.textDim, letterSpacing:"0.12em" }}>BOOKS</span>
          </div>
          {isBookFiltered && (
            <button onClick={() => toggleBook("all")} style={{
              fontSize:9, color:T.textDim, background:"transparent",
              border:"none", cursor:"pointer", padding:0, fontFamily:"inherit",
              textDecoration:"underline",
            }}>Reset</button>
          )}
        </div>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
          <button onClick={() => toggleBook("all")} style={{
            padding:"4px 12px", borderRadius:0, fontSize:9, cursor:"pointer",
            fontFamily:"inherit", fontWeight:700,
            background:"transparent", border:"none",
            borderBottom: selectedBooks.has("all") ? `2px solid #fff` : "2px solid transparent",
            color: selectedBooks.has("all") ? "#fff" : T.textDim,
            transition:"all 0.15s",
          }}>ALL</button>
          {ALL_BOOKS.map(bk => {
            const active = !selectedBooks.has("all") && selectedBooks.has(bk.id);
            return (
              <button key={bk.id} onClick={() => toggleBook(bk.id)} style={{
                padding:"4px 12px", borderRadius:0, fontSize:9, cursor:"pointer",
                fontFamily:"inherit",
                background:"transparent", border:"none",
                borderBottom: active ? `2px solid ${bk.color}` : "2px solid transparent",
                color: active ? bk.color : T.textDim,
                transition:"all 0.15s",
              }}>
                {bk.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div style={{ padding: isMobile ? "0 12px" : "0 28px", marginBottom:20 }}>
        <div style={{
          display:"flex", gap:4,
          overflowX:"auto", WebkitOverflowScrolling:"touch",
          scrollbarWidth:"none", msOverflowStyle:"none",
          borderBottom:`1px solid ${T.border}`, paddingBottom:0,
        }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding:"8px 16px", fontSize:11, cursor:"pointer",
              whiteSpace:"nowrap", flexShrink:0, fontFamily:"inherit",
              background:"transparent", border:"none",
              borderBottom:`3px solid ${tab === t ? T.green : "transparent"}`,
              color: tab === t ? T.text : T.textDim,
              fontWeight: tab === t ? 700 : 400,
              filter: tab === t ? `drop-shadow(0 1px 4px ${T.green}88)` : "none",
              transition:"color 0.15s, border-color 0.15s, filter 0.15s",
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: isMobile ? "0 12px" : "0 28px" }}>

        {/* Conviction Plays */}
        {(tab==="All"||tab==="Moneyline"||tab==="Spread"||tab==="Game Total") && (
          <div style={{ marginBottom:28 }}>
            <SectionHeader
              icon="🎯"
              title={tab === "All" ? "Conviction Plays" : `${tab} Conviction Plays`}
              count={filteredConviction.length}
              badge={<Pill color={T.gold} glow>Stat-driven · Auto-bet ≥70</Pill>}
            />
            <div style={{ display:"inline-flex", gap:2, marginBottom:12, marginTop:-4, background:T.bg, border:`1px solid ${T.border}`, borderRadius:8, padding:3 }}>
              {[["score","Score ↓"],["edge","Edge %"],["odds","Odds"]].map(([key,label]) => (
                <button key={key} onClick={() => setConvSort(key)} style={{
                  background: convSort === key ? T.surface : "transparent",
                  border:"none", cursor:"pointer",
                  fontSize:10, fontWeight:convSort === key ? 700 : 400, fontFamily:"inherit",
                  color: convSort === key ? T.text : T.textDim,
                  padding:"4px 12px", borderRadius:6,
                  transition:"all 0.15s",
                }}>{label}{convSort === key ? " ↓" : ""}</button>
              ))}
            </div>
            {filteredConviction.length === 0 ? (
              <EmptyState icon="📊" message="No conviction plays yet"
                sub={`Engine next runs at ${getNextRunTime()}. No qualifying plays for today's games yet.`} />
            ) : (
              <div className="conv-grid" style={{
                display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:12, alignItems:"start",
              }}>
                {filteredConviction.slice(0,9).map((p) => (
                  <ConvictionCard key={p.id} play={p}
                    expanded={!!expandedConvRows[p.id]}
                    onExpand={() => setExpandedConvRows(r => ({...r,[p.id]:!r[p.id]}))}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* +EV Bets */}
        {(tab==="All"||tab==="Moneyline"||tab==="Spread"||tab==="Game Total") && (
          <div style={{ marginBottom:28 }}>
            <SectionHeader
              icon="⚡"
              title={tab === "All" ? "+EV Bets" : `${tab} +EV Bets`}
              count={filteredBets.length}
              badge={<Pill color={T.green}>+EV · Odds API · 3.5% min edge</Pill>}
            />
            <div style={{ display:"inline-flex", gap:2, marginBottom:12, marginTop:-4, background:T.bg, border:`1px solid ${T.border}`, borderRadius:8, padding:3 }}>
              {[["edge","Edge %"],["ev","EV %"],["kelly","Kelly %"]].map(([key,label]) => (
                <button key={key} onClick={() => setEvSort(key)} style={{
                  background: evSort === key ? T.surface : "transparent",
                  border:"none", cursor:"pointer",
                  fontSize:10, fontWeight:evSort === key ? 700 : 400, fontFamily:"inherit",
                  color: evSort === key ? T.text : T.textDim,
                  padding:"4px 12px", borderRadius:6,
                  transition:"all 0.15s",
                }}>{label}{evSort === key ? " ↓" : ""}</button>
              ))}
            </div>
            {filteredBets.length === 0 ? (
              <EmptyState icon="🔍" message="No +EV bets right now"
                sub={data?.hasUpcomingGames === false
                  ? `All games are underway. New lines open ~9 AM ET tomorrow. Next engine run: ${getNextRunTime()}.`
                  : `Lines are sharp today. Next check: ${getNextRunTime()}.`}
              />
            ) : (
              <div className="conv-grid" style={{
                display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:12, alignItems:"start",
              }}>
                {filteredBets.map((bet) => (
                  <EVBetCard key={bet.id} bet={bet}
                    expanded={!!expandedEvRows[bet.id]}
                    onExpand={() => setExpandedEvRows(r => ({...r,[bet.id]:!r[bet.id]}))}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Props Tab */}
        {tab === "Props" && (() => {
          const allFiltered = propBets
            .filter(p => propMarketFilter === "all" || p.market === propMarketFilter)
            .sort((a,b) => {
              if (propSort === "edge")    return ((b.edge*100)||b.ev||0) - ((a.edge*100)||a.ev||0);
              if (propSort === "hitRate") return (b.hitRate||0) - (a.hitRate||0);
              if (propSort === "line")    return (a.line||0) - (b.line||0);
              return (b.convictionScore||0) - (a.convictionScore||0);
            });

          const autoProps  = allFiltered.filter(p => p.convictionScore >= 70);
          const evProps    = allFiltered.filter(p => p.convictionScore < 70);

          return (
            <div>
              {/* Market filter + sort bar */}
              <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap",
                alignItems:"center", justifyContent:"space-between" }}>
                <div style={{
                  display:"flex", gap:5, overflowX:"auto",
                  WebkitOverflowScrolling:"touch", scrollbarWidth:"none", paddingBottom:2,
                }}>
                  {PROP_MARKET_FILTERS.map(f => (
                    <button key={f.id} onClick={() => setPropMarketFilter(f.id)} style={{
                      padding:"4px 12px", borderRadius:20, fontSize:10, cursor:"pointer",
                      whiteSpace:"nowrap", fontFamily:"inherit", flexShrink:0,
                      border:`1px solid ${propMarketFilter===f.id ? T.purple+"88" : T.border}`,
                      background: propMarketFilter===f.id ? `${T.purple}15` : "transparent",
                      color: propMarketFilter===f.id ? T.purple : T.textDim,
                      transition:"all 0.15s",
                    }}>{f.label}</button>
                  ))}
                </div>
                <div style={{
                  display:"inline-flex", background:T.bg, border:`1px solid ${T.border}`,
                  borderRadius:8, padding:3, gap:2, flexShrink:0,
                }}>
                  {[{id:"conviction",label:"Conviction"},{id:"edge",label:"Edge %"},{id:"hitRate",label:"Hit Rate"}].map(opt => (
                    <button key={opt.id} onClick={() => setPropSort(opt.id)} style={{
                      padding:"3px 10px", borderRadius:6, fontSize:9, cursor:"pointer",
                      border:"none", fontFamily:"inherit",
                      background: propSort===opt.id ? T.surface : "transparent",
                      color: propSort===opt.id ? T.text : T.textDim,
                      fontWeight: propSort===opt.id ? 700 : 400,
                      transition:"all 0.15s",
                    }}>{opt.label}{propSort===opt.id ? " ↓" : ""}</button>
                  ))}
                </div>
              </div>

              {autoProps.length > 0 && (
                <div style={{ marginBottom:28 }}>
                  <SectionHeader icon="🎯" title="Props Conviction" count={autoProps.length}
                    badge={<Pill color={T.purple} glow>Auto-bet ≥70</Pill>} />
                  <PropsTable props={autoProps} ppMap={prizePicksMap} isMobile={isMobile} />
                </div>
              )}

              <div>
                <SectionHeader icon="⚡" title="Props +EV" count={evProps.length}
                  badge={<Pill color={T.green}>3.5% min edge</Pill>} />
                {evProps.length === 0
                  ? <EmptyState icon="🔍" message="No prop edges found"
                      sub={propBets.length === 0
                        ? "Prop lines load when the engine runs. Check back after the next scheduled run."
                        : autoProps.length > 0
                          ? "All props met the conviction threshold above."
                          : "Try a different market filter."} />
                  : <PropsTable props={evProps} ppMap={prizePicksMap} isMobile={isMobile} />
                }
              </div>
            </div>
          );
        })()}

        {/* History Tab */}
        {tab === "History" && (
          <div>
            {/* Chart */}
            <div style={{
              background:T.surface, border:`1px solid ${T.border}`,
              borderTop:`1px solid ${T.green}26`,
              borderRadius:14, padding:"20px 24px", marginBottom:20,
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:T.text }}>
                    Portfolio Performance
                    {isBookFiltered && (
                      <span style={{ fontSize:9, color:T.textDim, fontWeight:400, marginLeft:8 }}>
                        ({activeBookLabels.join(", ")})
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:10, color:T.textDim, marginTop:3 }}>
                    $100 starting · Kelly Criterion · ML-weighted signals
                  </div>
                </div>
                <div style={{
                  fontSize:14, fontWeight:800,
                  color: filteredPnl >= 0 ? T.green : T.red,
                }}>
                  {filteredPnl >= 0 ? "+" : ""}${filteredPnl.toFixed(2)}
                </div>
              </div>

              {chartData.length < 2 ? (
                <div style={{ height:140, display:"flex", alignItems:"center", justifyContent:"center",
                  borderTop:`1px solid ${T.border}`, marginTop:16 }}>
                  <span style={{ fontSize:11, color:T.textDim }}>Resolving first bets…</span>
                </div>
              ) : (
                <div style={{ height:160, marginTop:16 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top:4, right:4, bottom:0, left:0 }}>
                      <defs>
                        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"  stopColor={T.green} stopOpacity={0.25}/>
                          <stop offset="60%" stopColor={T.green} stopOpacity={0.05}/>
                          <stop offset="100%" stopColor={T.green} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" hide/>
                      <YAxis hide domain={["auto","auto"]}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <ReferenceLine y={100} stroke={T.border} strokeDasharray="3 3"/>
                      {chartData.length > 1 && (
                        <ReferenceLine y={chartData[chartData.length-1].bankroll}
                          stroke={T.green} strokeDasharray="4 4" strokeOpacity={0.4}/>
                      )}
                      <Area type="monotone" dataKey="bankroll"
                        stroke={T.green} strokeWidth={2.5}
                        fill="url(#chartGrad)" dot={false}
                        activeDot={{ r:4, fill:T.green, stroke:T.bg }}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* History list */}
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, overflow:"hidden" }}>
              <div style={{
                display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"14px 20px", borderBottom:`1px solid ${T.border}`,
              }}>
                <div style={{ fontSize:13, fontWeight:700, color:T.text }}>Bet History</div>
                <div style={{ fontSize:10, color:T.textDim }}>
                  {filteredHistory.filter(h=>h.status==="won").length}W /&nbsp;
                  {filteredHistory.filter(h=>h.status==="lost").length}L /&nbsp;
                  {filteredHistory.filter(h=>h.status==="pending").length} pending
                </div>
              </div>
              {filteredHistory.length === 0 ? (
                <div style={{ padding:"40px 20px", textAlign:"center", color:T.textDim, fontSize:11 }}>
                  No bets yet — history appears here after the engine places its first bet.
                </div>
              ) : (
                [...filteredHistory].reverse().map(h => <HistoryRow key={h.id} h={h}/>)
              )}
            </div>
          </div>
        )}

        {/* Info Tab */}
        {tab === "Info" && <InfoTab/>}
      </div>
    </div>
  );
}
