import fs from "node:fs";
import path from "node:path";

const VOTES = new Set(["up", "down"]);
const SIZES = new Set(["bigger", "smaller", "dropped"]);

export function loadFeedback(dir) {
  const map = new Map();
  if (!dir || !fs.existsSync(dir)) return map;
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const rows = [];
  for (const name of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (!data || data.sample === true) continue;
    const exported = typeof data.exported_at === "string" ? data.exported_at : "1970-01-01T00:00:00Z";
    for (const item of data.items || []) {
      if (!item || typeof item.id !== "string" || !item.id) continue;
      rows.push({ exported, item });
    }
  }
  rows.sort((a, b) => (a.exported < b.exported ? -1 : a.exported > b.exported ? 1 : 0));
  for (const row of rows) {
    map.set(row.item.id, {
      vote: VOTES.has(row.item.vote) ? row.item.vote : null,
      size: SIZES.has(row.item.size) ? row.item.size : null,
      note: typeof row.item.note === "string" ? row.item.note : "",
      exported_at: row.exported,
    });
  }
  return map;
}
