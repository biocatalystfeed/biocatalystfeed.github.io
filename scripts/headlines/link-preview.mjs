import fs from "node:fs";
import path from "node:path";
import config from "./link-preview-config.json" with { type: "json" };
import { imageResponseOk, stripTags } from "./image-score.mjs";

const BAD_IMAGE = /logo|favicon|apple-touch|sprite|1x1|blank|placeholder|default-og|og-default|social-default|opengraph|social-card|site-thumb|icon-512|icon-192/i;

export function eligibleForPreview(item, cfg = config) {
  if (item?.scout_source === "x" || item?.rule === "x-pick") return true;
  const sources = new Set(cfg.aiSources || []);
  if (sources.has(item?.scout_source)) return true;
  const blob = `${item?.source_name || ""} ${item?.headline || ""}`.toLowerCase();
  return (cfg.aiNames || []).some((name) => blob.includes(String(name).toLowerCase()));
}

export function previewPage(item) {
  if (item?.scout_source === "x" || item?.rule === "x-pick") return String(item?.linked_url || "");
  return String(item?.source_url || "");
}

function attr(tag, name) {
  const quoted = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  if (quoted) return quoted[1];
  const bare = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i").exec(tag);
  return bare?.[1] || "";
}

export function metaContent(html, key) {
  const wanted = String(key).toLowerCase();
  for (const tag of String(html || "").match(/<meta\b[^>]*>/gi) || []) {
    const prop = attr(tag, "property").toLowerCase() || attr(tag, "name").toLowerCase();
    if (prop !== wanted) continue;
    return stripTags(attr(tag, "content"));
  }
  return "";
}

function absUrl(value, pageUrl) {
  if (!String(value || "").trim()) return "";
  try {
    return new URL(String(value), pageUrl).href;
  } catch {
    return "";
  }
}

export function readPreview(html, pageUrl) {
  const image = absUrl(metaContent(html, "og:image") || metaContent(html, "twitter:image"), pageUrl);
  const alt = metaContent(html, "og:image:alt") || metaContent(html, "og:title");
  return {
    image,
    alt: alt.slice(0, 180),
    width: Number(metaContent(html, "og:image:width") || 0),
    height: Number(metaContent(html, "og:image:height") || 0),
    publisher: metaContent(html, "og:site_name"),
  };
}

export function previewProblem(preview, seen = new Map()) {
  if (!preview?.image || !/^https:\/\//.test(preview.image)) return "no image url";
  if (BAD_IMAGE.test(preview.image) || BAD_IMAGE.test(preview.alt || "")) return "logo, favicon, or site default";
  if (preview.width && preview.width < 300) return "under 300px wide";
  if ((seen.get(preview.image) || 0) > 1) return "same image used across the domain";
  return "";
}

export function countImages(items, previews, { separateCap = false, max = config.maxImages || 4 } = {}) {
  let diagrams = items.filter((item) => item.image?.type === "diagram").length;
  let prev = "";
  let shared = items.filter((item) => item.image).length;
  let extra = 0;
  const chosen = [];
  for (let index = 0; index < items.length; index += 1) {
    if (items[index].image) prev = items[index].image.type || prev;
    const candidate = previews.find((row) => row.index === index);
    if (!candidate || items[index].image) continue;
    const type = candidate.image.type || "photo";
    if (type === prev) continue;
    if (type === "diagram" && diagrams >= 1) continue;
    if (separateCap) {
      if (extra >= max) continue;
    } else if (shared >= max) continue;
    chosen.push(candidate);
    prev = type;
    if (type === "diagram") diagrams += 1;
    if (separateCap) extra += 1;
    else shared += 1;
  }
  const commons = items.filter((item) => item.image).length;
  return { chosen, total: separateCap ? commons + chosen.length : commons + chosen.length };
}

export function linkPreviewImage(preview, pageUrl) {
  return {
    src: preview.image,
    sourcePage: pageUrl,
    publisher: preview.publisher,
    credit: preview.publisher,
    alt: preview.alt,
    licence: "",
    basisUrl: "",
    width: preview.width || 640,
    height: preview.height || 360,
    hosting: "hotlink",
    type: "photo",
    kind: "link-preview",
    provider: "link-preview",
    relevance: 3,
    reason: `og:image published by ${preview.publisher || "the source page"}`,
  };
}

function readCache(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).entries || {};
  } catch {
    return {};
  }
}

function writeCache(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schema: "biocat-og-url-cache/1", entries }, null, 2)}\n`);
}

export async function attachLinkPreviews(polite, items, { cacheFile, loadImage = async () => true } = {}) {
  const list = Array.isArray(items) ? items : [];
  const cache = cacheFile ? readCache(cacheFile) : {};
  const found = [];
  const rejected = [];
  const seen = new Map();
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (!eligibleForPreview(item)) continue;
    const pageUrl = previewPage(item);
    if (!pageUrl) continue;
    let preview = null;
    const cached = cache[item.id];
    try {
      const buf = await polite.getBuffer(pageUrl, { timeout: 30000 });
      if (!buf) {
        rejected.push({ index, headline: item.headline, why: "robots.txt disallows the page, or the page did not load" });
        continue;
      }
      preview = readPreview(buf.toString("utf8"), pageUrl);
    } catch (error) {
      rejected.push({ index, headline: item.headline, why: error instanceof Error ? error.message : "page fetch failed" });
      continue;
    }
    if (cached?.url && preview.image && cached.url !== preview.image) {
      // The page published a new card. Keep the URL the page publishes now.
    }
    if (preview.image) seen.set(preview.image, (seen.get(preview.image) || 0) + 1);
    const why = previewProblem(preview, seen);
    if (why) {
      rejected.push({ index, headline: item.headline, url: preview.image, why });
      continue;
    }
    if (!(await loadImage(preview.image))) {
      rejected.push({ index, headline: item.headline, url: preview.image, why: "image URL did not return an image" });
      continue;
    }
    let host = "";
    try { host = new URL(pageUrl).hostname.replace(/^www\./, ""); } catch { host = ""; }
    const named = (config.aiNames || []).find((name) => `${item.headline} ${item.source_name}`.includes(name));
    const site = preview.publisher && !/^(x|twitter)$/i.test(preview.publisher) ? preview.publisher : "";
    const publisher = named || site || host || item.source_name || "Source";
    cache[item.id] = { url: preview.image, at: new Date().toISOString() };
    found.push({
      index,
      headline: item.headline,
      publisher,
      url: preview.image,
      why: `og:image published by ${publisher}`,
      image: linkPreviewImage({ ...preview, publisher }, pageUrl),
    });
  }
  const again = [];
  for (const row of found) {
    const why = previewProblem({ image: row.url, alt: row.image.alt, width: row.image.width }, seen);
    if (why) rejected.push({ index: row.index, headline: row.headline, url: row.url, why });
    else again.push(row);
  }
  const shared = countImages(list, again, { separateCap: false });
  const split = countImages(list, again, { separateCap: true });
  for (const row of shared.chosen) list[row.index].image = row.image;
  if (cacheFile) writeCache(cacheFile, cache);
  return {
    kept: again,
    placed: shared.chosen,
    rejected,
    separateCapTotal: split.total,
    defaultTotal: list.filter((item) => item.image).length,
  };
}
