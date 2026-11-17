import { commonsUserAgent, exactName, imageType, licenceOk, personRisk, relevanceScore, stripTags } from "../image-score.mjs";
import { sourceAllowed } from "./terms.mjs";

const ENDPOINT = "https://api.openverse.org/v1/images/";
const MAX_CALLS = 5;

const LICENCE = {
  cc0: { name: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  by: { name: "CC BY", url: "https://creativecommons.org/licenses/by/4.0/" },
};

function directImage(url) {
  const clean = String(url || "");
  if (!clean.startsWith("https://")) return false;
  if (/api\.openverse\.org/i.test(clean)) return false;
  return /\.(?:jpe?g|png|webp|gif)(?:$|\?)/i.test(clean) || /live\.staticflickr\.com|upload\.wikimedia\.org|images-assets\.nasa\.gov/i.test(clean);
}

export function openverseImage(result, entities) {
  if (!result || result.mature === true) return null;
  const code = String(result.license || "").toLowerCase();
  const mapped = LICENCE[code];
  if (!mapped || !licenceOk(mapped.name)) return null;
  const title = stripTags(result.title || "");
  const tags = (result.tags || []).map((tag) => tag?.name || tag).join(" ");
  const hay = `${title} ${tags}`;
  if (personRisk(hay)) return null;
  const src = directImage(result.url) ? String(result.url).split("?")[0] : "";
  const sourcePage = String(result.foreign_landing_url || "");
  const creator = stripTags(result.creator || "");
  if (!src || !title || !creator || !/^https:\/\//.test(sourcePage)) return null;
  const basisUrl = /^https:\/\//.test(result.license_url || "") ? result.license_url : mapped.url;
  const score = relevanceScore(entities, hay);
  return {
    src,
    sourcePage,
    credit: creator,
    licence: result.license_version ? `${mapped.name} ${result.license_version}` : mapped.name,
    basisUrl,
    alt: title.slice(0, 180),
    width: Number(result.width || 0) || 640,
    height: Number(result.height || 0) || 360,
    hosting: "hotlink",
    type: imageType(hay),
    relevance: score,
    provider: "openverse",
  };
}

export function createOpenverseClient() {
  let calls = 0;
  let blocked = !sourceAllowed("openverse");
  return {
    get calls() { return calls; },
    async search(term, entities) {
      if (blocked || calls >= MAX_CALLS || !term) return [];
      const url = new URL(ENDPOINT);
      url.searchParams.set("q", term);
      url.searchParams.set("license", "cc0,by");
      url.searchParams.set("page_size", "8");
      calls += 1;
      const response = await fetch(url, {
        headers: {
          "User-Agent": commonsUserAgent(),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30000),
      });
      const burst = Number(response.headers.get("x-ratelimit-available-anon_burst"));
      const day = Number(response.headers.get("x-ratelimit-available-anon_sustained"));
      if ((Number.isFinite(burst) && burst <= 0) || (Number.isFinite(day) && day <= 0) || response.status === 429) {
        blocked = true;
      }
      if (!response.ok) return null;
      const payload = await response.json();
      return (payload.results || []).map((row) => openverseImage(row, entities)).filter(Boolean);
    },
  };
}

export function openverseMatchesEntity(image, entities) {
  return entities.some((entity) => exactName(`${image.alt} ${image.credit}`, entity.term));
}
