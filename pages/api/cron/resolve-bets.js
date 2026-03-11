import { fetchScores, resolveHistory } from "../../../lib/engine";
import { getHistory, saveHistory, saveBankroll, updateMLAfterResolution, saveStandings } from "../../../lib/store";

export default async function handler(req, res) {
  if(process.env.NODE_ENV === "production" && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  try {
    const [history, scores] = await Promise.all([getHistory(), fetchScores(process.env.ODDS_API_KEY)]);
    await refreshStandings(saveStandings);
    const pending = history.filter(h => h.status === "pending");
    if(!pending.length) return res.status(200).json({ ok:true, resolved:0 });

    const { history: updated, bankroll, changed } = resolveHistory(history, scores||[]);
    if(!changed) return res.status(200).json({ ok:true, resolved:0 });

    const prevIds = new Set(pending.map(h => h.id));
    const newlyResolved = updated.filter(h => prevIds.has(h.id) && h.status !== "pending");

    await Promise.all([saveHistory(updated), saveBankroll(bankroll)]);
    if(newlyResolved.length) await updateMLAfterResolution(newlyResolved);

    const wins = newlyResolved.filter(b => b.status==="won").length;
    const losses = newlyResolved.filter(b => b.status==="lost").length;
    console.log(`[Resolve] ${newlyResolved.length} resolved (${wins}W/${losses}L) · $${bankroll.toFixed(2)}`);
    return res.status(200).json({ ok:true, resolved:newlyResolved.length, wins, losses, bankroll });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

async function refreshStandings(saveStandings) {
  try {
    const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams", { cache:"no-store" });
    if(!res.ok) return;
    const data = await res.json();
    const standings = {};
    for(const t of (data.sports?.[0]?.leagues?.[0]?.teams||[])) {
      const name = t.team.displayName;
      const [w,l] = (t.team.record?.items?.[0]?.summary||"0-0").split("-").map(Number);
      standings[name] = { wins:w||0, losses:l||0 };
    }
    await saveStandings(standings);
    console.log(`[Standings] Refreshed ${Object.keys(standings).length} teams`);
  } catch(e) { console.warn("[Standings] failed:", e.message); }
}
