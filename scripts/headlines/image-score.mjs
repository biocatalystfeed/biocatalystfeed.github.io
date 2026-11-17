export const RELEVANCE_MIN = 2;
export const MAX_PAGE_IMAGES = 4;
export const TOP_IMAGE_ITEMS = 5;

const GENERIC = new Set(["europe", "phase", "study", "trial", "fda", "nih", "purple", "orange", "book", "health", "canada", "approved", "approval", "treatment", "cancer", "disease", "adults", "primary", "completion", "reaches", "grants", "accelerated", "biologics", "deutschland", "therapeutics", "pharmaceutical", "pharmaceuticals", "holdings", "systems", "devices", "panel", "microbiology", "advisory", "meeting", "provides", "clarity", "support", "development", "quality", "research", "summary", "adolescents", "obesity", "overweight", "weekly", "once", "china", "weight", "loss", "labs", "lab", "model", "round", "series", "company", "announces", "investment", "blood", "heart", "protein", "cell", "cells", "human", "posts", "links", "plasma", "signatures"]);

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

export function imageType(text) {
  const hay = String(text || "");
  if (/\b(?:micrograph|microscop\w*|histolog\w*|histopath\w*|immunohisto\w*|immunochem\w*|h&e stain|electron micrograph)\b/i.test(hay)) return "micrograph";
  if (/chemical structures|skeletal formula|structural formula|chemical structure|ball-and-stick/i.test(hay)) return "diagram";
  if (/\b(illustration|drawing|painting|artwork|artist's impression|artist’s impression)\b/i.test(hay)) return "illustration";
  return "photo";
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
  if (item?.image_entity?.name) add(item.image_entity.name, 2, "drug");
  const headline = String(item?.headline || "");
  const owner = /\b([A-Z][A-Za-z0-9.&-]+(?:\s+[A-Z][A-Za-z0-9.&-]+){0,3})'s\b/.exec(headline);
  if (owner) add(owner[1], 2, "org");
  const lead = /^([A-Z][A-Za-z0-9.&-]+(?:\s+[A-Z][A-Za-z0-9.&-]+){0,3})\s+(?:announces|posts|links|describes|reports)\b/.exec(headline);
  if (lead) add(lead[1], 2, "org");
  const firm = /\b([A-Z][A-Za-z0-9.&-]+(?:\s+[A-Z][A-Za-z0-9.&-]+){0,3})\s+Inc\.?\b/.exec(headline);
  if (firm) add(firm[1], 2, "org");
  for (const match of headline.matchAll(/\(([A-Za-z][A-Za-z0-9-]{3,})\)/g)) add(match[1], 2, "drug");
  const blob = `${headline} ${item?.blurb || ""}`.toLowerCase();
  for (const phrase of TOPICS) {
    if (blob.includes(phrase)) add(phrase, 2, "topic");
  }
  return found.slice(0, 4);
}

export function photoQuery(entities) {
  const topic = entities.find((entry) => entry.kind === "topic");
  const org = entities.find((entry) => entry.kind === "org");
  return (topic || org || entities[0])?.term || "";
}

export function relevanceScore(entities, text) {
  let score = 0;
  for (const entity of entities || []) {
    if (!exactName(text, entity.term)) continue;
    if (/^bayer$/i.test(entity.term) && /\bbayer\s+(?:filter|pattern|mosaic|matrix|sensor)\b/i.test(text)) continue;
    score += entity.weight;
  }
  return score;
}

export function candidateProblem(candidate) {
  if (!candidate?.src || !candidate?.credit || !candidate?.alt || !candidate?.licence || !candidate?.basisUrl || !candidate?.sourcePage) {
    return "missing credit, alt, licence, or source";
  }
  if (String(candidate.alt).trim().split(/\s+/).length < 3) return "alt is not descriptive";
  if (!licenceOk(candidate.licence) && candidate.licence !== "Open Government Licence v3.0") return "licence not allowlisted";
  if (personRisk(candidate.alt)) return "identifiable patient or child";
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
