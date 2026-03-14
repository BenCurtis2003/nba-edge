// pages/api/admin/unresolve-bet.js
// Resets a specific resolved bet back to pending by selection name
import { loadHistory, saveHistory } from "../../../lib/store";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  const { selection } = req.query;
  if (!selection) return res.status(400).json({ error: "Pass ?selection=Team+Name" });

  const history = await loadHistory();
  let fixed = 0;

  const updated = history.map(entry => {
    if ((entry.status === "won" || entry.status === "lost") &&
        entry.selection?.toLowerCase().includes(selection.toLowerCase())) {
      fixed++;
      const { bankrollAfter, bankrollBefore, potentialPayout, wagerAmt, ...rest } = entry;
      return { ...rest, status: "pending", result: null, estimatedResult: false };
    }
    return entry;
  });

  await saveHistory(updated);
  return res.status(200).json({ ok: true, fixed, selection });
}
