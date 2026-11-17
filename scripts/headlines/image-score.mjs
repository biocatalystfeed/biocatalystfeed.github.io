export const RELEVANCE_MIN = 3;
export const MAX_PAGE_IMAGES = 4;
export const TOP_IMAGE_ITEMS = 5;

const GENERIC = new Set(["europe", "phase", "study", "trial", "fda", "nih", "purple", "orange", "book", "health", "canada", "approved", "approval", "treatment", "cancer", "disease", "adults", "primary", "completion", "reaches", "grants", "accelerated", "biologics", "deutschland", "therapeutics", "pharmaceutical", "pharmaceuticals", "holdings", "systems", "devices", "panel", "microbiology", "advisory", "meeting", "provides", "clarity", "support", "development", "quality", "research", "summary", "adolescents", "obesity", "overweight", "weekly", "once", "china", "weight", "loss", "labs", "lab", "model", "round", "series", "company", "announces", "investment", "blood", "heart", "protein", "cell", "cells", "human", "posts", "links", "plasma", "signatures", "solid", "tumor", "tumors", "pressure", "delivery", "common", "form"]);

const TOPICS = ["lung cancer", "blood pressure", "breast cancer", "insulin resistance", "heart disease", "type 2 diabetes", "alzheimer", "solid tumors"];

const PEOPLE = /\b(child|children|infant|infants|baby|babies|toddler|toddlers|pediatric|paediatric|patient|patients|newborn|newborns)\b/i;

export function commonsUserAgent() {
  return `BioCatHeadlinesBot/1.0 (https://biocat.ai/; contact@biocat.ai) node/${process.versions.node}`;
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

export function licenceOk(name) {
  const text = stripTags(name);
  if (!text || /non-?free|fair use|unknown/i.test(text)) return false;
  if (/-NC\b|-ND\b|\bNC\b|\bND\b/i.test(text)) return false;
  return /^(?:public domain|pd-[\w.]+|cc0|cc by-sa|cc by)\b/i.test(text);
}

export function exactName(text, name) {
  const escaped = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:[^A-Za-z0-9]|$)`, "i").test(String(text || ""));
}

export function imageType(input) {
  const hay = typeof input === "string"
    ? input
    : `${input?.title || ""} ${input?.categories || ""} ${input?.description || ""} ${input?.src || ""} ${input?.mime || ""}`;
  const mime = typeof input === "string" ? "" : String(input?.mime || "");
  if (/chemical structures|skeletal formula|structural formula|chemical structure|ball-and-stick|ball and stick|space-filling|3d ball/i.test(hay)) return "diagram";
  if (/\b(schematic|diagram|flowchart|infographic|line drawing|waveform|chart|graph|plot|microneedles?|mechanisms? of action)\b/i.test(hay)) return "diagram";
  if (/\b(?:micrograph|microscop\w*|histolog\w*|histopath\w*|immunohisto\w*|immunochem\w*|h&e stain|electron micrograph)\b/i.test(hay)) return "micrograph";
  if (/\b(illustration|drawing|painting|artwork|cartoon|parody|artist's impression|artist’s impression)\b/i.test(hay)) return "illustration";
  if (mime === "image/svg+xml") return "diagram";
  return "photo";
}

export function isArtwork(text) {
  return /\b(paintings?|cartoons?|parody|artworks?|caricature|comic strip|oil on canvas|watercolor|after [A-Z][a-z]+)\b/.test(String(text || ""));
}

export function personRisk(text) {
  return PEOPLE.test(String(text || ""));
}

export function imageEntities(item) {
  const found = [];
  const add = (term, weight, kind) => {
    const clean = String(term || "").replace(/\s+/g, " ").trim();
    if (clean.length < 4 || GENERIC.has(clean.toLowerCase())) return;
    if (found.some((entry) => entry.term.toLowerCase() === clean.toLowerCase())) return;
    found.push({ term: clean, weight, kind });
  };
  if (item?.image_entity?.name) add(item.image_entity.name, 3, "drug");
  const headline = String(item?.headline || "");
  const owner = /\b([A-Z][A-Za-z0-9.&-]+(?:\s+[A-Z][A-Za-z0-9.&-]+){0,3})'s\b/.exec(headline);
  if (owner) add(owner[1], 3, "org");
  const lead = /^([A-Z][A-Za-z0-9.&-]+(?:\s+[A-Z][A-Za-z0-9.&-]+){0,3})\s+(?:announces|posts|links|describes|reports)\b/.exec(headline);
  if (lead) add(lead[1], 3, "org");
  const firm = /\b([A-Z][A-Za-z0-9.&-]+(?:\s+[A-Z][A-Za-z0-9.&-]+){0,3})\s+Inc\.?\b/.exec(headline);
  if (firm) add(firm[1], 3, "org");
  for (const match of headline.matchAll(/\(([A-Za-z][A-Za-z0-9-]{3,})\)/g)) add(match[1], 3, "drug");
  for (const match of headline.matchAll(/\b([A-Z][a-z]{6,}[a-zA-Z0-9-]*)\b/g)) add(match[1], 3, "drug");
  const blob = `${headline} ${item?.blurb || ""}`.toLowerCase();
  for (const phrase of TOPICS) {
    if (blob.includes(phrase)) add(phrase, 3, "topic");
  }
  return found.slice(0, 4);
}

export function searchTerms(entities) {
  const ordered = ["org", "topic", "drug"].flatMap((kind) => entities.filter((entry) => entry.kind === kind));
  const terms = [];
  for (const entry of ordered) {
    if (!terms.some((term) => term.toLowerCase() === entry.term.toLowerCase())) terms.push(entry.term);
  }
  return terms.slice(0, 2);
}

export function photoQuery(entities) {
  return searchTerms(entities)[0] || "";
}

const DEVICE_ASIDE = /\b(microneedle|schematic|delivery system|nanoparticle|apparatus|engineered polymeric)\b/i;

export function explainMatch(entities, text, type = "photo") {
  const hay = String(text || "");
  if (isArtwork(hay)) return { score: 0, reason: "artwork, painting, cartoon, or parody" };
  const reasons = [];
  for (const entity of entities || []) {
    const words = entity.term.toLowerCase().split(/\s+/);
    if (words.length < 2 && words.every((word) => GENERIC.has(word))) continue;
    if (entity.kind !== "topic" && words.every((word) => GENERIC.has(word))) continue;
    if (!exactName(hay, entity.term)) continue;
    if (/^bayer$/i.test(entity.term) && /\bbayer\s+(?:filter|pattern|mosaic|matrix|sensor)\b/i.test(hay)) continue;
    if (entity.kind === "topic") {
      if (type === "diagram" || type === "illustration") continue;
      if (DEVICE_ASIDE.test(hay)) continue;
      reasons.push(`exact condition "${entity.term}" shown as a ${type}`);
    } else {
      reasons.push(`${entity.kind} "${entity.term}"`);
    }
  }
  return { score: reasons.length ? RELEVANCE_MIN : 0, reason: reasons.join("; ") };
}

export function relevanceScore(entities, text, type = "photo") {
  return explainMatch(entities, text, type).score;
}

export function imageResponseOk(status, contentType) {
  const type = String(contentType || "").split(";")[0].trim();
  return (status === 200 || status === 206) && /^image\//i.test(type);
}

export function candidateProblem(candidate) {
  if (!candidate?.src || !candidate?.credit || !candidate?.alt || !candidate?.licence || !candidate?.basisUrl || !candidate?.sourcePage) {
    return "missing credit, alt, licence, or source";
  }
  if (String(candidate.alt).trim().split(/\s+/).length < 3) return "alt is not descriptive";
  if (!licenceOk(candidate.licence) && candidate.licence !== "Open Government Licence v3.0") return "licence not allowlisted";
  if (personRisk(candidate.alt)) return "identifiable patient or child";
  if (isArtwork(`${candidate.alt || ""} ${candidate.sourcePage || ""}`)) return "artwork, painting, cartoon, or parody";
  if (Number(candidate.relevance || 0) < RELEVANCE_MIN) return "below relevance threshold";
  return "";
}

export function placeImages(slots) {
  const placed = [];
  const used = new Set();
  let diagrams = 0;
  for (const slot of slots || []) {
    if (placed.length >= MAX_PAGE_IMAGES) break;
    if (Number(slot.index) >= TOP_IMAGE_ITEMS) continue;
    const previous = placed.at(-1)?.image?.type || "";
    const ranked = [...(slot.candidates || [])]
      .filter((candidate) => !candidateProblem(candidate))
      .sort((a, b) => {
        const rank = (type) => (type === "micrograph" ? 0 : type === "photo" ? 1 : type === "illustration" ? 2 : 3);
        const typeOrder = rank(a.type) - rank(b.type);
        if (typeOrder) return typeOrder;
        return Number(b.relevance || 0) - Number(a.relevance || 0);
      });
    let pick = null;
    for (const candidate of ranked) {
      if (used.has(candidate.src)) continue;
      if (candidate.type === "diagram" && diagrams >= 1) continue;
      if (candidate.type && candidate.type === previous) continue;
      pick = candidate;
      break;
    }
    if (!pick) continue;
    used.add(pick.src);
    if (pick.type === "diagram") diagrams += 1;
    placed.push({ index: slot.index, image: pick });
  }
  return placed;
}
