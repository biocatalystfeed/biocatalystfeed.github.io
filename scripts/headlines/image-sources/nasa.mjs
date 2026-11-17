import { commonsUserAgent, imageType, personRisk, relevanceScore, stripTags } from "../image-score.mjs";
import { sourceAllowed } from "./terms.mjs";

const ENDPOINT = "https://images-api.nasa.gov/search";
const MAX_CALLS = 5;
const SKIP = /\b(logo|logos|insignia|patch|seal|wordmark|flag|astronaut|crew|portrait|people|person|courtesy|copyright|©|all rights reserved)\b/i;

function preview(item) {
  const links = item?.links || [];
  const small = links.find((link) => /~small\.jpe?g$/i.test(link.href || ""));
  const thumb = links.find((link) => /~thumb\.jpe?g$/i.test(link.href || ""));
  const chosen = small || thumb;
  if (!chosen?.href?.startsWith("https://")) return null;
  return chosen;
}

export function nasaImage(item, entities) {
  const data = item?.data?.[0];
  if (!data || data.media_type !== "image") return null;
  const title = stripTags(data.title || "");
  const description = stripTags(data.description || data.description_508 || "");
  const keywords = (data.keywords || []).join(" ");
  const hay = `${title} ${description} ${keywords}`;
  if (!title || SKIP.test(hay) || personRisk(hay)) return null;
  const link = preview(item);
  if (!link) return null;
  const creator = stripTags(data.photographer || data.secondary_creator || "NASA");
  if (!creator || /unknown|unspecified/i.test(creator)) return null;
  const nasaId = String(data.nasa_id || "");
  if (!nasaId) return null;
  return {
    src: link.href,
    sourcePage: `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`,
    credit: creator,
    licence: "Public domain (U.S. government work)",
    basisUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    alt: (description || title).slice(0, 180),
    width: Number(link.width || 0) || 640,
    height: Number(link.height || 0) || 360,
    hosting: "hotlink",
    type: imageType(hay),
    relevance: relevanceScore(entities, hay),
    provider: "nasa",
  };
}

export function createNasaClient() {
  let calls = 0;
  return {
    get calls() { return calls; },
    async search(term, entities) {
      if (!sourceAllowed("nasa") || calls >= MAX_CALLS || !term) return [];
      const url = new URL(ENDPOINT);
      url.searchParams.set("q", term);
      url.searchParams.set("media_type", "image");
      calls += 1;
      const response = await fetch(url, {
        headers: { "User-Agent": commonsUserAgent(), Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return (payload?.collection?.items || []).slice(0, 8).map((row) => nasaImage(row, entities)).filter(Boolean);
    },
  };
}
