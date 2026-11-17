import fs from "node:fs";
import path from "node:path";

const MAX_IMAGES = 4;
const MAX_OTHERS = 3;
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

export function licenceOk(name) {
  const text = stripTags(name);
  if (!text || /non-?free|fair use|unknown/i.test(text)) return false;
  if (/-NC\b|-ND\b|\bNC\b|\bND\b/i.test(text)) return false;
  return /^(?:public domain|pd-[\w.]+|cc0|cc by-sa|cc by)\b/i.test(text);
}

export function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

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

export function commonsUserAgent() {
  return `BioCatHeadlinesBot/1.0 (https://biocat.ai/; contact@biocat.ai) node/${process.versions.node}`;
}

export function exactName(text, name) {
  const escaped = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:[^A-Za-z0-9]|$)`, "i").test(String(text || ""));
}

export function uploadThumb(originalUrl, width = THUMB) {
  const clean = String(originalUrl || "").split("?")[0];
  const match = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(.+\/)([^/]+)$/.exec(clean);
  if (!match) return "";
  const file = match[2];
  const suffix = /\.svg$/i.test(file) ? ".png" : "";
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${match[1]}${file}/${width}px-${file}${suffix}`;
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
    credit: artist,
    licence,
    basisUrl,
    alt: `Chemical structure of ${entityName}`,
    width,
    height,
    hosting: "hotlink",
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

async function structureFor(client, cache, name) {
  const key = `inn:${name.toLowerCase()}`;
  if (cache[key]) return cache[key].image || null;
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

async function imageFor(polite, item, client, cache) {
  const entity = item.image_entity;
  if (entity?.kind === "inn" && entity.name) {
    try {
      return await structureFor(client, cache, entity.name);
    } catch {
      return null;
    }
  }
  if (item.scout_source === "mhra" || item.scout_source === "fda-press" || item.scout_source === "nih-news") {
    try {
      const buf = await polite.getBuffer(item.source_url, { timeout: 40000 });
      if (!buf) return null;
      return pageImage(buf.toString("utf8"), item.source_url, item.scout_source === "mhra" ? "ogl" : "federal");
    } catch {
      return null;
    }
  }
  return null;
}

export async function attachImages(polite, items, { cacheFile } = {}) {
  const list = Array.isArray(items) ? items : [];
  const cache = cacheFile ? readImageCache(cacheFile) : {};
  const client = createCommonsClient();
  const used = new Set();
  let others = 0;
  let placed = 0;
  for (let index = 0; index < list.length && placed < MAX_IMAGES; index++) {
    if (index > 0 && others >= MAX_OTHERS) break;
    if (index > 0 && Number(list[index].significance || 0) < 70) continue;
    const image = await imageFor(polite, list[index], client, cache);
    delete list[index].image_entity;
    if (!image || used.has(image.src)) continue;
    used.add(image.src);
    list[index].image = image;
    placed += 1;
    if (index > 0) others += 1;
  }
  for (const item of list) delete item.image_entity;
  if (cacheFile) writeImageCache(cacheFile, cache);
  return { placed, calls: client.calls };
}
