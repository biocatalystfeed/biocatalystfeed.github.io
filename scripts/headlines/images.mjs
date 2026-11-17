import fs from "node:fs";
import path from "node:path";
import { createNasaClient } from "./image-sources/nasa.mjs";
import { createOpenverseClient } from "./image-sources/openverse.mjs";
import { IMAGE_SOURCES } from "./image-sources/terms.mjs";
import {
  MAX_PAGE_IMAGES,
  TOP_IMAGE_ITEMS,
  candidateProblem,
  commonsUserAgent,
  exactName,
  imageEntities,
  imageType,
  licenceOk,
  personRisk,
  photoQuery,
  placeImages,
  relevanceScore,
  stripTags,
} from "./image-score.mjs";

export {
  MAX_PAGE_IMAGES,
  TOP_IMAGE_ITEMS,
  candidateProblem,
  commonsUserAgent,
  exactName,
  imageEntities,
  imageType,
  licenceOk,
  personRisk,
  photoQuery,
  placeImages,
  relevanceScore,
  stripTags,
};

const COMMONS = "https://commons.wikimedia.org/w/api.php";
const OGL_URL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
const STOCK = /istock|getty|shutterstock|reuters|\bap photo\b|associated press|adobe stock|dreamstime|alamy|depositphotos/i;
const LOGO = /\b(logo|wordmark|icon|favicon|social-graphic|us_flag|seal|sprite)\b/i;
const SKIP_TOKEN = new Set(["europe", "phase", "study", "trial", "fda", "nih", "purple", "orange", "book", "health", "canada", "approved", "approval", "treatment", "cancer", "disease", "adults", "primary", "completion", "reaches", "grants", "accelerated", "biologics", "deutschland", "fortvita", "therapeutics", "pharmaceutical", "pharmaceuticals", "holdings", "systems", "devices", "panel", "microbiology", "advisory", "meeting", "provides", "clarity", "support", "development", "quality", "research", "summary", "adolescents", "obesity", "overweight", "weekly", "once", "china", "weight", "loss"]);

export const LAB_IMAGE_TERMS = {
  "deepmind": {
    allowed: false,
    basisUrl: "https://blog.google/image-library/",
    why: "Google's image library allows reuse only of the pictures on that page, with a Source: Google credit. A DeepMind blog og:image is not on that page, so it is not covered.",
  },
  "openai-news": {
    allowed: false,
    basisUrl: "https://openai.com/policies/terms-of-use",
    why: "OpenAI's terms do not grant reuse of news-post images.",
  },
  "nvidia-blog": {
    allowed: false,
    basisUrl: "https://www.nvidia.com/en-us/about-nvidia/terms-of-service/",
    why: "NVIDIA's site terms prohibit public display of site materials unless a separate licence says otherwise. The blog posts do not carry one.",
  },
};

export function imageTokens(headline) {
  const paren = [...String(headline || "").matchAll(/\(([A-Za-z][A-Za-z0-9-]{4,})\)/g)].map((match) => match[1]);
  const words = String(headline || "").match(/\b[A-Z][A-Za-z0-9-]{4,}\b/g) || [];
  const out = [];
  for (const token of [...paren, ...words]) {
    const key = token.toLowerCase();
    if (SKIP_TOKEN.has(key) || out.some((item) => item.toLowerCase() === key)) continue;
    out.push(token);
  }
  return out.slice(0, 2);
}

function absUrl(src, pageUrl) {
  try {
    return new URL(src, pageUrl).href;
  } catch {
    return "";
  }
}

function imgAttrs(tag) {
  const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1] || "";
  const alt = /\balt=["']([^"']*)["']/i.exec(tag)?.[1] || "";
  const width = Number(/\bwidth=["']?(\d+)/i.exec(tag)?.[1] || 0);
  const height = Number(/\bheight=["']?(\d+)/i.exec(tag)?.[1] || 0);
  return { src, alt, width, height };
}

export function pageImage(html, pageUrl, kind) {
  const text = String(html || "");
  if (kind === "ogl" && !/Open Government Licence/i.test(text)) return null;
  const figures = [...text.matchAll(/<img\b[^>]*>/gi)].map((match) => imgAttrs(match[0]));
  for (const image of figures) {
    const src = absUrl(image.src, pageUrl);
    const blob = `${src} ${image.alt}`;
    if (!src || !image.alt || LOGO.test(blob) || STOCK.test(blob) || /\/themes\/|pixel|1x1|spacer|placeholder/i.test(src)) continue;
    if (!/\.(?:jpe?g|png|webp|gif)(?:$|\?)/i.test(src)) continue;
    if (kind === "ogl") {
      return {
        src,
        sourcePage: pageUrl,
        credit: "Contains public sector information licensed under the Open Government Licence v3.0.",
        licence: "Open Government Licence v3.0",
        basisUrl: OGL_URL,
        alt: image.alt,
        width: image.width || 640,
        height: image.height || 360,
        hosting: "hotlink",
      };
    }
    const window = text.slice(Math.max(0, text.indexOf(image.src) - 200), text.indexOf(image.src) + 500);
    const government = /public domain|U\.?S\.? government work|image credit:\s*(?:the )?(?:FDA|NIH|CDC|HHS)\b/i.test(window);
    const thirdParty = /courtesy of|photo by|getty|istock|shutterstock|associated press|reuters/i.test(window);
    if (!government || thirdParty) continue;
    return {
      src,
      sourcePage: pageUrl,
      credit: "U.S. government work, public domain.",
      licence: "Public domain (U.S. government work)",
      basisUrl: "https://www.usa.gov/government-works",
      alt: image.alt,
      width: image.width || 640,
      height: image.height || 360,
      hosting: "hotlink",
    };
  }
  return null;
}

const THUMB = 400;
const MAX_CALLS = 20;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PORTRAIT = /\b(logos?|portraits?|people|persons?|flags?|icons?|wordmarks?|coat of arms)\b/i;
const STRUCTURE = /\b(structure|structural|formula|skeletal|ball|molecule|chemical)\b/i;

export function uploadThumb(originalUrl, width = THUMB) {
  const clean = String(originalUrl || "").split("?")[0];
  const match = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(.+\/)([^/]+)$/.exec(clean);
  if (!match) return "";
  const file = match[2];
  const suffix = /\.svg$/i.test(file) ? ".png" : "";
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${match[1]}${file}/${width}px-${file}${suffix}`;
}

function shortCredit(value) {
  const text = stripTags(value).split(/\b(?:Author info|Consent note|Reusing images)\b/i)[0].trim().replace(/[,\s]+$/, "");
  return text.slice(0, 120);
}

function licenceLink(licence, rawUrl) {
  let basisUrl = stripTags(rawUrl || "");
  if (basisUrl.startsWith("http://")) basisUrl = `https://${basisUrl.slice("http://".length)}`;
  if (/^https:\/\//.test(basisUrl)) return basisUrl;
  if (/^cc0\b/i.test(licence)) return "https://creativecommons.org/publicdomain/zero/1.0/";
  if (/^(?:public domain|pd-)/i.test(licence)) return "https://creativecommons.org/publicdomain/mark/1.0/";
  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function commonsImage(page, entityName) {
  const info = page?.imageinfo?.[0];
  if (!info || !String(info.mime || "").startsWith("image/")) return null;
  const title = String(page.title || "");
  const categories = (page.categories || []).map((row) => row.title || "").join(" ");
  const hay = `${title} ${categories}`;
  if (!exactName(title, entityName) && !exactName(categories, entityName)) return null;
  if (LOGO.test(hay) || PORTRAIT.test(hay) || STOCK.test(hay)) return null;
  const meta = info.extmetadata || {};
  const licence = stripTags(meta.LicenseShortName?.value || meta.License?.value || meta.UsageTerms?.value || "");
  const basisUrl = licenceLink(licence, meta.LicenseUrl?.value || "");
  const artist = stripTags(meta.Artist?.value || meta.Credit?.value || "");
  if (!licenceOk(licence) || !/^https:\/\//.test(basisUrl)) return null;
  if (!artist || /unknown|unspecified|anonymous/i.test(artist)) return null;
  const description = stripTags(meta.ImageDescription?.value || "");
  if (!STRUCTURE.test(`${title} ${description} ${categories}`)) return null;
  const fromApi = String(info.thumburl || "").split("?")[0].replace(/^https:\/\/thumb\.wikimedia\.org\//, "https://upload.wikimedia.org/");
  const src = fromApi.startsWith("https://upload.wikimedia.org/wikipedia/commons/thumb/") ? fromApi : uploadThumb(info.url, 500);
  if (!src.startsWith("https://upload.wikimedia.org/")) return null;
  const fullW = Number(info.width || 0);
  const fullH = Number(info.height || 0);
  const namedWidth = Number(/\/(\d+)px-/.exec(src)?.[1] || 0);
  const width = namedWidth || Number(info.thumbwidth || 0) || THUMB;
  const height = info.thumbwidth && info.thumbheight
    ? Math.max(1, Math.round(Number(info.thumbheight) * (width / Number(info.thumbwidth))))
    : (fullW ? Math.max(1, Math.round(fullH * (width / fullW))) : 0);
  if (width < 40 || height < 40) return null;
  const sourcePage = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%3A/g, ":")}`;
  return {
    src,
    sourcePage,
    credit: shortCredit(artist),
    licence,
    basisUrl,
    alt: `Chemical structure of ${entityName}`,
    width,
    height,
    hosting: "hotlink",
    type: "diagram",
    relevance: 2,
    provider: "commons",
  };
}

export function readImageCache(file, now = Date.now()) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const entries = {};
    for (const [key, row] of Object.entries(data.entries || {})) {
      if (!row?.at || now - Date.parse(row.at) > CACHE_TTL_MS) continue;
      entries[key] = row;
    }
    return entries;
  } catch {
    return {};
  }
}

export function writeImageCache(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = { schema: "biocat-image-cache/1", entries };
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
}

export function createCommonsClient() {
  let calls = 0;
  return {
    get calls() { return calls; },
    async get(params) {
      if (calls >= MAX_CALLS) return null;
      const url = new URL(COMMONS);
      url.searchParams.set("action", "query");
      url.searchParams.set("format", "json");
      url.searchParams.set("maxlag", "5");
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      for (let attempt = 0; attempt < 3; attempt++) {
        if (calls >= MAX_CALLS) return null;
        calls += 1;
        const response = await fetch(url, {
          headers: {
            "User-Agent": commonsUserAgent(),
            "Accept-Encoding": "gzip",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(30000),
        });
        if (response.status === 429 || response.status >= 500) {
          const retry = Number(response.headers.get("retry-after"));
          if (attempt < 2) {
            await sleep((Number.isFinite(retry) ? Math.min(retry, 30) : 2 * (attempt + 1)) * 1000);
            continue;
          }
          return null;
        }
        const payload = await response.json();
        if (payload?.error?.code === "maxlag") {
          const lag = Number(String(payload.error.info || "").match(/[\d.]+/)?.[0] || payload.error.lag || 5);
          if (attempt < 2) {
            await sleep(Math.min(Number.isFinite(lag) ? lag : 5, 30) * 1000);
            continue;
          }
          return null;
        }
        return payload;
      }
      return null;
    },
  };
}

export function commonsTopicImage(page, entities) {
  const info = page?.imageinfo?.[0];
  if (!info || !String(info.mime || "").startsWith("image/")) return null;
  const title = String(page.title || "");
  const categories = (page.categories || []).map((row) => row.title || "").join(" ");
  const meta = info.extmetadata || {};
  const description = stripTags(meta.ImageDescription?.value || "");
  const hay = `${title} ${categories} ${description}`;
  if (LOGO.test(hay) || STOCK.test(hay) || personRisk(hay)) return null;
  const licence = stripTags(meta.LicenseShortName?.value || meta.License?.value || meta.UsageTerms?.value || "");
  const basisUrl = licenceLink(licence, meta.LicenseUrl?.value || "");
  const artist = stripTags(meta.Artist?.value || meta.Credit?.value || "");
  if (!licenceOk(licence) || !/^https:\/\//.test(basisUrl)) return null;
  if (!artist || /unknown|unspecified|anonymous/i.test(artist)) return null;
  const fromApi = String(info.thumburl || "").split("?")[0].replace(/^https:\/\/thumb\.wikimedia\.org\//, "https://upload.wikimedia.org/");
  const src = fromApi.startsWith("https://upload.wikimedia.org/wikipedia/commons/thumb/") ? fromApi : uploadThumb(info.url, 500);
  if (!src.startsWith("https://upload.wikimedia.org/")) return null;
  const fullW = Number(info.width || 0);
  const fullH = Number(info.height || 0);
  const namedWidth = Number(/\/(\d+)px-/.exec(src)?.[1] || 0);
  const width = namedWidth || Number(info.thumbwidth || 0) || THUMB;
  const height = info.thumbwidth && info.thumbheight
    ? Math.max(1, Math.round(Number(info.thumbheight) * (width / Number(info.thumbwidth))))
    : (fullW ? Math.max(1, Math.round(fullH * (width / fullW))) : 0);
  if (width < 40 || height < 40) return null;
  const alt = (description || title.replace(/^File:/, "").replace(/_/g, " ")).slice(0, 180);
  if (!alt) return null;
  const sourcePage = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%3A/g, ":")}`;
  return {
    src,
    sourcePage,
    credit: shortCredit(artist),
    licence,
    basisUrl,
    alt,
    width,
    height,
    hosting: "hotlink",
    type: imageType(hay),
    relevance: relevanceScore(entities, hay),
    provider: "commons",
  };
}

async function cachedList(cache, key, load) {
  if (cache[key] && Array.isArray(cache[key].images)) return cache[key].images;
  const images = await load();
  if (!images) return [];
  cache[key] = { at: new Date().toISOString(), images };
  return images;
}

async function commonsPhotoSearch(client, query, entities) {
  const payload = await client.get({
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: "8",
    gsrsearch: `${query} filetype:bitmap`,
    prop: "imageinfo|categories",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "640",
    cllimit: "20",
  });
  if (!payload) return null;
  return Object.values(payload?.query?.pages || {}).map((page) => commonsTopicImage(page, entities)).filter(Boolean);
}

async function structureFor(client, cache, name) {
  const key = `inn:${name.toLowerCase()}`;
  if (cache[key]) {
    const image = cache[key].image;
    if (!image) return null;
    return { ...image, type: image.type || "diagram", relevance: image.relevance || 2, provider: image.provider || "commons" };
  }
  const payload = await client.get({
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: "5",
    gsrsearch: `intitle:${name}`,
    prop: "imageinfo|categories",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(THUMB),
    cllimit: "30",
  });
  const pages = Object.values(payload?.query?.pages || {});
  const images = pages.map((page) => commonsImage(page, name)).filter(Boolean);
  const image = images[0] || null;
  cache[key] = { at: new Date().toISOString(), image };
  return image;
}

async function pagePhoto(polite, item) {
  if (!["mhra", "fda-press", "nih-news"].includes(item.scout_source)) return null;
  try {
    const buf = await polite.getBuffer(item.source_url, { timeout: 40000 });
    if (!buf) return null;
    const image = pageImage(buf.toString("utf8"), item.source_url, item.scout_source === "mhra" ? "ogl" : "federal");
    if (!image) return null;
    return { ...image, type: "photo", relevance: 2, provider: item.scout_source };
  } catch {
    return null;
  }
}

export async function attachImages(polite, items, { cacheFile, reportFile } = {}) {
  const list = Array.isArray(items) ? items : [];
  const cache = cacheFile ? readImageCache(cacheFile) : {};
  const client = createCommonsClient();
  const openverse = createOpenverseClient();
  const nasa = createNasaClient();
  const slots = [];
  const report = [];
  for (let index = 0; index < Math.min(list.length, TOP_IMAGE_ITEMS); index += 1) {
    const item = list[index];
    const entities = imageEntities(item);
    const query = photoQuery(entities);
    const candidates = [];
    if (query) {
      candidates.push(...await cachedList(cache, `commons-photo:${query.toLowerCase()}`, () => commonsPhotoSearch(client, query, entities)));
      candidates.push(...await cachedList(cache, `openverse:${query.toLowerCase()}`, () => openverse.search(query, entities)));
      candidates.push(...await cachedList(cache, `nasa:${query.toLowerCase()}`, () => nasa.search(query, entities)));
    }
    if (item.image_entity?.kind === "inn" && item.image_entity.name) {
      try {
        const diagram = await structureFor(client, cache, item.image_entity.name);
        if (diagram) candidates.push(diagram);
      } catch {
        // A failed structure lookup leaves the photo candidates in place.
      }
    }
    const owned = polite ? await pagePhoto(polite, item) : null;
    if (owned) candidates.push(owned);
    for (const candidate of candidates) {
      const fromAlt = String(candidate.alt || "").startsWith("Chemical structure") ? "diagram" : imageType(candidate.alt);
      if (fromAlt !== "photo") candidate.type = fromAlt;
      else if (!candidate.type) candidate.type = "photo";
      const file = `${candidate.sourcePage || ""} ${candidate.src || ""}`;
      if (/smart-servier|servier medical art/i.test(file)) candidate.type = "illustration";
      if (/\b(?:chart|graph|plot|deaths)\b/i.test(file)) candidate.type = "diagram";
      const blob = `${candidate.alt || ""} ${candidate.credit || ""} ${candidate.sourcePage || ""}`;
      if (entities.some((entity) => /^bayer$/i.test(entity.term)) && /\bbayer\s+(?:filter|pattern|mosaic|matrix|sensor)\b/i.test(blob)) {
        candidate.relevance = 0;
      }
      if (/\b(handball|football|soccer|basketball|stadium|bayarena|bundesliga|championship|goalkeeper|fifa|uefa)\b/i.test(blob)) {
        candidate.relevance = 0;
      }
      if (candidate.provider === "nasa" && !entities.some((entity) => exactName(`${candidate.alt || ""} ${candidate.credit || ""}`, entity.term))) {
        candidate.relevance = 0;
      }
    }
    const rejected = candidates
      .map((candidate) => ({ candidate, why: candidateProblem(candidate) }))
      .filter((row) => row.why)
      .slice(0, 8)
      .map((row) => ({
        provider: row.candidate.provider || "",
        title: row.candidate.alt,
        score: row.candidate.relevance || 0,
        type: row.candidate.type || "",
        why: row.why,
      }));
    slots.push({ index, candidates });
    report.push({
      index,
      id: item.id,
      headline: item.headline,
      entities,
      query,
      rejected,
    });
    delete item.image_entity;
  }
  for (const item of list) delete item.image_entity;
  const chosen = placeImages(slots);
  for (const item of list) delete item.image;
  let previousType = "";
  for (const slot of slots) {
    const entry = report.find((item) => item.index === slot.index);
    const pick = chosen.find((row) => row.index === slot.index);
    if (pick) {
      previousType = pick.image.type || "";
      continue;
    }
    const passed = slot.candidates.filter((candidate) => !candidateProblem(candidate));
    if (previousType && passed.length && passed.every((candidate) => candidate.type === previousType)) {
      entry.skipped = `${passed.length} matches cleared the threshold but they are all ${previousType}s, and the previous image is a ${previousType}.`;
    }
  }
  for (const row of chosen) {
    list[row.index].image = row.image;
    const entry = report.find((item) => item.index === row.index);
    if (!entry) continue;
    entry.chosen = {
      provider: row.image.provider,
      type: row.image.type,
      relevance: row.image.relevance,
      licence: row.image.licence,
      credit: row.image.credit,
      sourcePage: row.image.sourcePage,
      alt: row.image.alt,
    };
  }
  if (cacheFile) writeImageCache(cacheFile, cache);
  const body = { schema: "biocat-image-dry-run/1", sources: IMAGE_SOURCES, items: report };
  const reportPath = reportFile || (cacheFile ? path.join(path.dirname(cacheFile), "image-dry-run.json") : "");
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(body, null, 2)}\n`);
  }
  return { placed: chosen.length, calls: client.calls, openverseCalls: openverse.calls, nasaCalls: nasa.calls };
}
