// pages/index.jsx — NBA Edge v2 Professional UI
import { useState, useEffect, useCallback, useRef } from "react";
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
  bg:        "#060a14",
  bgAlt:     "#070d1c",
  surface:   "#070e1d",
  surfaceHi: "#0a1628",
  border:    "#0e1c33",
  borderHi:  "#1a3355",
  text:      "#f1f5f9",
  textMid:   "#94a3b8",
  textDim:   "#475569",
  textDeep:  "#334155",
  label:     "#1e3a5f",
  blue:      "#1d6cf5",
  blueDim:   "rgba(29,108,245,0.08)",
  green:     "#22c55e",
  greenDim:  "rgba(34,197,94,0.05)",
  amber:     "#f59e0b",
  amberDim:  "rgba(245,158,11,0.1)",
  red:       "#ef4444",
  indigo:    "#5865f2",
  orange:    "#f97316",
  // legacy aliases for components not yet migrated:
  gold:      "#f59e0b",
  goldDim:   "rgba(245,158,11,0.1)",
  live:      "#22c55e",
  purple:    "#6366f1",
  purpleDim: "rgba(99,102,241,0.08)",
  espn:      "#ef4444",
  discord:   "#5865f2",   // used by Discord link in header — do NOT remove
};


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
        <span style={{ fontSize:size > 48 ? 15 : 12, fontWeight:800, color, lineHeight:1,
          fontFamily:"'Barlow Condensed',system-ui,sans-serif" }}>{score}</span>
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
        <div style={{ fontSize:22, fontWeight:800, color, letterSpacing:"0.02em",
          fontFamily:"'JetBrains Mono',monospace" }}>{fmtOdds(value)}</div>
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

  // Top 3 book chips for always-visible odds row
  const topChips = play.allLines
    ? Object.entries(play.allLines).filter(([,v])=>v!=null).slice(0,3)
    : [];

  return (
    <div onClick={onExpand} style={{
      background: T.surface,
      border:`1px solid ${T.border}`,
      borderLeft:`3px solid ${accentColor}`,
      borderRadius:10, cursor:"pointer", overflow:"hidden",
      transition:"border-color 0.15s, box-shadow 0.15s",
      boxShadow: expanded ? `0 4px 20px ${accentColor}10` : "none",
    }}>
      <div style={{ padding:"14px 16px" }}>
        {/* Header row: badges + ring */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", flex:1, marginRight:10 }}>
            {isAutoBet
              ? <span style={{ fontSize:8, fontWeight:700, padding:"2px 7px", borderRadius:3,
                  background:`${T.green}18`, border:`1px solid ${T.green}33`, color:T.green,
                  fontFamily:"'Barlow',system-ui,sans-serif", letterSpacing:"0.06em" }}>✓ AUTO-BET</span>
              : <span style={{ fontSize:8, fontWeight:700, padding:"2px 7px", borderRadius:3,
                  background:`${T.textDim}12`, border:`1px solid ${T.border}`, color:T.textDim,
                  fontFamily:"'Barlow',system-ui,sans-serif", letterSpacing:"0.06em" }}>WATCH</span>}
            <span style={{ fontSize:8, fontWeight:700, padding:"2px 7px", borderRadius:3,
              background:`${betTypeColor}12`, border:`1px solid ${betTypeColor}33`, color:betTypeColor,
              fontFamily:"'Barlow',system-ui,sans-serif" }}>{betTypeLabel}</span>
            {play.tier && (
              <span style={{ fontSize:8, fontWeight:700, padding:"2px 7px", borderRadius:3,
                background:`${accentColor}12`, border:`1px solid ${accentColor}33`, color:accentColor,
                fontFamily:"'Barlow',system-ui,sans-serif" }}>{play.tier}</span>
            )}
            {play.crossConfirmed && (
              <span style={{ fontSize:8, fontWeight:700, padding:"2px 7px", borderRadius:3,
                background:`${T.purple}12`, border:`1px solid ${T.purple}33`, color:T.purple,
                fontFamily:"'Barlow',system-ui,sans-serif" }}>⚡ CONF</span>
            )}
          </div>
          <ScoreRing score={play.convictionScore} size={48} />
        </div>

        {/* Team name */}
        <div style={{ fontSize:17, fontWeight:700, color:T.text, marginBottom:2, lineHeight:1.2,
          letterSpacing:"-0.02em", fontFamily:"'Barlow',system-ui,sans-serif" }}>
          {play.selection?.replace(/ ML$/i,"")}
        </div>
        <div style={{ fontSize:10, color:T.textDim, marginBottom:8,
          fontFamily:"'Barlow',system-ui,sans-serif" }}>{play.game}</div>

        {/* Records */}
        {(play.teamRecord || play.oppRecord) && (
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
            {play.teamRecord && (
              <span style={{ fontSize:10, fontWeight:700, color:T.text,
                fontFamily:"'Barlow Condensed',system-ui,sans-serif" }}>{play.teamRecord}</span>
            )}
            {play.teamRecord && play.oppRecord && (
              <span style={{ fontSize:9, color:T.textDim }}>vs</span>
            )}
            {play.oppRecord && (
              <span style={{ fontSize:10, color:T.textMid,
                fontFamily:"'Barlow Condensed',system-ui,sans-serif" }}>{play.oppRecord}</span>
            )}
          </div>
        )}

        {/* Always-visible odds chips */}
        {topChips.length > 0 ? (
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:8 }}>
            {topChips.map(([bk, val]) => {
              const isBest = bk === play.bestBook;
              const meta = BOOK_META[bk] || { short: bk.slice(0,3).toUpperCase() };
              return (
                <span key={bk} style={{
                  padding:"3px 8px", borderRadius:4, fontSize:9,
                  background: T.bg,
                  border: isBest ? `1px solid ${T.green}55` : `1px solid ${T.border}`,
                  display:"flex", gap:5, alignItems:"center",
                }}>
                  <span style={{ color:T.textDim, fontFamily:"'Barlow',system-ui,sans-serif",
                    fontWeight:600, fontSize:8 }}>{meta.short}</span>
                  <span style={{ color: val.odds < 0 ? T.blue : T.gold,
                    fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>{fmtOdds(val.odds)}</span>
                </span>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize:9, color:T.textDim, fontStyle:"italic", marginBottom:8 }}>
            No lines — check sportsbook
          </div>
        )}

        {/* Get At Or Better — compact single line */}
        {play.getAtOrBetter != null && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
            padding:"6px 10px", borderRadius:6, marginBottom:8,
            background:`${T.gold}08`, border:`1px solid ${T.gold}22` }}>
            <span style={{ fontSize:8, color:T.textDim, fontWeight:700, letterSpacing:"0.1em",
              fontFamily:"'Barlow',system-ui,sans-serif" }}>GET AT OR BETTER</span>
            <span style={{ fontSize:14, fontWeight:700, color:T.gold,
              fontFamily:"'JetBrains Mono',monospace" }}>{fmtOdds(play.getAtOrBetter)}</span>
          </div>
        )}

        {/* Expanded: full book table + signals */}
        {expanded && play.signals && (
          <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${T.border}` }}>
            <BookOddsTable allLines={play.allLines} bestBook={play.bestBook} />
            <div style={{ fontSize:8, color:T.textDim, letterSpacing:"0.12em", marginBottom:8,
              textTransform:"uppercase", fontFamily:"'Barlow',system-ui,sans-serif" }}>
              Signal Breakdown
            </div>
            {play.signals.map(sig => <SignalBar key={sig.key} label={sig.label} score={sig.score} />)}
          </div>
        )}

        {/* Expand toggle */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10 }}>
          <div style={{ flex:1, height:1, background:T.border }}/>
          <span style={{ fontSize:8, color:T.textDim, letterSpacing:"0.1em", flexShrink:0,
            fontFamily:"'Barlow',system-ui,sans-serif" }}>
            {expanded ? "▲ COLLAPSE" : "▼ SIGNALS"}
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
  const topChips = bet.allLines
    ? Object.entries(bet.allLines).filter(([,v])=>v!=null).slice(0,3)
    : [];

  return (
    <div onClick={onExpand} style={{
      background:T.surface,
      border:`1px solid ${T.border}`,
      borderLeft:`3px solid ${T.green}`,
      borderRadius:10, cursor:"pointer", overflow:"hidden",
      transition:"box-shadow 0.15s",
      boxShadow: expanded ? `0 4px 20px ${T.green}10` : "none",
    }}>
      <div style={{ padding:"14px 16px" }}>
        {/* Tags */}
        <div style={{ display:"flex", gap:4, marginBottom:10, flexWrap:"wrap" }}>
          <span style={{ fontSize:8, fontWeight:700, padding:"2px 7px", borderRadius:3,
            background:`${typeColor}12`, border:`1px solid ${typeColor}33`, color:typeColor,
            fontFamily:"'Barlow',system-ui,sans-serif" }}>{bet.type || "Moneyline"}</span>
          <span style={{ fontSize:8, fontWeight:700, padding:"2px 7px", borderRadius:3,
            background:`${edgeColor}12`, border:`1px solid ${edgeColor}33`, color:edgeColor,
            fontFamily:"'Barlow',system-ui,sans-serif" }}>{edgeLabel}</span>
        </div>

        {/* Selection */}
        <div style={{ fontSize:17, fontWeight:700, color:T.text, marginBottom:2, lineHeight:1.2,
          letterSpacing:"-0.02em", fontFamily:"'Barlow',system-ui,sans-serif" }}>
          {bet.selection?.replace(/ ML$/i,"")}
        </div>
        <div style={{ fontSize:10, color:T.textDim, marginBottom:8,
          fontFamily:"'Barlow',system-ui,sans-serif" }}>{bet.game}</div>

        {/* Stats row */}
        <div style={{ display:"flex", gap:16, marginBottom:8 }}>
          {[
            { label:"Edge",  value:`+${bet.edge?.toFixed(1)}%`,    color:T.green  },
            { label:"EV",    value:`+${bet.ev?.toFixed(1)}%`,       color:T.green  },
            { label:"Kelly", value:`${bet.kellyPct?.toFixed(1)}%`, color:T.purple },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <div style={{ fontSize:8, color:T.textDim, letterSpacing:"0.08em",
                fontFamily:"'Barlow',system-ui,sans-serif" }}>{label}</div>
              <div style={{ fontSize:13, fontWeight:700, color,
                fontFamily:"'JetBrains Mono',monospace" }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Always-visible odds chips */}
        {topChips.length > 0 ? (
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:8 }}>
            {topChips.map(([bk, val]) => {
              const isBest = bk === bet.bestBook;
              const meta = BOOK_META[bk] || { short: bk.slice(0,3).toUpperCase() };
              return (
                <span key={bk} style={{
                  padding:"3px 8px", borderRadius:4, fontSize:9,
                  background:T.bg,
                  border: isBest ? `1px solid ${T.green}55` : `1px solid ${T.border}`,
                  display:"flex", gap:5, alignItems:"center",
                }}>
                  <span style={{ color:T.textDim, fontFamily:"'Barlow',system-ui,sans-serif",
                    fontWeight:600, fontSize:8 }}>{meta.short}</span>
                  <span style={{ color: val.odds < 0 ? T.blue : T.gold,
                    fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>{fmtOdds(val.odds)}</span>
                </span>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize:9, color:T.textDim, fontStyle:"italic", marginBottom:8 }}>
            No lines — check sportsbook
          </div>
        )}

        {/* Get At Or Better — compact */}
        {bet.getAtOrBetter != null && (
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
            padding:"6px 10px", borderRadius:6, marginBottom:8,
            background:`${T.green}08`, border:`1px solid ${T.green}22` }}>
            <span style={{ fontSize:8, color:T.textDim, fontWeight:700, letterSpacing:"0.1em",
              fontFamily:"'Barlow',system-ui,sans-serif" }}>GET AT OR BETTER</span>
            <span style={{ fontSize:14, fontWeight:700, color:T.green,
              fontFamily:"'JetBrains Mono',monospace" }}>{fmtOdds(bet.getAtOrBetter)}</span>
          </div>
        )}

        {/* Expanded */}
        {expanded && (
          <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${T.border}` }}>
            <BookOddsTable allLines={bet.allLines} bestBook={bet.bestBook} />
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:8, color:T.textDim, letterSpacing:"0.12em", marginBottom:8,
                textTransform:"uppercase", fontFamily:"'Barlow',system-ui,sans-serif" }}>
                Probability Analysis
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                {[
                  { label:"True Prob",    value:`${bet.ourProbability?.toFixed(1)}%`, color:T.green },
                  { label:"Book Implied", value:`${bet.bookImplied?.toFixed(1)}%`,    color:T.red   },
                  { label:"Our Edge",     value:`+${bet.edge?.toFixed(1)}%`,           color:T.blue  },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background:T.bg, borderRadius:6, padding:"8px",
                    border:`1px solid ${T.border}`, textAlign:"center" }}>
                    <div style={{ fontSize:7, color:T.textDim, marginBottom:3,
                      fontFamily:"'Barlow',system-ui,sans-serif" }}>{label}</div>
                    <div style={{ fontSize:13, fontWeight:700, color,
                      fontFamily:"'JetBrains Mono',monospace" }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontSize:8, color:T.textDim, letterSpacing:"0.08em",
                  fontFamily:"'Barlow',system-ui,sans-serif" }}>KELLY SIZING</span>
                <span style={{ fontSize:9, color:T.purple, fontWeight:700,
                  fontFamily:"'JetBrains Mono',monospace" }}>{bet.kellyPct?.toFixed(1)}%</span>
              </div>
              <div style={{ height:3, background:T.border, borderRadius:2, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${kellyWidth}%`, borderRadius:2,
                  background:`linear-gradient(90deg, ${T.purple}, #9b6dff)` }}/>
              </div>
            </div>
            <div style={{ background:T.bg, borderRadius:8, padding:"10px 12px",
              border:`1px solid ${T.border}`, fontSize:10, color:T.textMid, lineHeight:1.7 }}>
              <span style={{ color:T.green, fontWeight:700 }}>Why this bet? </span>
              True probability ({bet.ourProbability?.toFixed(1)}%) exceeds book implied ({bet.bookImplied?.toFixed(1)}%),
              a {bet.edge?.toFixed(1)}% edge. Kelly recommends {bet.kellyPct?.toFixed(1)}% at {fmtOdds(bet.bestOdds)} on {BOOK_META[bet.bestBook]?.label || bet.bestBook}.
            </div>
          </div>
        )}

        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10 }}>
          <div style={{ flex:1, height:1, background:T.border }}/>
          <span style={{ fontSize:8, color:T.textDim, letterSpacing:"0.1em", flexShrink:0,
            fontFamily:"'Barlow',system-ui,sans-serif" }}>
            {expanded ? "▲ COLLAPSE" : "▼ EXPAND"}
          </span>
          <div style={{ flex:1, height:1, background:T.border }}/>
        </div>
      </div>
    </div>
  );
}

// ── BDL Context Panel — "Picks with Proof" stat context on row expand ────────
function BDLContextPanel({ context, play }) {
  // Note: `stat` uses BDL field name abbreviations ("pts", "reb", "ast", "fg3m")
  // internally. The spec example shows "points" but BDL's actual field names are
  // abbreviated — the statLabel map handles display. This is an intentional deviation
  // from the spec's example JSON for practical BDL compatibility.
  const statLabel = {
    pts: "PTS", reb: "REB", ast: "AST", fg3m: "3PM",
    margin: "MARGIN", total: "TOTAL",
  };

  // Loading state
  if (context === undefined) {
    return (
      <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ fontSize:9, color:T.textDim, letterSpacing:"0.12em", marginBottom:10,
          fontFamily:"'Barlow',sans-serif", textTransform:"uppercase" }}>
          Statistical Context
        </div>
        {[1,2,3].map(i => (
          <div key={i} style={{ height:14, background:T.surfaceHi, borderRadius:4,
            marginBottom:8, width: i === 3 ? "60%" : "100%",
            animation:"pulse 1.5s ease-in-out infinite" }} />
        ))}
      </div>
    );
  }

  // Error states
  if (context?.error === "not_found") {
    return (
      <div style={{ padding:"10px 16px", borderBottom:`1px solid ${T.border}`,
        fontSize:10, color:T.textDim, fontFamily:"'Barlow',sans-serif" }}>
        No BDL data available for this play
      </div>
    );
  }
  if (context?.error) {
    return (
      <div style={{ padding:"10px 16px", borderBottom:`1px solid ${T.border}`,
        fontSize:10, color:T.textDim, fontFamily:"'Barlow',sans-serif" }}>
        Stats temporarily unavailable
      </div>
    );
  }

  const { last5 = [], hitRate, seasonAvg, restDays, isBackToBack, stat, propLine,
    playerName, teamName } = context;
  const label = statLabel[stat] || stat?.toUpperCase() || "STAT";
  const maxVal = Math.max(...last5.map(g => Math.abs(g.value || 0)), 1); // guard against 0-max
  const hitRateColor = hitRate === null ? T.textDim
    : hitRate >= 0.6 ? T.green : hitRate >= 0.4 ? T.amber : T.red;
  const restColor = isBackToBack ? T.red : restDays === 1 ? T.amber : restDays >= 2 ? T.green : T.textDim;
  const restText = isBackToBack ? "Back-to-back" : restDays === 1 ? "1 day rest" : `${restDays ?? "?"} days rest`;

  return (
    <div style={{ borderBottom:`1px solid ${T.border}`, background:T.surface }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"10px 16px 6px", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ fontSize:9, fontWeight:800, color:T.textDim, letterSpacing:"0.12em",
          textTransform:"uppercase", fontFamily:"'Barlow',sans-serif" }}>
          Statistical Context · {playerName || teamName}
        </div>
        <div style={{ fontSize:8, color:T.textDim, fontFamily:"'Barlow',sans-serif" }}>
          Powered by BallDontLie
        </div>
      </div>

      <div style={{ padding:"10px 16px", display:"flex", flexDirection:"column", gap:10 }}>
        {/* Last 5 game log */}
        {last5.length > 0 && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
              marginBottom:6 }}>
              <div style={{ fontSize:9, color:T.textDim, letterSpacing:"0.1em",
                textTransform:"uppercase", fontFamily:"'Barlow',sans-serif" }}>
                Last {last5.length} Games · {label}
                {propLine !== null && (
                  <span style={{ color:T.textMid }}> (line: {propLine})</span>
                )}
              </div>
              {hitRate !== null && (
                <div style={{ fontSize:10, fontWeight:700, color:hitRateColor,
                  fontFamily:"'JetBrains Mono',monospace" }}>
                  {Math.round(hitRate * last5.length)}/{last5.length} HIT
                </div>
              )}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              {last5.map((g, i) => {
                // Minimum bar width of 4% so a value of exactly 0 still renders a visible sliver
                const barPct = Math.max(Math.round((Math.abs(g.value || 0) / maxVal) * 100), 4);
                const barWidth = `${barPct}%`;
                const dateStr = new Date(g.date).toLocaleDateString("en-US",
                  { month:"short", day:"numeric" });
                return (
                  <div key={i} style={{ display:"grid",
                    gridTemplateColumns:"48px 52px 1fr 28px", gap:6, alignItems:"center" }}>
                    <div style={{ fontSize:9, color:T.textDim,
                      fontFamily:"'JetBrains Mono',monospace" }}>{dateStr}</div>
                    <div style={{ fontSize:10, fontWeight:700, color:T.text, textAlign:"right",
                      fontFamily:"'JetBrains Mono',monospace" }}>
                      {g.value > 0 ? "+" : ""}{g.value}
                    </div>
                    <div style={{ height:3, borderRadius:2, background:T.border, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:barWidth,
                        background: g.hitsLine === true ? T.green : g.hitsLine === false ? T.red : T.textDim, borderRadius:2 }} />
                    </div>
                    <div style={{ fontSize:10, textAlign:"center",
                      color: g.hitsLine ? T.green : g.hitsLine === false ? T.red : T.textDim }}>
                      {g.hitsLine === true ? "✓" : g.hitsLine === false ? "✗" : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Season avg + rest — side by side */}
        <div style={{ display:"flex", gap:16 }}>
          {seasonAvg !== null && (
            <div style={{ fontSize:10, color:T.textMid, fontFamily:"'Barlow',sans-serif" }}>
              Season avg:{" "}
              <span style={{ fontFamily:"'JetBrains Mono',monospace", color:T.text,
                fontWeight:700 }}>{Number(seasonAvg).toFixed(1)}</span>
            </div>
          )}
          {restDays !== null && (
            <div style={{ fontSize:10, fontFamily:"'Barlow',sans-serif",
              color:restColor, fontWeight:600 }}>
              {restText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── History Row — trading blotter style ──────────────────────────────────────
function HistoryRow({ h, rowIndex }) {
  const isWon = h.status === "won";
  const isLost = h.status === "lost";
  const isPending = h.status === "pending";
  const pnl = isWon ? h.potentialPayout : isLost ? -h.wagerAmt : null;
  const accent = isWon ? T.green : isLost ? T.red : isPending ? T.gold : T.textDim;
  const btype = h.betType || h.type || "";
  const statusLabel = isWon ? (h.estimatedResult ? "WIN~" : "WIN") : isLost ? (h.estimatedResult ? "LOSS~" : "LOSS") : isPending ? "PEND" : "VOID";

  return (
    <div style={{
      borderBottom:`1px solid ${T.border}`,
      background: (rowIndex % 2 === 0) ? T.surface : T.bg,
      transition:"background 0.1s",
    }}
    onMouseEnter={e => e.currentTarget.style.background = T.surfaceHi}
    onMouseLeave={e => e.currentTarget.style.background = (rowIndex % 2 === 0) ? T.surface : T.bg}
    >
      <div style={{
        display:"grid",
        gridTemplateColumns:"48px 80px 1fr 52px 70px 80px 60px 72px 80px",
        gap:8, padding:"10px 18px", alignItems:"center",
        fontSize:11,
      }}>
        {/* Status dot + label */}
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <div style={{ width:4, height:4, borderRadius:"50%", background:accent, flexShrink:0 }}/>
          <span style={{ fontSize:8, fontWeight:800, color:accent, letterSpacing:"0.06em",
            fontFamily:"'Barlow',system-ui,sans-serif" }}>{statusLabel}</span>
        </div>

        {/* Date/time */}
        <div>
          <div style={{ fontSize:9, color:T.textMid, fontFamily:"'JetBrains Mono',monospace" }}>
            {new Date(h.date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
          </div>
          <div style={{ fontSize:8, color:T.textDim, fontFamily:"'JetBrains Mono',monospace" }}>
            {new Date(h.date).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}
          </div>
        </div>

        {/* Selection */}
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:12, fontWeight:700, color:T.text, overflow:"hidden",
            textOverflow:"ellipsis", whiteSpace:"nowrap",
            fontFamily:"'Barlow',system-ui,sans-serif" }}>
            {h.selection?.replace(/ ML$/i,"")?.replace(/ Moneyline$/i,"")}
          </div>
          <div style={{ fontSize:9, color:T.textDim, overflow:"hidden", textOverflow:"ellipsis",
            whiteSpace:"nowrap" }}>{h.game}</div>
        </div>

        {/* Type */}
        <div style={{ textAlign:"center" }}>
          <span style={{ fontSize:8, fontWeight:700, padding:"1px 5px", borderRadius:3,
            color: h.isConviction ? T.purple : T.green,
            background: h.isConviction ? `${T.purple}12` : `${T.green}12`,
            border: `1px solid ${h.isConviction ? T.purple : T.green}33`,
            fontFamily:"'Barlow',system-ui,sans-serif" }}>
            {h.isConviction ? "CONV" : "+EV"}
          </span>
        </div>

        {/* Odds */}
        <div style={{ textAlign:"right" }}>
          {h.bestOdds ? (
            <span style={{ fontSize:11, fontWeight:700, color: h.bestOdds < 0 ? T.blue : T.gold,
              fontFamily:"'JetBrains Mono',monospace" }}>{fmtOdds(h.bestOdds)}</span>
          ) : <span style={{ color:T.textDim }}>—</span>}
        </div>

        {/* Book */}
        <div style={{ textAlign:"right" }}>
          {h.bestBook && (
            <span style={{ fontSize:9, color: BOOK_META[h.bestBook]?.color || T.textMid,
              fontFamily:"'Barlow',system-ui,sans-serif" }}>
              {BOOK_META[h.bestBook]?.short || h.bestBook}
            </span>
          )}
        </div>

        {/* Wagered */}
        <div style={{ textAlign:"right" }}>
          <span style={{ fontSize:10, color:T.textMid,
            fontFamily:"'JetBrains Mono',monospace" }}>{fmt$(h.wagerAmt)}</span>
        </div>

        {/* Kelly % */}
        <div style={{ textAlign:"right" }}>
          {h.kellyPct != null ? (
            <span style={{ fontSize:10, color:T.amber, fontFamily:"'JetBrains Mono',monospace" }}>
              {(h.kellyPct * 100).toFixed(1)}%
            </span>
          ) : <span style={{ color:T.textDim }}>—</span>}
        </div>

        {/* P&L */}
        <div style={{ textAlign:"right" }}>
          {pnl !== null ? (
            <span style={{ fontSize:12, fontWeight:800, color:accent,
              fontFamily:"'JetBrains Mono',monospace" }}>
              {pnl > 0 ? "+" : ""}{fmt$(pnl)}
            </span>
          ) : (
            <span style={{ fontSize:10, color:T.textDim }}>—</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Props Table ───────────────────────────────────────────────────────────────
// Player headshot with fallback initials circle
function PlayerAvatar({ espnId, name, size = 32 }) {
  const [err, setErr] = useState(false);
  const initials = (name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      overflow: "hidden", border: `1px solid rgba(255,255,255,0.07)`,
      background: "#0f172a", position: "relative",
    }}>
      {espnId && !err ? (
        <img
          src={`https://a.espncdn.com/i/headshots/nba/players/full/${espnId}.png`}
          alt={name}
          onError={() => setErr(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }}
        />
      ) : (
        <div style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: size * 0.36, fontWeight: 700,
          color: "#64748b", fontFamily: "'Barlow',sans-serif",
        }}>{initials}</div>
      )}
    </div>
  );
}

// Grid-based data-dense layout — Bloomberg terminal aesthetic
// UI/UX: 36px row height, semantic color per value, overflow-x-auto on mobile
function PropsTable({ props, ppMap, isMobile }) {
  if (!props.length) return null;

  const cols = isMobile
    ? "44px 1fr 60px 80px 64px"
    : "44px 1fr 72px 88px 88px 68px 68px 72px 80px";

  const hdr = {
    fontSize:9, color:T.textDim, fontWeight:700, letterSpacing:"0.12em",
    textTransform:"uppercase", textAlign:"center",
  };

  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, overflow:"hidden" }}>
      <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        <div style={{ minWidth: isMobile ? 370 : 740 }}>
          {/* Header row */}
          <div style={{
            display:"grid", gridTemplateColumns:cols,
            padding:"9px 14px", borderBottom:`1px solid ${T.border}`,
            background:T.bg,
          }}>
            <div />
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
                padding:"10px 14px",
                borderBottom: i < props.length-1 ? `1px solid ${T.border}` : "none",
                alignItems:"center",
                borderLeft:`3px solid ${isAutobet ? T.purple : "transparent"}`,
                background: isAutobet ? `${T.purple}05` : "transparent",
                transition:"background 0.15s",
              }}>

                {/* Avatar */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <PlayerAvatar espnId={prop.espnPlayerId} name={prop.player} size={isMobile ? 28 : 32} />
                </div>

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
                  <div className="props-meta-line" style={{ fontSize:10, color:T.textMid }}>
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
function StatCard({ label, value, sub, color = T.green, watermark, sparkBars }) {
  return (
    <div style={{
      background:T.surface,
      border:`1px solid ${T.border}`,
      borderLeft:`3px solid ${color}`,
      borderRadius:8, padding:"14px 16px 14px 14px",
      position:"relative", overflow:"hidden",
    }}>
      {/* Watermark */}
      {watermark && (
        <div style={{
          position:"absolute", right:8, top:4,
          fontSize:32, fontWeight:900, color:T.border,
          fontFamily:"'Barlow Condensed',system-ui,sans-serif",
          lineHeight:1, pointerEvents:"none", userSelect:"none",
        }}>{watermark}</div>
      )}
      <div style={{ fontSize:8, fontWeight:700, color:T.textDim, letterSpacing:"0.15em",
        marginBottom:8, textTransform:"uppercase",
        fontFamily:"'Barlow',system-ui,sans-serif" }}>
        {label}
      </div>
      <div style={{ fontSize:28, fontWeight:800, color, lineHeight:1,
        fontFamily:"'Barlow Condensed',system-ui,sans-serif", marginBottom:4 }}>{value}</div>
      {sub && (
        <div style={{ fontSize:10, color:T.textMid, marginTop:4,
          fontFamily:"'JetBrains Mono',monospace" }}>{sub}</div>
      )}
      {sparkBars && sparkBars.length > 0 && (
        <div style={{ display:"flex", gap:2, alignItems:"flex-end", marginTop:8, height:16 }}>
          {sparkBars.map((bar, i) => (
            <div key={i} style={{
              flex:1, borderRadius:2,
              background: bar.win ? T.green : T.red,
              height: `${Math.max(20, Math.min(100, bar.pct))}%`,
              opacity:0.7,
            }}/>
          ))}
        </div>
      )}
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
function SectionHeader({ icon, title, badge: badgeEl, count, accentColor }) {
  const accent = accentColor || T.espn;
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{
        display:"flex", alignItems:"center", gap:8,
        background:`linear-gradient(90deg, ${T.surfaceHi}, transparent)`,
        borderRadius:4, padding:"0 12px", height:32,
      }}>
        <div style={{ width:3, height:14, borderRadius:2, background:accent, flexShrink:0 }}/>
        <span style={{ fontSize:13, fontWeight:700, color:T.text, letterSpacing:"0.02em",
          fontFamily:"'Barlow',system-ui,sans-serif" }}>{title}</span>
        {count != null && (
          <span style={{
            fontSize:9, fontWeight:700, padding:"1px 5px", borderRadius:3,
            background:T.surfaceHi, color:T.textMid,
            fontFamily:"'JetBrains Mono',monospace",
          }}>{count}</span>
        )}
        {badgeEl && <div style={{ marginLeft:"auto" }}>{badgeEl}</div>}
      </div>
      <div style={{ height:1, background:`linear-gradient(90deg, ${T.borderHi}, transparent)`, marginTop:4 }}/>
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
      <div style={{ fontWeight:800, color: d.bankroll >= 100 ? T.green : T.red, fontSize:15,
        fontFamily:"'JetBrains Mono',monospace" }}>
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

  // New UI state for redesign
  const [expandedId, setExpandedId] = useState(null);
  const bdlCache = useRef(new Map()); // play.id → sentinel or context (prevents duplicate fetches)
  const [bdlData, setBdlData] = useState({}); // play.id → context object (drives re-render)
  const [autoBetFilter, setAutoBetFilter] = useState(false);
  const [mlEngineFilter, setMlEngineFilter] = useState(false);
  const [evPlusFilter, setEvPlusFilter] = useState(false);
  const [crossConfirmedFilter, setCrossConfirmedFilter] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
        awayLogo: away?.team?.logo || `https://a.espncdn.com/i/teamlogos/nba/500/${(away?.team?.abbreviation||"").toLowerCase()}.png`,
        homeLogo: home?.team?.logo || `https://a.espncdn.com/i/teamlogos/nba/500/${(home?.team?.abbreviation||"").toLowerCase()}.png`,
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
    const sid = setInterval(fetchScores, 30000);
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
  const allPropsList   = (data?.allProps || []).filter(bookVisible);
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

  // All props sorted by hit likelihood (trueProb) for the Props tab
  const allPropsDisplay  = filterPropCat(allPropsList.length > 0 ? allPropsList : propBets);
  // High-conviction subset for "auto-bet" badge
  const convictionProps  = filterPropCat(propBets.filter(p => p.convictionScore >= 70));
  const evProps          = filterPropCat(propBets.filter(p => p.convictionScore < 70));

  const filteredPnl = (() => {
    const resolved = (tab === "History" ? filteredHistory : history.filter(bookVisible))
      .filter(h => h.status === "won" || h.status === "lost");
    return resolved.reduce((sum, h) =>
      sum + (h.status === "won" ? (h.potentialPayout || 0) : -(h.wagerAmt || 0)), 0);
  })();

  const fetchBdlContext = (play) => {
    if (bdlCache.current.has(play.id)) return; // already fetching or fetched
    bdlCache.current.set(play.id, "loading");
    const params = new URLSearchParams({
      betType: play.betType || "Moneyline",
      selection: play.selection || "",
      game: play.game || "",
      gameDate: new Date().toISOString().slice(0, 10),
    });
    fetch(`/api/bdl-context?${params}`)
      .then(r => r.json())
      .then(ctx => {
        bdlCache.current.set(play.id, ctx);
        setBdlData(prev => ({ ...prev, [play.id]: ctx }));
      })
      .catch(() => {
        const err = { error: "unavailable" };
        bdlCache.current.set(play.id, err);
        setBdlData(prev => ({ ...prev, [play.id]: err }));
      });
  };

  // New table grouping for redesigned plays table
  const tablePlays = (() => {
    if (!["All","Moneyline","Spread","Game Total"].includes(tab)) return [];
    let plays = filteredConviction;
    if (autoBetFilter)        plays = plays.filter(p => p.convictionScore >= 70);
    if (mlEngineFilter)       plays = plays.filter(p => p.mlScore != null);
    if (evPlusFilter)         plays = plays.filter(p => (p.ev || 0) > 0);
    if (crossConfirmedFilter) plays = plays.filter(p => p.crossConfirmed === true);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      plays = plays.filter(p =>
        (p.selection || "").toLowerCase().includes(q) ||
        (p.game || "").toLowerCase().includes(q)
      );
    }
    return plays.slice().sort((a, b) => (b.convictionScore || 0) - (a.convictionScore || 0));
  })();
  const autoPlays   = tablePlays.filter(p => p.convictionScore >= 70);
  const mediumPlays = tablePlays.filter(p => p.convictionScore >= 55 && p.convictionScore < 70);
  const watchPlays  = tablePlays.filter(p => p.convictionScore < 55);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{
      minHeight:"100vh", background:T.bg, display:"flex",
      alignItems:"center", justifyContent:"center",
      fontFamily:"'Barlow',system-ui,sans-serif",
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

  // ── Render helpers (filled in by subsequent tasks) ──────────────────────
  const renderHeader = () => {
    const bankroll   = data?.bankroll   || 100;
    const winRate    = data?.winRate    != null ? `${Number(data.winRate).toFixed(0)}%` : "—";
    const roi        = data?.roi        != null ? `${Number(data.roi).toFixed(1)}%`     : "—";
    const playsCount = (data?.convictionPlays || []).length;

    return (
      <header style={{
        height: 56, background: T.bgAlt, borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 12px 0 16px", flexShrink: 0, zIndex: 20,
      }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:0, lineHeight:1 }}>
          <span style={{ fontSize:26, fontWeight:900, color:T.blue, letterSpacing:"-0.04em",
            fontFamily:"'Barlow Condensed',system-ui,sans-serif" }}>NBA</span>
          <span style={{ fontSize:26, fontWeight:900, color:T.text, letterSpacing:"-0.04em",
            fontFamily:"'Barlow Condensed',system-ui,sans-serif" }}>EDGE</span>
          <span className="header-stats-extra" style={{ fontSize:7, color:T.label,
            letterSpacing:"0.12em", marginLeft:8, alignSelf:"center",
            fontFamily:"'Barlow',system-ui,sans-serif" }}>EV BETTING ENGINE</span>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:0 }}>
          {[
            { value: `$${Number(bankroll).toFixed(0)}`, label:"BANKROLL", color:T.green },
            { value: winRate,                            label:"WIN RATE",  color:T.blue },
            { value: roi,                                label:"ROI",       color:T.red,     extraClass:"header-stats-extra" },
            { value: `${playsCount}`,                    label:"PLAYS",     color:T.textMid, extraClass:"header-stats-extra" },
          ].map(({ value, label, color, extraClass }, i) => (
            <div key={label} className={extraClass} style={{
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              padding:"0 14px", height:56,
              borderLeft: `1px solid ${T.border}`,
            }}>
              <span style={{ fontSize:13, fontWeight:700, color,
                fontFamily:"'Courier New',monospace", lineHeight:1 }}>{value}</span>
              <span style={{ fontSize:8, color:T.textDeep, letterSpacing:"0.12em",
                fontFamily:"'Barlow',system-ui,sans-serif", marginTop:2 }}>{label}</span>
            </div>
          ))}

          <div style={{ display:"flex", alignItems:"center", gap:6, paddingLeft:8 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:T.green,
              animation:"livePulse 2s infinite", flexShrink:0 }} />
            <span style={{
              fontSize:11, fontWeight:700, padding:"4px 14px", borderRadius:20,
              background:T.blue, color:"#fff", letterSpacing:"0.04em",
              fontFamily:"'Barlow',system-ui,sans-serif", cursor:"default",
            }}>AUTO-BET ≥70</span>
            <a href="https://discord.gg/TRZQRu58au" target="_blank" rel="noopener noreferrer"
              className="header-actions-extra"
              style={{
                fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:20,
                border:`1px solid ${T.indigo}44`, color:T.indigo,
                background:`${T.indigo}10`, textDecoration:"none",
                fontFamily:"'Barlow',system-ui,sans-serif",
              }}>DISCORD</a>
          </div>
        </div>
      </header>
    );
  };
  const renderTicker = () => {
    if (!scoresData || !scoresData.length) {
      return <div style={{ height:64, background:"#060c1a", borderBottom:`1px solid ${T.border}`, flexShrink:0 }} />;
    }
    const doubled = [...scoresData, ...scoresData];
    return (
      <div style={{
        height: 64, background: "#060c1a",
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0, display:"flex", alignItems:"center",
        overflow: "hidden", position:"relative",
      }}>
        <div style={{
          flexShrink:0, display:"flex", alignItems:"center", gap:5,
          padding:"0 10px 0 12px", zIndex:2,
        }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:T.green,
            animation:"pulse 1.4s ease-in-out infinite", color:T.green }} />
          <span style={{ fontSize:9, fontWeight:700, color:T.green, letterSpacing:"0.12em",
            fontFamily:"'Barlow',system-ui,sans-serif" }}>LIVE</span>
        </div>
        <div style={{
          position:"absolute", left:60, top:0, width:30, height:"100%", zIndex:1,
          background:`linear-gradient(90deg, #060c1a, transparent)`, pointerEvents:"none",
        }} />
        <div style={{
          position:"absolute", right:0, top:0, width:40, height:"100%", zIndex:1,
          background:`linear-gradient(270deg, #060c1a, transparent)`, pointerEvents:"none",
        }} />
        <div style={{ flex:1, overflow:"hidden" }}>
          <div className="ticker-track">
            {doubled.map((g, i) => {
              const isLive = g.live;
              const isFinal = g.final;
              const statusColor = isLive ? T.orange : isFinal ? T.textDeep : "#1d4ed8";
              const statusText = isLive
                ? (g.status.replace(/^LIVE · /, "") || "LIVE")
                : isFinal ? "FINAL" : (g.tipTime || "");
              return (
                <div key={i} style={{
                  flexShrink:0, display:"flex", alignItems:"center", gap:8,
                  padding:"0 16px", borderRight:`1px solid ${T.border}`,
                  opacity: isFinal ? 0.45 : 1,
                }}>
                  {/* Team logos column */}
                  <div style={{ display:"flex", flexDirection:"column", gap:3, alignItems:"center" }}>
                    {g.awayLogo
                      ? <img src={g.awayLogo} alt={g.away} style={{ width:20, height:20, objectFit:"contain" }} onError={e=>e.target.style.display="none"} />
                      : <div style={{ width:20, height:20 }} />}
                    {g.homeLogo
                      ? <img src={g.homeLogo} alt={g.home} style={{ width:20, height:20, objectFit:"contain" }} onError={e=>e.target.style.display="none"} />
                      : <div style={{ width:20, height:20 }} />}
                  </div>
                  {/* Team abbrev + scores */}
                  <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ fontSize:11, fontWeight:700, color:T.textMid, minWidth:28,
                        fontFamily:"'Barlow Condensed',sans-serif" }}>{g.away}</span>
                      {(isLive || isFinal) && (
                        <span style={{ fontSize:16, fontWeight:800,
                          color: isFinal ? T.textMid : T.text,
                          fontFamily:"'JetBrains Mono',monospace" }}>{g.awayScore}</span>
                      )}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ fontSize:11, fontWeight:700, color:T.textMid, minWidth:28,
                        fontFamily:"'Barlow Condensed',sans-serif" }}>{g.home}</span>
                      {(isLive || isFinal) && (
                        <span style={{ fontSize:16, fontWeight:800,
                          color: isFinal ? T.textMid : T.text,
                          fontFamily:"'JetBrains Mono',monospace" }}>{g.homeScore}</span>
                      )}
                      {!isLive && !isFinal && g.tipTime && (
                        <span style={{ fontSize:9, fontWeight:600, color:"#3b82f6",
                          fontFamily:"'JetBrains Mono',monospace" }}>{g.tipTime}</span>
                      )}
                    </div>
                  </div>
                  {/* Live/status badge */}
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:1 }}>
                    {isLive && <div style={{ width:6, height:6, borderRadius:"50%", background:T.orange, animation:"pulse 1.4s ease-in-out infinite" }} />}
                    <span style={{ fontSize:8, fontWeight:700, color:statusColor,
                      letterSpacing:"0.06em", fontFamily:"'Barlow',sans-serif",
                      whiteSpace:"nowrap" }}>{statusText}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };
  const renderSidebar = () => {
    const navItems = [
      { label:"All Plays", value:"All",       icon:"⚡", countKey:"all" },
      { label:"Moneyline", value:"Moneyline",  icon:"ML" },
      { label:"Spread",    value:"Spread",     icon:"SPR" },
      { label:"Total",     value:"Game Total", icon:"TOT" },
      { label:"Props",     value:"Props",      icon:"🎯" },
      { label:"History",   value:"History",    icon:"📊" },
      { label:"Info",      value:"Info",       icon:"ℹ" },
    ];
    const totalPlays = (data?.convictionPlays || []).length;

    return (
      <>
        <div style={{ padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
          {navItems.map(item => {
            const active = tab === item.value;
            return (
              <button key={item.value} onClick={() => setTab(item.value)} style={{
                width:"100%", display:"flex", flexDirection:"column",
                alignItems:"center", justifyContent:"center",
                padding:"10px 6px", gap:3, cursor:"pointer",
                background: active ? T.surfaceHi : "transparent",
                border: "none",
                outline: "none",
                borderLeft: active ? `2px solid ${T.blue}` : "2px solid transparent",
                color: active ? T.text : T.textDim,
                transition:"all 0.15s",
              }}>
                <span style={{ fontSize:13, fontFamily:"'JetBrains Mono',monospace",
                  color: active ? T.blue : T.textDim }}>{item.icon}</span>
                <span style={{ fontSize:9.5, fontWeight:600, letterSpacing:"0.04em",
                  fontFamily:"'Barlow',system-ui,sans-serif", textAlign:"center",
                  lineHeight:1.2 }}>{item.label}</span>
                {item.countKey === "all" && totalPlays > 0 && (
                  <span style={{ fontSize:9, padding:"1px 5px", borderRadius:8,
                    background:`${T.blue}18`, color:T.blue,
                    fontFamily:"'JetBrains Mono',monospace" }}>{totalPlays}</span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ padding:"8px 0", flex:1 }}>
          <div style={{ fontSize:8, color:T.textDeep, letterSpacing:"0.14em",
            padding:"4px 8px 6px", fontFamily:"'Barlow',sans-serif" }}>BOOKS</div>
          {[{ id:"all", label:"All" }, ...ALL_BOOKS.slice(0,6)].map(bk => {
            const active = bk.id === "all" ? selectedBooks.has("all") : selectedBooks.has(bk.id);
            const meta = BOOK_META[bk.id];
            return (
              <button key={bk.id} onClick={() => toggleBook(bk.id)} style={{
                width:"100%", display:"flex", flexDirection:"column",
                alignItems:"center", padding:"7px 6px", gap:2,
                background: active ? T.surfaceHi : "transparent",
                border: "none",
                outline: "none",
                cursor:"pointer",
                borderLeft: active ? `2px solid ${T.green}` : "2px solid transparent",
                transition:"all 0.15s",
              }}>
                <span style={{ fontSize:10, fontWeight:700,
                  color: active ? (meta?.color || T.green) : T.textDim,
                  fontFamily:"'Barlow',system-ui,sans-serif" }}>
                  {meta?.short || bk.label}
                </span>
              </button>
            );
          })}
        </div>
      </>
    );
  };
  const renderFilterBar = () => {
    if (!["All","Moneyline","Spread","Game Total"].includes(tab)) {
      return <div style={{ height:1, background:T.border, flexShrink:0 }} />;
    }
    const chips = [
      { icon:"⚡", label:"Auto-Bet Only",   state:autoBetFilter,        set:setAutoBetFilter },
      { icon:"🤖", label:"ML Engine",       state:mlEngineFilter,       set:setMlEngineFilter },
      { icon:"📈", label:"EV+ Only",        state:evPlusFilter,         set:setEvPlusFilter },
      { icon:"🎯", label:"Cross-Confirmed", state:crossConfirmedFilter, set:setCrossConfirmedFilter },
    ];
    return (
      <div style={{
        background: T.surface, borderBottom:`1px solid ${T.border}`,
        padding:"10px 16px", display:"flex", alignItems:"center",
        gap:6, flexWrap:"wrap", flexShrink:0,
      }}>
        {chips.map(chip => (
          <button key={chip.label} onClick={() => chip.set(v => !v)} style={{
            display:"flex", alignItems:"center", gap:5,
            padding:"6px 12px", borderRadius:6, cursor:"pointer",
            background: chip.state ? T.blueDim : "transparent",
            border: chip.state ? `1px solid ${T.blue}44` : `1px solid ${T.border}`,
            color: chip.state ? T.blue : T.textDim,
            transition:"all 0.15s", fontSize:11,
            fontFamily:"'Barlow',system-ui,sans-serif", fontWeight:600,
          }}>
            <span>{chip.icon}</span>
            <span className="filter-chip-label">{chip.label}</span>
            <span style={{
              width:24, height:14, borderRadius:7, position:"relative",
              background: chip.state ? T.blue : T.border, transition:"background 0.15s",
              flexShrink:0, display:"inline-block",
            }}>
              <span style={{
                position:"absolute", top:3,
                left: chip.state ? 14 : 3,
                width:8, height:8, borderRadius:"50%",
                background:"#fff", transition:"left 0.15s",
              }} />
            </span>
          </button>
        ))}

        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search plays…"
          style={{
            flex:1, minWidth:80, background:"transparent",
            border:`1px solid ${T.border}`, borderRadius:6,
            padding:"8px 12px", fontSize:12, color:T.text,
            fontFamily:"'Barlow',system-ui,sans-serif",
            outline:"none",
          }}
        />

        <span style={{ fontSize:11, color:T.textDim, whiteSpace:"nowrap",
          fontFamily:"'JetBrains Mono',monospace" }}>Sort: Score ↓</span>
      </div>
    );
  };
  const renderContent = () => {
    if (tab === "Props")   return renderPropsTab();
    if (tab === "History") return renderHistoryTab();
    if (tab === "Info")    return renderInfoTab();

    const colTemplate = "1.9fr 0.36fr 0.3fr 0.58fr 0.42fr 0.42fr 0.48fr";
    const thStyle = () => ({
      fontSize:9, fontWeight:700, letterSpacing:"0.12em", color:T.textDeep,
      textTransform:"uppercase", fontFamily:"'Barlow',system-ui,sans-serif",
      padding:"10px 14px",
    });

    const renderGroupSection = (plays, bucket) => {
      if (!plays.length) return null;
      const configs = {
        "AUTO-BET":  { label:`⚡ AUTO-BET (${plays.length})`,  accent:T.green,    rowBg:`rgba(34,197,94,0.05)` },
        "MEDIUM":    { label:`MEDIUM (${plays.length})`,        accent:T.amber,    rowBg:"transparent" },
        "WATCHLIST": { label:`WATCHLIST (${plays.length})`,     accent:T.textDeep, rowBg:"transparent" },
      };
      const cfg = configs[bucket];
      return (
        <div key={bucket}>
          <div style={{
            padding:"8px 16px", background:T.bg,
            borderBottom:`1px solid ${T.border}`,
            display:"flex", alignItems:"center", gap:8,
          }}>
            <span style={{ fontSize:11, fontWeight:700, color:cfg.accent,
              fontFamily:"'Barlow',system-ui,sans-serif", letterSpacing:"0.08em" }}>
              {cfg.label}
            </span>
            <div style={{ flex:1, height:1, background:T.border }} />
          </div>
          {plays.map(play => {
            const isExpanded = expandedId === play.id;
            const betTypeLabel = play.betType === "Moneyline" ? "ML"
              : play.betType === "Spread" ? "SPR"
              : play.betType === "Game Total" ? "TOT"
              : play.betType === "Props" ? "PP"
              : (play.betType || "ML").slice(0,3).toUpperCase();
            const oddsColor = (play.bestOdds || 0) < 0 ? T.amber : T.blue;
            const tierLabel = play.convictionScore >= 70 ? "AUTO"
              : play.convictionScore >= 55 ? "MED" : "WATCH";
            const tierStyle = play.convictionScore >= 70
              ? { color:T.amber, background:T.amberDim, border:`1px solid rgba(245,158,11,0.2)` }
              : play.convictionScore >= 55
              ? { color:"#64748b", background:"rgba(100,116,139,0.08)", border:"1px solid rgba(100,116,139,0.15)" }
              : { color:"#475569", background:"rgba(71,85,105,0.08)", border:"1px solid rgba(71,85,105,0.15)" };
            const rowBorderLeft = `2px solid ${cfg.accent}`;
            const rowOpacity = bucket === "WATCHLIST" ? 0.75 : 1;
            return (
              <div key={play.id}>
                <div
                  className="play-row"
                  onClick={() => {
                  const newId = isExpanded ? null : play.id;
                  setExpandedId(newId);
                  if (newId) fetchBdlContext(play);
                }}
                  style={{
                    display:"grid", gridTemplateColumns:colTemplate,
                    alignItems:"center", padding:"12px 16px",
                    borderBottom:`1px solid ${T.border}`,
                    borderLeft: rowBorderLeft,
                    background: cfg.rowBg,
                    cursor:"pointer", opacity:rowOpacity,
                  }}
                >
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:T.text, overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap",
                      fontFamily:"'Barlow',system-ui,sans-serif" }}>
                      {play.selection?.replace(/ ML$/i,"")}
                    </div>
                    <div style={{ fontSize:10, color:T.textMid, overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap",
                      fontFamily:"'Barlow',system-ui,sans-serif" }}>
                      {play.game}
                    </div>
                  </div>
                  <div style={{ textAlign:"center" }}>
                    <span style={{
                      fontSize:20, fontWeight:700, fontFamily:"'Courier New',monospace",
                      color: play.convictionScore >= 70 ? T.green
                        : play.convictionScore >= 55 ? T.amber : T.red,
                    }}>{play.convictionScore}</span>
                  </div>
                  <div className="td-type" style={{ textAlign:"center" }}>
                    <span style={{ fontSize:10, fontWeight:700, color:T.blue,
                      fontFamily:"'Barlow',system-ui,sans-serif", letterSpacing:"0.06em" }}>
                      {betTypeLabel}
                    </span>
                  </div>
                  <div style={{ textAlign:"center" }}>
                    <span style={{ fontSize:13, fontWeight:600, color:oddsColor,
                      fontFamily:"'JetBrains Mono',monospace" }}>
                      {fmtOdds(play.bestOdds)}
                    </span>
                  </div>
                  <div className="td-book" style={{ textAlign:"center" }}>
                    <span style={{ fontSize:10, color:T.green,
                      fontFamily:"'Barlow',system-ui,sans-serif" }}>
                      {BOOK_META[play.bestBook]?.short || play.bestBook || "—"}
                      {play.bestBook ? " ★" : ""}
                    </span>
                  </div>
                  <div className="td-ev" style={{ textAlign:"center" }}>
                    <span style={{ fontSize:11, fontFamily:"'Courier New',monospace",
                      color: (play.ev || 0) > 0 ? T.green : T.textDim }}>
                      {play.ev != null ? `+${play.ev.toFixed(1)}` : "—"}
                    </span>
                  </div>
                  <div style={{ textAlign:"center" }}>
                    <span style={{
                      fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:3,
                      fontFamily:"'Barlow',system-ui,sans-serif", letterSpacing:"0.04em",
                      ...tierStyle,
                    }}>{tierLabel}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{
                    borderBottom:`1px solid ${T.border}`,
                    borderLeft: rowBorderLeft,
                    background: T.surfaceHi,
                  }}>
                    <BDLContextPanel context={bdlData[play.id]} play={play} />
                    <div style={{ padding:"12px 16px" }}>
                      <ConvictionCard
                        play={play}
                        expanded={true}
                        onExpand={() => setExpandedId(null)}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    };

    return (
      <div style={{ minWidth:0 }}>
        <div style={{
          position:"sticky", top:0, zIndex:10,
          background: T.bg, borderBottom:`2px solid ${T.border}`,
          display:"grid", gridTemplateColumns:colTemplate, padding:"0 16px",
        }}>
          <div style={thStyle()}>PLAY</div>
          <div style={{ ...thStyle(), textAlign:"center" }}>SCORE</div>
          <div className="th-type" style={{ ...thStyle(), textAlign:"center" }}>TYPE</div>
          <div style={{ ...thStyle(), textAlign:"center" }}>LINE</div>
          <div className="th-book" style={{ ...thStyle(), textAlign:"center" }}>BOOK</div>
          <div className="th-ev" style={{ ...thStyle(), textAlign:"center" }}>EV</div>
          <div style={{ ...thStyle(), textAlign:"center" }}>TIER</div>
        </div>

        {tablePlays.length === 0 ? (
          <div style={{ padding:"40px 24px", textAlign:"center", color:T.textDim }}>
            <div style={{ fontSize:40, marginBottom:12 }}>📊</div>
            <div style={{ fontSize:16, color:T.textMid, fontWeight:600 }}>No plays match current filters</div>
            <div style={{ fontSize:12, marginTop:6, fontFamily:"'Barlow',sans-serif" }}>
              Engine next runs at {getNextRunTime()}
            </div>
          </div>
        ) : (
          <>
            {renderGroupSection(autoPlays,   "AUTO-BET")}
            {renderGroupSection(mediumPlays, "MEDIUM")}
            {renderGroupSection(watchPlays,  "WATCHLIST")}
          </>
        )}
      </div>
    );
  };

  const renderPropsTab = () => <div style={{ padding:20 }}>{renderLegacyPropsContent()}</div>;
  const renderHistoryTab = () => renderLegacyHistoryContent();
  const renderInfoTab = () => <div style={{ padding:20 }}>{renderLegacyInfoContent()}</div>;
  const renderLegacyPropsContent = () => {
    if (tab !== "Props") return null;
    const displayProps = allPropsDisplay;
    return (
      <div>
        {/* Prop category filter */}
        <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
          {["All","Points","Rebounds","Assists","3PM","PRA"].map(cat => (
            <button key={cat} onClick={() => setPropCat(cat)} style={{
              padding:"4px 10px", borderRadius:4, fontSize:10, cursor:"pointer",
              background: propCat === cat ? T.blue : "transparent",
              border: propCat === cat ? `1px solid ${T.blue}` : `1px solid ${T.border}`,
              color: propCat === cat ? "#fff" : T.textDim,
              fontFamily:"'Barlow',sans-serif",
            }}>{cat}</button>
          ))}
          {displayProps.length > 0 && (
            <span style={{ marginLeft:"auto", fontSize:10, color:T.textDim,
              fontFamily:"'Barlow',sans-serif" }}>
              {displayProps.length} player{displayProps.length !== 1 ? "s" : ""} · ranked by hit likelihood
            </span>
          )}
        </div>
        {displayProps.length > 0 ? (
          <PropsTable props={displayProps} ppMap={prizePicksMap} isMobile={isMobile} />
        ) : (
          <div style={{ textAlign:"center", padding:"40px 20px", color:T.textDim }}>
            <div style={{ fontSize:24, marginBottom:8 }}>🎯</div>
            <div style={{ fontSize:12, color:T.textMid }}>
              {data ? "No prop lines available yet — engine runs every 5 min" : "Loading…"}
            </div>
          </div>
        )}
      </div>
    );
  };
  const renderLegacyHistoryContent = () => {
    if (tab !== "History") return null;
    const resolved = (data?.history || []).filter(h => h.status === "won" || h.status === "lost");
    const wins = resolved.filter(h => h.status === "won").length;
    const losses = resolved.filter(h => h.status === "lost").length;
    const totalPnl = (data?.bankroll || 100) - 100;
    const winRate = resolved.length > 0 ? ((wins / resolved.length) * 100).toFixed(0) : 0;

    const displayData = chartData.map(d => ({
      ...d,
      dateLabel: d.date === "Start" ? "Start" : new Date(d.date).toLocaleDateString("en-US", {month:"short", day:"numeric"}),
    }));

    return (
      <div style={{ padding:"16px 20px" }}>
        {/* Stats row */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20 }}>
          {[
            { label:"Bankroll",  value:`$${(data?.bankroll||100).toFixed(2)}`, color:T.green  },
            { label:"Win Rate",  value:`${winRate}%`,                          color:T.blue   },
            { label:"P&L",       value:`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? T.green : T.red },
            { label:"Record",    value:`${wins}W – ${losses}L`,                color:T.textMid},
          ].map(stat => (
            <div key={stat.label} style={{
              background:T.surface, borderRadius:8, padding:"12px 16px",
              border:`1px solid ${T.border}`,
            }}>
              <div style={{ fontSize:10, color:T.textDim, letterSpacing:"0.1em",
                fontFamily:"'Barlow',sans-serif", marginBottom:4 }}>{stat.label.toUpperCase()}</div>
              <div style={{ fontSize:18, fontWeight:700, color:stat.color,
                fontFamily:"'JetBrains Mono',monospace" }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Bankroll chart */}
        {displayData.length > 1 && (
          <div style={{
            background:T.surface, borderRadius:10, padding:"16px",
            border:`1px solid ${T.border}`, marginBottom:20,
          }}>
            <div style={{ fontSize:10, color:T.textDim, letterSpacing:"0.1em",
              fontFamily:"'Barlow',sans-serif", marginBottom:12 }}>BANKROLL TRAJECTORY</div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={displayData} margin={{ top:4, right:8, left:0, bottom:4 }}>
                <defs>
                  <linearGradient id="bankrollGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="dateLabel" tick={{ fontSize:9, fill:T.textDim, fontFamily:"'Barlow',sans-serif" }}
                  axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize:9, fill:T.textDim, fontFamily:"'JetBrains Mono',monospace" }}
                  axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} width={48} />
                <Tooltip
                  contentStyle={{ background:T.surfaceHi, border:`1px solid ${T.border}`, borderRadius:6,
                    fontSize:11, fontFamily:"'JetBrains Mono',monospace", color:T.text }}
                  formatter={(v) => [`$${Number(v).toFixed(2)}`, "Bankroll"]}
                  labelStyle={{ color:T.textMid, fontSize:10 }}
                />
                <ReferenceLine y={100} stroke={T.border} strokeDasharray="4 2" />
                <Area type="monotone" dataKey="bankroll"
                  stroke="#22c55e" strokeWidth={2}
                  fill="url(#bankrollGrad)" dot={false} activeDot={{ r:4, fill:"#22c55e" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Bet history rows */}
        {filteredHistory.length === 0 ? (
          <div style={{ textAlign:"center", padding:"40px 20px", color:T.textDim }}>
            <div style={{ fontSize:32, marginBottom:12 }}>📊</div>
            <div style={{ fontSize:14, color:T.textMid }}>No bet history yet</div>
            <div style={{ fontSize:11, marginTop:6 }}>Placed bets will appear here after games complete</div>
          </div>
        ) : (
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, overflow:"hidden" }}>
            {/* Blotter header */}
            <div style={{
              display:"grid",
              gridTemplateColumns:"48px 80px 1fr 52px 70px 80px 60px 72px 80px",
              gap:8, padding:"10px 18px",
              borderBottom:`1px solid ${T.border}`,
              background:T.bg,
              fontSize:9, color:T.textDim, fontWeight:700, letterSpacing:"0.1em",
              fontFamily:"'Barlow',sans-serif",
            }}>
              <div>STATUS</div>
              <div>DATE</div>
              <div>SELECTION</div>
              <div style={{ textAlign:"center" }}>TYPE</div>
              <div style={{ textAlign:"right" }}>ODDS</div>
              <div style={{ textAlign:"right" }}>BOOK</div>
              <div style={{ textAlign:"right" }}>KELLY</div>
              <div style={{ textAlign:"right" }}>WAGERED</div>
              <div style={{ textAlign:"right" }}>P&L</div>
            </div>
            {filteredHistory.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map((h, i) => (
              <HistoryRow key={h.id || i} h={h} rowIndex={i} />
            ))}
          </div>
        )}
      </div>
    );
  };
  const renderLegacyInfoContent = () => {
    if (tab !== "Info") return null;
    const Section = ({ title, children }) => (
      <div style={{ marginBottom:28 }}>
        <div style={{ fontSize:10, fontWeight:800, color:T.blue, letterSpacing:"0.12em",
          textTransform:"uppercase", marginBottom:10, fontFamily:"'Barlow',sans-serif",
          borderBottom:`1px solid ${T.border}`, paddingBottom:6 }}>{title}</div>
        {children}
      </div>
    );
    const P = ({ children }) => (
      <div style={{ fontSize:12, color:T.textMid, lineHeight:1.75, marginBottom:8,
        fontFamily:"'Barlow',sans-serif" }}>{children}</div>
    );
    const Highlight = ({ label, value, color }) => (
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"8px 12px", background:T.surfaceHi, borderRadius:6, marginBottom:6,
        border:`1px solid ${T.border}` }}>
        <span style={{ fontSize:11, color:T.textMid, fontFamily:"'Barlow',sans-serif" }}>{label}</span>
        <span style={{ fontSize:11, fontWeight:700, color: color || T.text,
          fontFamily:"'JetBrains Mono',monospace" }}>{value}</span>
      </div>
    );
    return (
      <div style={{ maxWidth:660, margin:"0 auto", padding:"24px 20px 40px" }}>
        <div style={{ fontSize:18, fontWeight:900, color:T.text, marginBottom:4,
          fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:"-0.02em" }}>
          NBA EDGE — How It Works
        </div>
        <div style={{ fontSize:11, color:T.textDim, marginBottom:28, fontFamily:"'Barlow',sans-serif" }}>
          Engine last run: {timeAgo(data?.lastRun)} · Next: {getNextRunTime()}
        </div>

        <Section title="What Is NBA Edge?">
          <P>NBA Edge is a fully automated sports betting intelligence engine. Every few hours, it scans every NBA game on the schedule, analyzes the betting markets across multiple sportsbooks, and surfaces plays where the math says the odds are in your favor.</P>
          <P>Think of it like a stock screener — but for bets. Instead of finding undervalued stocks, it finds undervalued bets: situations where a sportsbook is offering better odds than the true probability of the outcome.</P>
        </Section>

        <Section title="Conviction Score (0–100)">
          <P>Every play gets a Conviction Score from 0–100. This is the engine's overall confidence rating, combining multiple signals:</P>
          <Highlight label="Expected Value (EV)" value="Is the bet mathematically profitable long-term?" color={T.green} />
          <Highlight label="ML Model Signal" value="What does the machine learning model predict?" color={T.blue} />
          <Highlight label="Market Consensus" value="Do multiple books agree on the line?" color={T.amber} />
          <Highlight label="Line Movement" value="Is the line moving in our favor or against us?" color={T.textMid} />
          <P>Higher score = higher confidence. A score of 85 doesn't mean the team wins 85% of the time — it means the engine is 85% confident this is a good value bet.</P>
        </Section>

        <Section title="Bet Tiers">
          <Highlight label="⚡ AUTO-BET (Score ≥ 70)" value="Strongest plays — bet these" color={T.green} />
          <Highlight label="MEDIUM (Score 55–69)" value="Solid plays — bet selectively" color={T.amber} />
          <Highlight label="WATCHLIST (Score < 55)" value="Monitor only — skip unless you have a strong read" color={T.textDim} />
          <P>The AUTO-BET threshold of 70 is where the historical edge is most consistent. Below 55, the edge shrinks enough that variance can easily wipe out your profit.</P>
        </Section>

        <Section title="Bet Types">
          <Highlight label="ML — Moneyline" value="Pick who wins the game outright" color={T.blue} />
          <Highlight label="SPR — Spread" value="Pick who covers the point spread" color={T.blue} />
          <Highlight label="TOT — Game Total" value="Pick if the combined score goes Over or Under" color={T.blue} />
          <Highlight label="PP — Player Prop" value="Pick a player stat: points, rebounds, assists, etc." color={T.blue} />
          <P>Moneylines are the simplest: team wins, you win. Spreads add a handicap (e.g., Lakers -5.5 means they must win by 6+). Totals ignore who wins and just focus on scoring. Props are independent of the game result — you're betting on a single player's performance.</P>
        </Section>

        <Section title="Expected Value (EV)">
          <P>EV is the most important number in sports betting. It tells you how much you expect to profit (or lose) on average per $100 wagered.</P>
          <Highlight label="+EV" value="The bet pays more than it should, long-term profit" color={T.green} />
          <Highlight label="-EV" value="The bet pays less than it should, long-term loss" color={T.red} />
          <P>Example: A coin flip at +100 (even money) is 0 EV — fair. But if a book offers +120 on a true 50/50, that's +EV. For every $100 you bet on plays like that, you expect to profit $10 on average over many bets. The key word is "average" — any single bet can still lose. EV only wins over volume.</P>
        </Section>

        <Section title="Kelly Criterion (Kelly %)">
          <P>Kelly % tells you how much of your bankroll to wager on each bet. It's a formula that maximizes long-term bankroll growth without over-betting.</P>
          <Highlight label="Example: Kelly 4.2%" value="Bet 4.2% of your current bankroll" color={T.amber} />
          <P>If your bankroll is $500 and Kelly says 4.2%, the optimal wager is $21. Betting more is greedier than the math supports and increases your risk of ruin. Many sharp bettors use "half Kelly" (bet half the suggested amount) to reduce volatility while still growing the bankroll.</P>
        </Section>

        <Section title="How to Use the Filters">
          <Highlight label="⚡ Auto-Bet Only" value="Show only plays with Score ≥ 70" color={T.green} />
          <Highlight label="🤖 ML Engine" value="Show only plays the ML model flagged" color={T.blue} />
          <Highlight label="📈 EV+ Only" value="Show only positive expected value plays" color={T.green} />
          <Highlight label="🎯 Cross-Confirmed" value="Show plays confirmed across multiple models" color={T.amber} />
          <P>Stack filters to narrow your focus. For the tightest edge, enable both Auto-Bet and EV+ together — these are plays where the conviction is high AND the math is positive.</P>
        </Section>

        <Section title="Sportsbook Filter">
          <P>Use the sportsbook selector in the left sidebar to show only plays available at a specific book. Different books offer different lines — the engine always shows the best available odds across all books you have access to.</P>
          <P>If you only have DraftKings, filter to DraftKings so you only see plays you can actually place. Opening accounts at 3–5 books dramatically improves your ability to find the best lines.</P>
        </Section>

        <Section title="Risk Disclaimer">
          <div style={{ padding:"12px 14px", background:`rgba(239,68,68,0.06)`,
            border:`1px solid rgba(239,68,68,0.2)`, borderRadius:8 }}>
            <div style={{ fontSize:11, color:T.red, fontWeight:700, marginBottom:6,
              fontFamily:"'Barlow',sans-serif" }}>Sports betting involves real financial risk.</div>
            <div style={{ fontSize:11, color:T.textMid, lineHeight:1.7,
              fontFamily:"'Barlow',sans-serif" }}>
              No system wins every bet. Even the best EV plays lose sometimes — that's the nature of probability.
              Only bet what you can afford to lose. Never chase losses. This tool provides analysis, not guarantees.
              Please gamble responsibly and within your local regulations.
            </div>
          </div>
        </Section>
      </div>
    );
  };

  const renderBottomNav = () => {
    const navItems = [
      { icon:"⚡", label:"Plays",    value:"All" },
      { icon:"🏀", label:"Lines",    value:"Moneyline" },
      { icon:"📊", label:"History",  value:"History" },
      { icon:"🎯", label:"Props",    value:"Props" },
      { icon:"⚙️", label:"Settings", value:"Info" },
    ];
    return navItems.map(item => (
      <button key={item.value} onClick={() => setTab(item.value)} style={{
        flex:1, display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
        gap:3, background:"transparent", border:"none", cursor:"pointer",
        color: tab === item.value ? T.blue : T.textDim,
        padding:"6px 0",
      }}>
        <span style={{ fontSize:22 }}>{item.icon}</span>
        <span style={{ fontSize:10, fontWeight:600, fontFamily:"'Barlow',sans-serif",
          letterSpacing:"0.04em",
          color: tab === item.value ? T.blue : T.textDim }}>
          {item.label}
        </span>
      </button>
    ));
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      background: T.bg, color: T.text,
      fontFamily: "'Barlow', system-ui, sans-serif",
      overflow: "hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800;900&family=Barlow+Condensed:wght@600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        html, body { height: 100%; margin: 0; }
        @keyframes scrollTicker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px currentColor; }
          50%       { opacity: 0.4; box-shadow: none; }
        }
        @keyframes livePulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34,197,94,0.6); }
          50%       { opacity: 0.8; box-shadow: 0 0 0 5px rgba(34,197,94,0); }
        }
        .ticker-track { animation: scrollTicker 36s linear infinite; display: flex; width: max-content; }
        .ticker-track:hover { animation-play-state: paused; }
        .play-row:hover { background: rgba(255,255,255,0.03) !important; transition: background 120ms; }
        @media (max-width: 640px) {
          .th-type, .td-type     { display: none !important; }
          .th-book, .td-book     { display: none !important; }
          .th-ev,   .td-ev       { display: none !important; }
          .sidebar-desktop       { display: none !important; }
          .bottom-nav            { display: flex !important; }
          .header-stats-extra    { display: none !important; }
          .header-actions-extra  { display: none !important; }
          .filter-chip-label     { display: none !important; }
          .props-meta-line       { display: none !important; }
        }
        @media (max-width: 400px) {
          .ticker-track          { animation-duration: 28s; }
        }
        @media (min-width: 641px) { .bottom-nav { display: none !important; } }
        @media (min-width: 1280px) {
          .ticker-track          { animation-duration: 44s; }
        }
        ::-webkit-scrollbar { width: 3px; height: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 2px; }
        ::selection { background: rgba(29,108,245,0.3); color: ${T.text}; }
        input::placeholder { color: #475569; }
        input:focus { border-color: #1d6cf5 !important; }
      `}</style>

      {renderHeader()}
      {renderTicker()}

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div className="sidebar-desktop" style={{
          width: 112, flexShrink: 0,
          background: T.surface, borderRight: `1px solid ${T.border}`,
          display: "flex", flexDirection: "column",
          overflowY: "auto",
        }}>
          {renderSidebar()}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {renderFilterBar()}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {renderContent()}
          </div>
        </div>
      </div>

      <nav className="bottom-nav" style={{
        background: T.surface, borderTop: `1px solid ${T.border}`,
        display: "none",
        justifyContent: "space-around", alignItems: "center",
        height: 64, flexShrink: 0,
      }}>
        {renderBottomNav()}
      </nav>
    </div>
  );
}
