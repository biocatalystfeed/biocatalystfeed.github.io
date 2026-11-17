import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFeedback } from "./feedback.mjs";
import { Polite, USER_AGENT } from "./http.mjs";
import { attachImages } from "./images.mjs";
import { scoreItem, selectHeadlines } from "./ranking.mjs";
import { SOURCES } from "./sources.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readXPicks(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, "data", "x_picks.json"), "utf8"));
    return data && typeof data === "object" ? data : { enabled: false, picks: [] };
  } catch {
    return { enabled: false, picks: [] };
  }
}

function applyXPicks(payload, picks) {
  if (!picks?.enabled) return;
  for (const pick of picks.picks || []) {
    const url = String(pick.url || "");
    const handle = String(pick.handle || "").replace(/^@/, "");
    const date = String(pick.date || "");
    const headline = String(pick.headline || "").trim();
    const blurb = String(pick.blurb || "").trim();
    if (!/^https:\/\/(?:x|twitter)\.com\//.test(url) || !handle || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !headline || !blurb) continue;
    payload.items.push({
      id: `x-pick:${url}`,
      headline,
      blurb,
      source_url: url,
      source_type: "news",
      source_name: `@${handle} on X`,
      published_at: date,
      significance: 40,
      significance_rationale: "Curated X pick. The post text is not copied. See docs/headlines-x.md.",
      tier: 1,
      scout_source: "x-picks",
    });
  }
}

export function buildHeadlines({ candidates, today, feedback, sources }) {
  const deduped = new Map();
  for (const candidate of candidates) {
    const scored = scoreItem(candidate, today, feedback);
    const item = {
      id: candidate.id,
      headline: candidate.headline,
      blurb: candidate.blurb,
      source_url: candidate.source_url,
      source_type: candidate.source_type,
      source_name: candidate.source_name,
      published_at: candidate.published_at,
      significance: scored.significance,
      significance_rationale: scored.significance_rationale,
      tier: scored.tier,
      scout_source: candidate.scout_source,
      drop: scored.drop,
      dedupe_key: candidate.dedupe_key,
    };
    const key = item.dedupe_key || item.id;
    const prev = deduped.get(key);
    if (!prev || item.significance > prev.significance) deduped.set(key, item);
  }
  const selected = selectHeadlines([...deduped.values()]);
  return {
    schema: "biocat-headlines/1",
    generated_at: new Date().toISOString(),
    event_date: today,
    generator: "scripts/headlines/populate.mjs",
    user_agent: USER_AGENT,
    ranking: "scripts/headlines/ranking.mjs",
    sources,
    items: selected.map(({ drop, dedupe_key, ...item }) => item),
  };
}

async function main() {
  const today = process.env.HEADLINES_TODAY || new Date().toISOString().slice(0, 10);
  const cacheDir = process.env.HEADLINES_CACHE_DIR || path.join("/tmp", "biocat-headlines-cache");
  const polite = new Polite({ cacheDir });
  const feedback = loadFeedback(path.join(root, "data", "feedback"));
  const candidates = [];
  const sources = [];
  for (const source of SOURCES) {
    if (!source.enabled) {
      sources.push({ id: source.id, enabled: false, status: "disabled", fetched: 0, note: source.reason });
      continue;
    }
    try {
      const result = await source.fetch({ polite, today, root, cacheDir });
      const items = result.items || [];
      candidates.push(...items);
      sources.push({
        id: source.id,
        enabled: true,
        status: "ok",
        fetched: items.length,
        note: result.note || "",
      });
      console.log(`${source.id}: ${items.length}`);
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error);
      sources.push({ id: source.id, enabled: true, status: "error", fetched: 0, note: note.slice(0, 400) });
      console.error(`${source.id}: ${note}`);
    }
  }
  const payload = buildHeadlines({ candidates, today, feedback, sources });
  try {
    const placed = await attachImages(polite, payload.items);
    console.log(`images: ${placed}`);
  } catch (error) {
    console.error(`images: ${error instanceof Error ? error.message : error}`);
  }
  applyXPicks(payload, readXPicks(root));
  const out = path.join(root, "data", "headlines.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`wrote ${payload.items.length} items to ${path.relative(root, out)}`);
  if (!payload.items.length) process.exitCode = 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
