import { USER_AGENT } from "./http.mjs";

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
  const text = String(name || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text || /(?:^|\s)NC(?:\s|-|$)|(?:^|\s)ND(?:\s|-|$)|-NC|-ND/i.test(text)) return false;
  return /^(?:public domain|cc0|cc by-sa|cc by)\b/i.test(text);
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

function commonsFile(page) {
  const info = page?.imageinfo?.[0];
  if (!info || !String(info.mime || "").startsWith("image/")) return null;
  const title = String(page.title || "");
  if (LOGO.test(title) || STOCK.test(title)) return null;
  const meta = info.extmetadata || {};
  const licence = stripTags(meta.LicenseShortName?.value || "");
  const basisUrl = stripTags(meta.LicenseUrl?.value || "");
  if (!licenceOk(licence) || !/^https:\/\//.test(basisUrl)) return null;
  const src = String(info.url || "");
  if (!src.startsWith("https://upload.wikimedia.org/")) return null;
  const width = Number(info.width || 0);
  const height = Number(info.height || 0);
  if (width < 80 || height < 80) return null;
  const artist = stripTags(meta.Artist?.value || "") || "Author not named on the file page";
  const description = stripTags(meta.ImageDescription?.value || "");
  const fileName = title.replace(/^File:/, "").replace(/\.[A-Za-z0-9]+$/, "").replace(/_/g, " ");
  const alt = (description || fileName).slice(0, 180);
  const sourcePage = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%3A/g, ":")}`;
  const displayWidth = Math.min(width, 640);
  const displayHeight = Math.max(1, Math.round(height * (displayWidth / width)));
  return {
    src,
    sourcePage,
    credit: `${artist}. ${licence}. Via Wikimedia Commons (hotlinked from upload.wikimedia.org).`,
    licence,
    basisUrl,
    alt,
    width: displayWidth,
    height: displayHeight,
    hosting: "hotlink",
  };
}

async function commonsFor(polite, token) {
  const url = new URL(COMMONS);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "6");
  url.searchParams.set("gsrsearch", `intitle:${token}`);
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|size|mime|extmetadata");
  const payload = await polite.getJson(url.href, { userAgent: USER_AGENT, timeout: 30000 });
  const pages = Object.values(payload?.query?.pages || {});
  const wanted = token.toLowerCase();
  const images = pages.map(commonsFile).filter(Boolean).filter((image) => `${image.sourcePage} ${image.alt}`.toLowerCase().includes(wanted));
  images.sort((a, b) => Number(/\.(?:png|jpe?g|webp)(?:$|\?)/i.test(b.src)) - Number(/\.(?:png|jpe?g|webp)(?:$|\?)/i.test(a.src)));
  return images[0] || null;
}

async function imageFor(polite, item) {
  if (LAB_IMAGE_TERMS[item.scout_source]) return null;
  if (item.scout_source === "mhra" || item.scout_source === "fda-press" || item.scout_source === "nih-news") {
    try {
      const buf = await polite.getBuffer(item.source_url, { timeout: 40000 });
      if (!buf) return null;
      const kind = item.scout_source === "mhra" ? "ogl" : "federal";
      return pageImage(buf.toString("utf8"), item.source_url, kind);
    } catch {
      return null;
    }
  }
  for (const token of imageTokens(item.headline)) {
    try {
      const image = await commonsFor(polite, token);
      if (image) return image;
    } catch {
      /* One Commons lookup failing should not drop the headline. */
    }
  }
  return null;
}

export async function attachImages(polite, items) {
  const list = Array.isArray(items) ? items : [];
  let others = 0;
  let placed = 0;
  for (let index = 0; index < list.length && placed < MAX_IMAGES; index++) {
    if (index > 0 && others >= MAX_OTHERS) break;
    if (index > 0 && Number(list[index].significance || 0) < 70) continue;
    const image = await imageFor(polite, list[index]);
    if (!image) continue;
    list[index].image = image;
    placed += 1;
    if (index > 0) others += 1;
  }
  return placed;
}
