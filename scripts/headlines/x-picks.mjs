import fs from "node:fs";
import allowlist from "./x-allowlist.json" with { type: "json" };
import { echoesHeadline, wordCount } from "./copy.mjs";

const HANDLES = new Set(allowlist.handles.map((handle) => handle.toLowerCase()));
const HOSTS = allowlist.linkedHosts.map((host) => host.toLowerCase());
const KINDS = new Set(["paper", "approval", "model", "other"]);
const BLURB_SOURCES = new Set(["page-description", "abstract", "crossref"]);
const DOI = /^10\.\d{4,9}\/\S+$/;

export function canonUrl(value) {
  try {
    const url = new URL(String(value || ""));
    let host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "dx.doi.org") host = "doi.org";
    let path = url.pathname.replace(/\/+$/, "");
    if (host === "doi.org") path = path.toLowerCase();
    const params = [];
    for (const [key, param] of url.searchParams) {
      if (/^utm_/i.test(key)) continue;
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(param)}`);
    }
    const search = params.length ? `?${params.join("&")}` : "";
    return `${url.protocol.toLowerCase()}//${host}${path}${search}`;
  } catch {
    return "";
  }
}

export function dedupeByCanonUrl(items) {
  const ranked = [...(items || [])].sort((a, b) => (b.significance || 0) - (a.significance || 0) || String(a.id).localeCompare(String(b.id)));
  const seen = new Set();
  const kept = [];
  for (const item of ranked) {
    const keys = [canonUrl(item.source_url), canonUrl(item.linked_url)].filter(Boolean);
    if (keys.some((key) => seen.has(key))) continue;
    kept.push(item);
    for (const key of keys) seen.add(key);
  }
  return kept;
}

export function hostAllowed(value) {
  let host = "";
  try {
    host = new URL(String(value || "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return false;
  }
  return HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function xPickItems(file, existingUrls = []) {
  if (!file?.enabled) return [];
  const seen = new Set(existingUrls.map(canonUrl).filter(Boolean));
  const out = [];
  for (const pick of file.picks || []) {
    const handle = String(pick.handle || "").replace(/^@/, "");
    const postUrl = String(pick.postUrl || "");
    const linkedUrl = String(pick.linkedUrl || "");
    const postedAt = String(pick.postedAt || "");
    const headline = String(pick.headline || "").replace(/\s+/g, " ").trim();
    let blurb = String(pick.blurb || "").replace(/\s+/g, " ").trim();
    const kind = String(pick.kind || "");
    if ("postText" in pick || "text" in pick) continue;
    if (!HANDLES.has(handle.toLowerCase())) continue;
    if (!/^https:\/\/(?:x|twitter)\.com\/[^/]+\/status\/\d+/.test(postUrl)) continue;
    if (!hostAllowed(linkedUrl) || !KINDS.has(kind)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(postedAt) || !headline || !blurb) continue;
    if (wordCount(blurb) > 30) continue;
    if (echoesHeadline(headline, blurb)) continue;
    if (pick.blurbSource != null && !BLURB_SOURCES.has(pick.blurbSource)) continue;
    if (pick.doi != null && !DOI.test(String(pick.doi))) continue;
    const key = canonUrl(linkedUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!blurb.includes(linkedUrl)) blurb = `${blurb} ${linkedUrl}`;
    out.push({
      id: `x:${postUrl}`,
      headline,
      blurb,
      source_url: postUrl,
      source_type: "news",
      source_name: "X",
      published_at: postedAt,
      scout_source: "x",
      rule: "x-pick",
      adjustments: [],
      dedupe_key: `linked:${key}`,
      linked_url: linkedUrl,
      ...(pick.doi ? { doi: String(pick.doi) } : {}),
      ...(pick.blurbSource ? { blurb_source: pick.blurbSource } : {}),
    });
  }
  return out;
}

export function readXPicks(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" ? data : { enabled: false, picks: [] };
  } catch {
    return { enabled: false, picks: [] };
  }
}
