import { canonUrl, xAccountHandle } from "./x-picks.mjs";

/**
 * Significance ranking for the headlines test page.
 *
 * This is the only file to tune. Change a number here and rerun
 * `node scripts/headlines/populate.mjs`. Do not hard-code scores in fetchers.
 *
 * A fetcher picks a `rule` key and zero or more `adjustments` keys. This module
 * adds recency and, when data/feedback/*.json exists, the newest CEO review for
 * that item id. Free-text notes are not parsed. A person reads them and edits
 * the tables below.
 *
 * published_at is the event date from the source (approval, letter, meeting,
 * readout, expiry, index date), not the time the script ran. A future event
 * date is treated as upcoming.
 *
 * Tiers (also written onto each item as `tier`):
 *   5  88-100  lead scale
 *   4  75-87   large
 *   3  60-74   medium
 *   2  40-59   small
 *   1   0-39   brief
 *
 * After per-source caps, regulator sources are kept to at most about half the
 * selected items when any non-regulator item is available. The returned order
 * is a score sort with a light swap so two adjacent items share a source only
 * when every remaining item is that source.
 *
 * Feedback deltas stack, except `dropped`, which removes the item.
 * The newest data/feedback JSON (by exported_at) wins per id. Files with
 * "sample": true are ignored. See data/feedback/README.md.
 */

export const RULES = {
  base: {
    "fda-nme": 90,
    "fda-bla": 86,
    "fda-biosimilar": 68,
    "fda-orig": 58,
    "fda-efficacy": 66,
    "fda-anda": 30,
    "fda-crl": 82,
    "purple-351a": 88,
    "purple-biosimilar": 66,
    "purple-interchangeable": 80,
    "purple-revoked": 72,
    "orange-loe-exclusivity": 64,
    "orange-loe-patent": 52,
    "adcom-meeting": 74,
    "adcom-postpone": 68,
    "adcom-cancel": 64,
    "adcom-amendment": 60,
    "ema-opinion": 84,
    "ema-authorisation": 80,
    "ema-refusal": 82,
    "ema-withdrawal": 70,
    "ema-lapse": 68,
    "hc-priority-nas": 80,
    "hc-nas": 76,
    "hc-noc-c": 74,
    "hc-nds": 62,
    "hc-snds": 46,
    "hc-ands": 34,
    "trial-phase3": 70,
    "trial-phase2": 52,
    "paper-phase3": 60,
    "paper-journal": 66,
    "paper-ai": 56,
    "paper-preprint": 50,
    "paper-medrxiv": 52,
    "ai-model": 62,
    "ai-preprint": 54,
    "nih-grant": 60,
    "sec-8k": 58,
    "fda-press": 70,
    "nih-news": 60,
    "ai-news": 68,
    "mhra-news": 74,
    "x-pick": 58,
    "science-news": 64,
  },
  labels: {
    "fda-nme": "Original FDA approval classed Type 1 (new molecular entity).",
    "fda-bla": "Original FDA biologics license approval.",
    "fda-biosimilar": "Original FDA approval classed as a new active ingredient or biosimilar.",
    "fda-orig": "Original FDA NDA approval that is not classed Type 1.",
    "fda-efficacy": "FDA efficacy supplement approval.",
    "fda-anda": "Original abbreviated new drug (generic) approval.",
    "fda-crl": "FDA complete response letter.",
    "purple-351a": "New 351(a) biologic in the Purple Book monthly changes report.",
    "purple-biosimilar": "New biosimilar in the Purple Book monthly changes report.",
    "purple-interchangeable": "Purple Book lists an interchangeability date in the report month.",
    "purple-revoked": "Purple Book licensure revoked or voluntarily revoked.",
    "orange-loe-exclusivity": "Soonest Orange Book loss of exclusivity is an exclusivity code.",
    "orange-loe-patent": "Soonest Orange Book loss of exclusivity is a listed patent.",
    "adcom-meeting": "Federal Register notice of an FDA advisory committee meeting.",
    "adcom-postpone": "Federal Register postponement of an FDA advisory committee meeting.",
    "adcom-cancel": "Federal Register cancellation of an FDA advisory committee meeting.",
    "adcom-amendment": "Federal Register amendment of an FDA advisory committee meeting notice.",
    "ema-opinion": "EMA opinion on a medicine that is not yet authorised in this export.",
    "ema-authorisation": "EMA marketing authorisation date falls in the window.",
    "ema-refusal": "EMA refusal of a marketing authorisation.",
    "ema-withdrawal": "EMA application withdrawn.",
    "ema-lapse": "EMA marketing authorisation withdrawn, expired, revoked, or lapsed.",
    "hc-priority-nas": "Health Canada notice of compliance, priority new active substance.",
    "hc-nas": "Health Canada notice of compliance, new active substance.",
    "hc-noc-c": "Health Canada notice of compliance with conditions.",
    "hc-nds": "Health Canada new drug submission notice of compliance.",
    "hc-snds": "Health Canada supplement to a new drug submission.",
    "hc-ands": "Health Canada abbreviated (generic) notice of compliance.",
    "trial-phase3": "Phase 3 primary completion date on the ClinicalTrials.gov study record.",
    "trial-phase2": "Phase 2 primary completion date on the ClinicalTrials.gov study record.",
    "paper-phase3": "Europe PMC record whose title names a phase 3 trial or study.",
    "paper-journal": "Europe PMC record from a journal on the high-impact list in the populator.",
    "paper-ai": "Paper whose title names a machine-learning or AI method in biology.",
    "paper-preprint": "bioRxiv preprint in a configured biology category. Not peer-reviewed.",
    "paper-medrxiv": "medRxiv preprint in a configured clinical category. Not peer-reviewed.",
    "ai-model": "Curated AI model-release card from the BioCatalystFeed AI discovery endpoint.",
    "ai-preprint": "arXiv preprint returned by the BioCatalystFeed AI discovery endpoint. Not peer-reviewed.",
    "nih-grant": "NIH RePORTER project with a start date in the window.",
    "sec-8k": "SEC Form 8-K for a company whose ticker is already in calendar/calendar.json.",
    "fda-press": "FDA press release.",
    "nih-news": "NIH news release.",
    "ai-news": "Official lab blog post on an AI or biology topic.",
    "mhra-news": "UK MHRA news item from the GOV.UK atom feed.",
    "x-pick": "Curated X post. The post text is not copied. The item links to the post and to a primary source.",
    "science-news": "Science or mainstream news item from an official public feed.",
  },
  adjustments: {
    "priority-review": 8,
    "conditional": 4,
    "orphan": 0,
    "biosimilar": -8,
    "with-conditions": 4,
    "source-first": 12,
    "pivotal-readout": 8,
    "ai-biology-release": 10,
    "routine-filing": -18,
  },
  past: [
    { maxDays: 7, delta: 6 },
    { maxDays: 21, delta: 3 },
    { maxDays: 45, delta: 0 },
    { maxDays: 90, delta: -6 },
    { maxDays: 150, delta: -12 },
    { maxDays: 100000, delta: -20 },
  ],
  upcoming: [
    { maxDays: 7, delta: 6 },
    { maxDays: 21, delta: 3 },
    { maxDays: 60, delta: 0 },
    { maxDays: 120, delta: -4 },
    { maxDays: 100000, delta: -10 },
  ],
  feedback: {
    up: 4,
    down: -8,
    bigger: 12,
    smaller: -12,
  },
  caps: {
    "openfda-drugsfda": 3,
    "openfda-crl": 2,
    "purple-book": 2,
    "orange-book": 1,
    "federal-register-adcom": 1,
    ema: 3,
    "health-canada-noc": 2,
    mhra: 3,
    "clinicaltrials-calendar": 4,
    europepmc: 4,
    biorxiv: 3,
    medrxiv: 3,
    "bcf-papers": 3,
    "bcf-ai-discovery": 3,
    "nih-reporter": 3,
    "sec-edgar-8k": 3,
    "fda-press": 3,
    "nih-news": 2,
    deepmind: 3,
    "openai-news": 3,
    "nvidia-blog": 2,
    x: 8,
  },
  ruleCaps: {
    "fda-anda": 3,
    "fda-orig": 3,
    "hc-ands": 1,
    "hc-snds": 2,
    "trial-phase2": 2,
    "ema-lapse": 2,
  },
  defaultCap: 3,
  globalCap: 56,
  // Of a full page, regulators stay near a quarter and no source exceeds about 15%.
  regulatorShare: 0.25,
  sourceShare: 0.15,
  minScore: 28,
  // Items under this score are the brief tier. Each source keeps up to two of
  // them even when higher scores would fill its cap, so the page is not all
  // large type.
  briefBelow: 45,
  tiers: [
    { min: 88, tier: 5 },
    { min: 75, tier: 4 },
    { min: 60, tier: 3 },
    { min: 40, tier: 2 },
    { min: 0, tier: 1 },
  ],
};

// A lead item keeps the slot for 12 hours. The event can be updated for 24 hours
// after it first became the lead, and then no item of that event can lead again.
export const LEAD_MAX_ITEM_HOURS = 12;
export const LEAD_EVENT_WINDOW_HOURS = 24;
// Breaking boost on the lead-ranking score. Headline tiers stay on base significance.
export const BREAKING_MAX_BOOST = 0.35;
export const BREAKING_FULL_HOURS = 2;
export const BREAKING_ZERO_HOURS = 12;
// Tier 5 in RULES.tiers starts at 88. Only that top band is lead-worthy and
// receives the breaking boost, so a fresh low score cannot outrank a strong one.
export const LEAD_WORTHY_FLOOR = 88;

export function tierFor(score) {
  const n = Number(score);
  for (const row of RULES.tiers) if (n >= row.min) return row.tier;
  return 1;
}

export function dayDiff(fromIso, toIso) {
  const a = utc(fromIso);
  const b = utc(toIso);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 86400000);
}

function utc(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function recency(publishedAt, today) {
  const delta = dayDiff(today, publishedAt);
  if (delta == null) return { delta: 0, label: "undated +0" };
  if (delta >= 0) {
    const row = RULES.upcoming.find((r) => delta <= r.maxDays) || RULES.upcoming.at(-1);
    return { delta: row.delta, label: `in ${delta}d ${signed(row.delta)}` };
  }
  const age = -delta;
  const row = RULES.past.find((r) => age <= r.maxDays) || RULES.past.at(-1);
  return { delta: row.delta, label: `${age}d old ${signed(row.delta)}` };
}

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function scoreItem(item, today, feedback) {
  const base = RULES.base[item.rule];
  if (base == null) throw new Error(`unknown ranking rule: ${item.rule}`);
  let total = base;
  const parts = [`${item.rule} ${base}`];
  for (const key of item.adjustments || []) {
    if (!(key in RULES.adjustments)) throw new Error(`unknown ranking adjustment: ${key}`);
    const d = RULES.adjustments[key];
    total += d;
    if (d) parts.push(`${key} ${signed(d)}`);
  }
  const rec = recency(item.published_at, today);
  total += rec.delta;
  parts.push(rec.label);
  const fb = feedback?.get?.(item.id) || feedback?.[item.id] || null;
  let drop = false;
  if (fb) {
    if (fb.size === "dropped") {
      drop = true;
      parts.push("feedback dropped");
    } else {
      if (fb.vote && fb.vote in RULES.feedback) {
        total += RULES.feedback[fb.vote];
        parts.push(`feedback ${fb.vote} ${signed(RULES.feedback[fb.vote])}`);
      }
      if (fb.size && fb.size in RULES.feedback) {
        total += RULES.feedback[fb.size];
        parts.push(`feedback ${fb.size} ${signed(RULES.feedback[fb.size])}`);
      }
    }
  }
  const significance = clamp(total);
  const label = RULES.labels[item.rule] || item.rule;
  return {
    significance,
    tier: tierFor(significance),
    drop,
    significance_rationale: `${parts.join("; ")} = ${significance}. ${label}`,
  };
}

function cmp(a, b) {
  return b.significance - a.significance || (a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const REGULATOR_SOURCES = new Set([
  "openfda-drugsfda",
  "openfda-crl",
  "purple-book",
  "orange-book",
  "federal-register-adcom",
  "ema",
  "health-canada-noc",
  "mhra",
]);

export function diversify(items) {
  const rest = [...items];
  const out = [];
  while (rest.length) {
    const prev = out.length ? out[out.length - 1].scout_source : "";
    let index = 0;
    if (prev) {
      const alt = rest.findIndex((item) => item.scout_source !== prev);
      if (alt !== -1) index = alt;
    }
    out.push(rest.splice(index, 1)[0]);
  }
  return out;
}

function balanceRegulators(items) {
  const regs = items.filter((item) => REGULATOR_SOURCES.has(item.scout_source));
  const nons = items.filter((item) => !REGULATOR_SOURCES.has(item.scout_source));
  if (!nons.length) return items;
  const maxReg = Math.floor(nons.length * RULES.regulatorShare / (1 - RULES.regulatorShare));
  const kept = new Set(regs.slice(0, Math.max(0, maxReg)).map((item) => item.id));
  return items.filter((item) => !REGULATOR_SOURCES.has(item.scout_source) || kept.has(item.id));
}

function capSourceShare(items) {
  const maxSrc = Math.max(1, Math.floor(RULES.globalCap * RULES.sourceShare));
  const counts = {};
  const out = [];
  for (const item of items) {
    const n = counts[item.scout_source] || 0;
    if (n >= maxSrc) continue;
    counts[item.scout_source] = n + 1;
    out.push(item);
  }
  return out;
}

export function selectHeadlines(items) {
  const groups = new Map();
  for (const item of items) {
    if (item.drop || item.significance < RULES.minScore) continue;
    const list = groups.get(item.scout_source) || [];
    list.push(item);
    groups.set(item.scout_source, list);
  }
  const capped = [];
  for (const [source, list] of groups) {
    list.sort(cmp);
    if (source === "x") list.splice(0, list.length, ...limitXHandles(list));
    list.sort(cmp);
    const cap = RULES.caps[source] ?? RULES.defaultCap;
    const ruleCount = {};
    const high = [];
    const low = [];
    for (const item of list) {
      const ruleCap = RULES.ruleCaps[item.rule];
      if (ruleCap != null && (ruleCount[item.rule] || 0) >= ruleCap) continue;
      ruleCount[item.rule] = (ruleCount[item.rule] || 0) + 1;
      if (item.significance < RULES.briefBelow) low.push(item);
      else high.push(item);
    }
    const lowSlots = Math.min(2, low.length);
    const kept = high.slice(0, Math.max(0, cap - lowSlots));
    kept.push(...low.slice(0, cap - kept.length));
    capped.push(...kept);
  }
  const byId = new Map();
  const ranked = [...capped].sort(cmp);
  const picked = [];
  const seenSource = new Set();
  for (const item of ranked) {
    if (seenSource.has(item.scout_source) || byId.has(item.id)) continue;
    picked.push(item);
    byId.set(item.id, item);
    seenSource.add(item.scout_source);
    if (picked.length >= RULES.globalCap) break;
  }
  if (picked.length < RULES.globalCap) {
    for (const item of ranked) {
      if (byId.has(item.id)) continue;
      picked.push(item);
      byId.set(item.id, item);
      if (picked.length >= RULES.globalCap) break;
    }
  }
  return diversify(capSourceShare(balanceRegulators(picked.sort(cmp))));
}

export const X_ACCOUNT_CAP = 3;

function storyUrl(item) {
  if (item?.scout_source === "x") return canonUrl(item.linked_url || "");
  return canonUrl(item?.linked_url || item?.source_url || "");
}

function eventIds(item) {
  const blob = [item?.doi, item?.linked_url, item?.source_url, item?.headline, item?.id].filter(Boolean).join(" ");
  const ids = new Set();
  const doi = /\b(10\.\d{4,9}\/\S+?)(?=[)\].,;]|$)/i.exec(blob);
  if (doi) ids.add(`doi:${doi[1].toLowerCase()}`);
  for (const match of blob.matchAll(/\bNCT\d{8}\b/gi)) ids.add(`nct:${match[0].toUpperCase()}`);
  for (const match of blob.matchAll(/\b(?:NDA|BLA|ANDA)\s*-?\s*\d{5,6}\b/gi)) ids.add(`reg:${match[0].replace(/[\s-]+/g, "").toUpperCase()}`);
  for (const match of blob.matchAll(/\bEMEA\/H\/[A-Z]\/\d+\b/gi)) ids.add(`reg:${match[0].toUpperCase()}`);
  return ids;
}

function headlineTokens(value) {
  return new Set(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length >= 2));
}

export function headlineJaccard(left, right) {
  const a = headlineTokens(left);
  const b = headlineTokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function sameXEvent(left, right) {
  if (!left || !right) return false;
  const leftIds = eventIds(left);
  for (const id of eventIds(right)) if (leftIds.has(id)) return true;
  const leftUrl = storyUrl(left);
  const rightUrl = storyUrl(right);
  if (leftUrl && rightUrl && leftUrl === rightUrl) return true;
  return headlineJaccard(left.headline, right.headline) >= 0.6;
}

function xEligible(item) {
  return item && !item.drop && item.significance >= RULES.minScore && xAccountHandle(item);
}

function limitXHandles(list, cap = X_ACCOUNT_CAP) {
  const ranked = [...list].sort(cmp);
  const counts = {};
  const kept = [];
  const keptIds = new Set();
  for (const item of ranked) {
    if (keptIds.has(item.id)) continue;
    const handle = xAccountHandle(item);
    if (!handle) {
      kept.push(item);
      keptIds.add(item.id);
      continue;
    }
    if ((counts[handle] || 0) < cap) {
      counts[handle] = (counts[handle] || 0) + 1;
      kept.push(item);
      keptIds.add(item.id);
      continue;
    }
    const covered = kept.some((chosen) => xAccountHandle(chosen) !== handle && sameXEvent(item, chosen));
    if (covered) continue;
    const alternate = ranked.find((other) => {
      if (other.id === item.id || keptIds.has(other.id)) return false;
      const otherHandle = xAccountHandle(other);
      if (!otherHandle || otherHandle === handle || (counts[otherHandle] || 0) >= cap) return false;
      return sameXEvent(item, other);
    });
    if (!alternate) continue;
    counts[xAccountHandle(alternate)] = (counts[xAccountHandle(alternate)] || 0) + 1;
    keptIds.add(alternate.id);
    kept.push(alternate);
  }
  return kept;
}

export function capXAccounts(page, pool = page, cap = X_ACCOUNT_CAP) {
  const ranked = [...(page || [])].sort(cmp);
  const counts = {};
  const kept = [];
  const keptIds = new Set();
  const overflow = [];
  for (const item of ranked) {
    const handle = xAccountHandle(item);
    if (!handle) {
      kept.push(item);
      keptIds.add(item.id);
      continue;
    }
    if ((counts[handle] || 0) < cap) {
      counts[handle] = (counts[handle] || 0) + 1;
      kept.push(item);
      keptIds.add(item.id);
    } else {
      overflow.push(item);
    }
  }
  const alternates = [...(pool || [])].filter(xEligible).sort(cmp);
  for (const item of overflow) {
    const covered = kept.some((chosen) => chosen.id !== item.id && xAccountHandle(chosen) !== xAccountHandle(item) && sameXEvent(item, chosen));
    if (covered) continue;
    const alternate = alternates.find((other) => {
      if (other.id === item.id || keptIds.has(other.id)) return false;
      const handle = xAccountHandle(other);
      if (!handle || handle === xAccountHandle(item) || (counts[handle] || 0) >= cap) return false;
      return sameXEvent(item, other);
    });
    if (!alternate) continue;
    counts[xAccountHandle(alternate)] = (counts[xAccountHandle(alternate)] || 0) + 1;
    keptIds.add(alternate.id);
    kept.push(alternate);
  }
  return diversify(kept.sort(cmp));
}

function parsePublished(value) {
  const text = String(value || "").trim();
  if (!/T\d{2}:\d{2}/.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function asDate(now) {
  const date = now instanceof Date ? now : new Date(now || Date.now());
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function hoursSince(stamp, now) {
  const ms = Date.parse(String(stamp || ""));
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - ms) / 36e5;
}

export function breakingBoost(publishedAt, now = new Date()) {
  const published = parsePublished(publishedAt);
  if (published == null) return 0;
  const ageHours = (asDate(now).getTime() - published) / 36e5;
  if (!Number.isFinite(ageHours) || ageHours >= BREAKING_ZERO_HOURS) return 0;
  if (ageHours <= BREAKING_FULL_HOURS) return BREAKING_MAX_BOOST;
  const span = BREAKING_ZERO_HOURS - BREAKING_FULL_HOURS;
  return BREAKING_MAX_BOOST * (1 - (ageHours - BREAKING_FULL_HOURS) / span);
}

export function leadScore(item, now = new Date()) {
  const base = Number(item?.significance) || 0;
  if (base < LEAD_WORTHY_FLOOR) return base;
  return base * (1 + breakingBoost(item?.published_at, now));
}

// sameXEvent reads a DOI only when punctuation or the end of the string follows
// it. A stored DOI usually has a space after it, so mark it for that matcher
// without changing the matcher the X-account cap uses.
function withEventMarks(item) {
  const doi = String(item?.doi || "").trim().replace(/[.,;]+$/, "");
  if (!/^10\.\d{4,9}\/\S+$/i.test(doi)) return item;
  return { ...item, doi: `${doi}.` };
}

function sameLeadEvent(left, right) {
  return sameXEvent(withEventMarks(left), withEventMarks(right));
}

function eventKey(item) {
  const marked = withEventMarks(item);
  const ids = [...eventIds(marked)];
  if (ids.length) return ids[0];
  const url = storyUrl(marked);
  if (url) return `url:${url}`;
  return `text:${[...headlineTokens(marked?.headline)].sort().join(" ")}`;
}

function recordAsItem(record) {
  return {
    id: record?.itemId,
    headline: record?.headline || "",
    doi: record?.doi || "",
    linked_url: record?.canonicalUrl || "",
    source_url: record?.sourceUrl || record?.canonicalUrl || "",
  };
}

function leadRecords(state) {
  return Array.isArray(state?.leads) ? state.leads : [];
}

function sameEventRecord(item, record) {
  return sameLeadEvent(item, recordAsItem(record));
}

function earliestEventRecord(item, records) {
  return records
    .filter((record) => sameEventRecord(item, record))
    .sort((a, b) => String(a.eventFirstLeadAt).localeCompare(String(b.eventFirstLeadAt)))[0] || null;
}

function eventLocked(item, records, now) {
  return records.some((record) => sameEventRecord(item, record) && hoursSince(record.eventFirstLeadAt, now) >= LEAD_EVENT_WINDOW_HOURS);
}

function itemClockOpen(item, records, now) {
  const prior = records.find((record) => record.itemId === item.id);
  if (!prior) return true;
  return hoursSince(prior.firstLeadAt, now) < LEAD_MAX_ITEM_HOURS;
}

function leadWorthy(item) {
  return Boolean(item) && !item.drop && Number(item.significance) >= LEAD_WORTHY_FLOOR;
}

function byLeadScore(now) {
  return (a, b) => leadScore(b, now) - leadScore(a, now) || cmp(a, b);
}

function blankState(records = []) {
  return { schema: "biocat-lead-state/1", leads: records };
}

function rememberLead(item, records, now, eventFirstLeadAt) {
  const nowIso = now.toISOString();
  const priorItem = records.find((record) => record.itemId === item.id);
  const priorEvent = earliestEventRecord(item, records);
  const next = {
    itemId: item.id,
    canonicalUrl: storyUrl(item) || canonUrl(item.source_url || ""),
    eventKey: priorEvent?.eventKey || eventKey(item),
    firstLeadAt: priorItem?.firstLeadAt || nowIso,
    eventFirstLeadAt: eventFirstLeadAt || priorEvent?.eventFirstLeadAt || nowIso,
    publishedAt: item.published_at || "",
    headline: item.headline || "",
    doi: item.doi || "",
    sourceUrl: item.source_url || "",
  };
  const leads = records.filter((record) => record.itemId !== item.id);
  leads.push(next);
  return blankState(leads);
}

export function assignLead(items, state = {}, now = new Date()) {
  const clock = asDate(now);
  const records = leadRecords(state);
  const list = [...(items || [])];
  const current = [...records].sort((a, b) => String(b.firstLeadAt).localeCompare(String(a.firstLeadAt)))[0] || null;
  const eligible = list.filter((item) => leadWorthy(item) && !eventLocked(item, records, clock) && itemClockOpen(item, records, clock));
  let chosen = null;
  let eventFirstLeadAt = null;

  if (current) {
    const incumbent = list.find((item) => item.id === current.itemId) || null;
    const eventOpen = hoursSince(current.eventFirstLeadAt, clock) < LEAD_EVENT_WINDOW_HOURS;
    const incumbentOk = Boolean(incumbent) && eventOpen && leadWorthy(incumbent) && itemClockOpen(incumbent, records, clock)
      && hoursSince(current.firstLeadAt, clock) < LEAD_MAX_ITEM_HOURS;
    const priorPublished = parsePublished(current.publishedAt);
    const newer = eventOpen ? list.filter((item) => {
      if (!leadWorthy(item) || item.id === current.itemId || !itemClockOpen(item, records, clock)) return false;
      if (!sameEventRecord(item, current)) return false;
      const published = parsePublished(item.published_at);
      return published != null && priorPublished != null && published > priorPublished;
    }).sort(byLeadScore(clock)) : [];
    if (newer[0]) {
      chosen = newer[0];
      eventFirstLeadAt = current.eventFirstLeadAt;
    } else if (incumbentOk) {
      chosen = incumbent;
      eventFirstLeadAt = current.eventFirstLeadAt;
    } else {
      const expiredEvent = eventOpen ? recordAsItem(current) : null;
      chosen = eligible
        .filter((item) => {
          if (incumbent && item.id === incumbent.id) return false;
          if (expiredEvent && sameLeadEvent(item, expiredEvent)) return false;
          return true;
        })
        .sort(byLeadScore(clock))[0] || null;
    }
  } else {
    chosen = eligible.slice().sort(byLeadScore(clock))[0] || null;
  }

  if (!chosen) return { items: list, state: blankState(records) };
  const rest = list.filter((item) => item.id !== chosen.id);
  return { items: [chosen, ...rest], state: rememberLead(chosen, records, clock, eventFirstLeadAt) };
}
