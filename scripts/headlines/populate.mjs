import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFeedback } from "./feedback.mjs";
import { Polite, USER_AGENT } from "./http.mjs";
import { attachImages } from "./images.mjs";
import { scoreItem, selectHeadlines } from "./ranking.mjs";
import { SOURCES } from "./sources.mjs";
import { formatLocalDay, formatUpdatedTime } from "../../headlines/render.js";
import { dedupeByCanonUrl, readXPicks, xPickItems } from "./x-picks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function rewriteDatelineFallbacks(html, generatedAt, ids) {
  const date = formatLocalDay(generatedAt, "UTC");
  const updated = `Updated ${formatUpdatedTime(generatedAt, "UTC")} UTC`;
  const textFor = {
    dateline: date,
    "home-dateline": date,
    "updated-local": updated,
    "home-updated": updated,
  };
  let next = String(html || "");
  for (const id of ids) {
    const text = textFor[id];
    if (!text) continue;
    const pattern = new RegExp(`(<([a-zA-Z][\\w:-]*)\\b[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(</\\2>)`);
    next = next.replace(pattern, (_match, open, _tag, close) => `${open}${text}${close}`);
  }
  return next;
}

export function writeDatelineFallbacks(file, generatedAt, ids) {
  const before = fs.readFileSync(file, "utf8");
  const after = rewriteDatelineFallbacks(before, generatedAt, ids);
  if (after !== before) fs.writeFileSync(file, after);
  return after !== before;
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
      ...(candidate.image_entity ? { image_entity: candidate.image_entity } : {}),
      ...(candidate.linked_url ? { linked_url: candidate.linked_url } : {}),
      ...(candidate.x_handle ? { x_handle: candidate.x_handle } : {}),
      ...(candidate.doi ? { doi: candidate.doi } : {}),
    };
    const key = item.dedupe_key || item.id;
    const prev = deduped.get(key);
    if (!prev || item.significance > prev.significance) deduped.set(key, item);
  }
  const selected = selectHeadlines(dedupeByCanonUrl([...deduped.values()]));
  return {
    schema: "biocat-headlines/1",
    generated_at: new Date().toISOString(),
    event_date: today,
    generator: "scripts/headlines/populate.mjs",
    user_agent: USER_AGENT,
    ranking: "scripts/headlines/ranking.mjs",
    sources,
    items: selected.map(({ drop, dedupe_key, x_handle, doi, ...item }) => item),
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
  const picks = readXPicks(path.join(root, "data", "x_picks.json"));
  candidates.push(...xPickItems(picks, candidates.map((item) => item.source_url)));
  const payload = buildHeadlines({ candidates, today, feedback, sources });
  try {
    const images = await attachImages(polite, payload.items, { cacheFile: path.join(root, "data", "image-cache.json") });
    console.log(`images: ${images.placed} commons-calls: ${images.calls} openverse-calls: ${images.openverseCalls} nasa-calls: ${images.nasaCalls}`);
  } catch (error) {
    console.error(`images: ${error instanceof Error ? error.message : error}`);
  }
  const out = path.join(root, "data", "headlines.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  writeDatelineFallbacks(path.join(root, "index.html"), payload.generated_at, ["home-dateline", "home-updated"]);
  writeDatelineFallbacks(path.join(root, "headlines", "index.html"), payload.generated_at, ["dateline", "updated-local"]);
  console.log(`wrote ${payload.items.length} items to ${path.relative(root, out)}`);
  if (!payload.items.length) process.exitCode = 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) main();
