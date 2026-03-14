// pages/api/admin/patch-bet.js
// Manually patch fields on a specific history entry by selection name
import { getHistory, saveHistory } from "../../../lib/store";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  // POST body: { selection, fields: { wagerAmt, potentialPayout, ... } }
  const { selection, fields } = req.body || {};
  if (!selection || !fields)
    return res.status(400).json({ error: "Pass { selection, fields } in POST body" });

  const history = await getHistory();
  let patched = 0;

  const updated = history.map(entry => {
    if (entry.selection?.toLowerCase().includes(selection.toLowerCase())) {
      patched++;
      return { ...entry, ...fields };
    }
    return entry;
  });

  await saveHistory(updated);
  return res.status(200).json({ ok: true, patched, selection, fields });
}
