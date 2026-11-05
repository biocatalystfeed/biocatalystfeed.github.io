// Shared scoring, filtering, and card rendering for the AI discovery lane.
// Curated records and allowlisted arXiv hits both pass through normalizeItem,
// which forces disclaimer_required. This module does not fetch anything.

export const SOURCE_TIERS = ["model_release", "preprint", "blog", "social", "news"];

export const DEFAULT_CONFIDENCE = {
  model_release: 0.35,
  preprint: 0.3,
  blog: 0.22,
  news: 0.18,
  social: 0.12,
};

export const CONFIDENCE_NOTE = "Evidence-style score only. Does not predict replication.";

export const LANE_DISCLAIMER =
  "AI discovery items are not peer-reviewed findings. They may include AI-generated or non-traditional claims. Informational only. Not medical or investment advice.";

const BLOCKED = [
  /beats doctors/i,
  /better than (doctors|physicians)/i,
  /cures? (cancer|patients|disease)/i,
  /clinical cure/i,
  /guaranteed cure/i,
  /\bdesci token\b/i,
  /\btoken launch\b/i,
  /self-reported benchmark/i,
  /self reported benchmark/i,
  /paper mill/i,
];

const SCIENCE_RE =
  /\b(bio(?:log\w*)?|protein|genom\w*|gene|molecular|molecule|chem\w*|cataly\w*|material|drug|clinical|disease|cell|rna|dna|enzyme|polymer|crystal|antibod\w*|peptide|metabol\w*|neuro\w*|compound|synth\w*|reaction|pharma\w*|physics|quantum|battery|life[- ]sciences?)\b/i;

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function safeHttpUrl(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    return u.href;
  } catch {
    return "";
  }
}

export function blockedByPolicy(text) {
  const s = String(text || "");
  return BLOCKED.some((rx) => rx.test(s));
}

export function normalizeItem(raw) {
  const source_tier = SOURCE_TIERS.includes(raw?.source_tier) ? raw.source_tier : "blog";
  let confidence = Number(raw?.confidence);
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) confidence = DEFAULT_CONFIDENCE[source_tier];
  confidence = Math.round(confidence * 100) / 100;
  const urls = {};
  for (const [key, value] of Object.entries(raw?.urls || {})) {
    const safe = safeHttpUrl(value);
    if (safe) urls[key] = safe;
  }
  const page = safeHttpUrl(raw?.url);
  if (!Object.keys(urls).length && page) urls.page = page;
  return {
    id: String(raw?.id || ""),
    title: String(raw?.title || raw?.name || "").trim(),
    name: String(raw?.name || raw?.title || "").trim(),
    org: String(raw?.org || "").trim(),
    summary: String(raw?.summary || "").trim(),
    base_model: raw?.base_model ? String(raw.base_model) : undefined,
    base_org: raw?.base_org ? String(raw.base_org) : undefined,
    license: raw?.license ? String(raw.license) : undefined,
    params: raw?.params ? String(raw.params) : undefined,
    context_length: raw?.context_length ? String(raw.context_length) : undefined,
    verified_as_of: raw?.verified_as_of ? String(raw.verified_as_of) : undefined,
    urls,
    source_tier,
    confidence,
    disclaimer_required: true,
    disclaimer_class: String(raw?.disclaimer_class || "Not a peer-reviewed finding."),
    confidence_note: CONFIDENCE_NOTE,
    launch: raw?.launch === true,
    sort_rank: Number.isFinite(Number(raw?.sort_rank)) ? Number(raw.sort_rank) : raw?.launch === true ? 0 : 50,
    tags: Array.isArray(raw?.tags) ? raw.tags.map(String) : [],
    published: raw?.published ? String(raw.published) : undefined,
    provenance: String(raw?.provenance || "curated-seed"),
  };
}

export function itemHaystack(item) {
  return [
    item.title,
    item.name,
    item.org,
    item.summary,
    item.base_model,
    item.base_org,
    item.license,
    item.disclaimer_class,
    item.source_tier,
    ...(item.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function filterItems(items, q) {
  const tokens = String(q || "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const normalized = (items || [])
    .map(normalizeItem)
    .filter((item) => item.title && Object.keys(item.urls).length)
    .filter((item) => !blockedByPolicy(`${item.title} ${item.summary} ${item.disclaimer_class}`));
  const matched = tokens.length
    ? normalized.filter((item) => {
        const hay = itemHaystack(item);
        return tokens.every((token) => hay.includes(token));
      })
    : normalized;
  return matched.sort((a, b) => a.sort_rank - b.sort_rank || Number(b.launch) - Number(a.launch) || a.title.localeCompare(b.title));
}

export function arxivCategoriesForQuery(q, allowlist) {
  const cats = [...(allowlist?.arxiv?.categories || [])];
  if (SCIENCE_RE.test(String(q || ""))) {
    for (const entry of allowlist?.arxiv?.conditional || []) {
      if (entry?.category && !cats.includes(entry.category)) cats.push(entry.category);
    }
  }
  return cats;
}

export function arxivTokens(q) {
  return String(q || "")
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z0-9.+_-]/g, ""))
    .filter((token) => token.length >= 2 && token.length <= 40)
    .slice(0, 8);
}

export function buildArxivSearchQuery(q, categories) {
  const tokens = arxivTokens(q);
  if (!tokens.length || !categories?.length) return "";
  const cats = categories.map((cat) => `cat:${cat}`).join(" OR ");
  const terms = tokens.map((token) => `all:${token}`).join(" AND ");
  return `(${cats}) AND ${terms}`;
}

export function buildArxivUrl(q, allowlist) {
  const categories = arxivCategoriesForQuery(q, allowlist);
  const search_query = buildArxivSearchQuery(q, categories);
  if (!search_query) return { url: "", categories, search_query };
  const params = new URLSearchParams({
    search_query,
    start: "0",
    max_results: "5",
    sortBy: "submittedDate",
    sortOrder: "descending",
  });
  return {
    url: `https://export.arxiv.org/api/query?${params.toString()}`,
    categories,
    search_query,
  };
}

function decodeXml(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagText(xml, name) {
  const match = String(xml).match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]).replace(/\s+/g, " ").trim() : "";
}

export function parseArxivAtom(xml) {
  const entries = [];
  for (const chunk of String(xml || "").split("<entry>").slice(1)) {
    const body = chunk.split("</entry>")[0];
    const title = tagText(body, "title");
    const id = tagText(body, "id");
    if (!title || !id) continue;
    const authors = [...body.matchAll(/<author>([\s\S]*?)<\/author>/g)]
      .map((match) => tagText(match[1], "name"))
      .filter(Boolean);
    const cats = [...body.matchAll(/<category\b[^>]*\bterm="([^"]+)"/g)].map((match) => match[1]);
    entries.push({
      title,
      id,
      summary: tagText(body, "summary"),
      published: tagText(body, "published"),
      authors,
      cats,
    });
  }
  return entries;
}

export function arxivEntriesToItems(entries, allowedCategories) {
  const allow = new Set(allowedCategories || []);
  const out = [];
  for (const entry of entries || []) {
    if (allow.size && !(entry.cats || []).some((cat) => allow.has(cat))) continue;
    if (blockedByPolicy(`${entry.title} ${entry.summary}`)) continue;
    const paper = safeHttpUrl(String(entry.id || "").replace(/^http:\/\//, "https://"));
    const item = normalizeItem({
      id: `arxiv:${paper || entry.id}`,
      title: entry.title,
      org: (entry.authors || []).slice(0, 4).join(", "),
      summary: String(entry.summary || "").slice(0, 600),
      urls: paper ? { paper } : {},
      source_tier: "preprint",
      disclaimer_class: "arXiv preprint. Not peer-reviewed.",
      provenance: "arxiv-allowlist",
      tags: entry.cats || [],
      published: String(entry.published || "").slice(0, 10),
      sort_rank: 80,
      launch: false,
    });
    if (!item.urls.paper) continue;
    out.push(item);
    if (out.length >= 5) break;
  }
  return out;
}

const LINK_LABELS = [
  ["weights", "Weights"],
  ["blog", "Blog"],
  ["paper", "Paper"],
  ["code", "Code"],
  ["page", "Project"],
];

export function primaryUrl(item) {
  return item.urls.weights || item.urls.paper || item.urls.code || item.urls.blog || item.urls.page || "";
}

export function renderItem(raw) {
  const item = normalizeItem(raw);
  const href = primaryUrl(item);
  if (!item.title || !href) return "";
  if (blockedByPolicy(`${item.title} ${item.summary}`)) return "";
  const extraLinks = LINK_LABELS.filter(([key]) => item.urls[key])
    .map(([key, label]) => `<a href="${esc(item.urls[key])}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .join("");
  const pills = [
    item.launch ? "launch" : "",
    item.source_tier.replaceAll("_", " "),
    `evidence ${item.confidence}`,
    "not peer-reviewed",
    item.license || "",
  ].filter(Boolean);
  const meta = [
    item.org,
    item.base_model ? `base ${item.base_model}${item.base_org ? ` (${item.base_org})` : ""}` : "",
    item.params,
    item.context_length,
    item.published,
    item.verified_as_of ? `verified ${item.verified_as_of}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<li class="${item.launch ? "aid-launch" : ""}" data-lane="ai-discovery" data-id="${esc(item.id)}"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a><div class="meta">${pills
    .map((pill) => `<span class="pill${pill === "not peer-reviewed" ? " warn" : ""}">${esc(pill)}</span>`)
    .join("")}${esc(meta)}</div><p class="aid-sum">${esc(item.summary)}</p>${
    extraLinks ? `<div class="aid-links">${extraLinks}</div>` : ""
  }<p class="aid-fine">${esc(item.disclaimer_class)} ${esc(item.confidence_note)}</p></li>`;
}
