import { assertFactual, clip, httpUrl } from "./text.mjs";

export const OUTCOME_CLAIM = /\b(effective|efficacy|superior|improved|benefit|success|safe and well)\b/i;

const JOURNAL_OK = new Set([
  "nature",
  "science",
  "cell",
  "the lancet",
  "lancet",
  "lancet oncology",
  "the lancet oncology",
  "jama",
  "jama oncology",
  "new england journal of medicine",
  "nature medicine",
  "nature biotechnology",
  "bmj",
  "the bmj",
]);

const FDA_KINDS = {
  "fda-nme": ["original approval", "Type 1 approval"],
  "fda-bla": ["original biologics license approval", "BLA approval"],
  "fda-biosimilar": ["biosimilar approval", "351(k) approval"],
  "fda-orig": ["original NDA approval", "NDA approval"],
  "fda-efficacy": ["efficacy supplement approval", "efficacy supplement"],
  "fda-anda": ["ANDA approval", "abbreviated approval"],
};

export function hashId(id) {
  let hash = 2166136261;
  const text = String(id || "");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function compose(id, templates) {
  const list = templates.filter(Boolean);
  if (!list.length) return null;
  const start = hashId(id) % list.length;
  for (let i = 0; i < list.length; i++) {
    const made = list[(start + i) % list.length]();
    if (made && String(made.headline || "").trim() && String(made.blurb || "").trim()) return made;
  }
  return null;
}

export function sentences(...parts) {
  const out = [];
  const seen = new Set();
  for (const part of parts.flat()) {
    const text = String(part || "").replace(/\s+/g, " ").trim().replace(/\.+$/, "");
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${text}.`);
    if (out.length === 2) break;
  }
  return out.join(" ");
}

export function joinName(brand, ingredient) {
  const left = String(brand || "").trim();
  const right = String(ingredient || "").trim();
  if (left && right && left.toLowerCase() !== right.toLowerCase()) return `${left} (${right})`;
  return left || right || "";
}

export function lowerFirst(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function leadIn(value) {
  const text = sentenceCase(stripVenue(value));
  const first = (text.split(/\s+/)[0] || "").replace(/[^A-Za-z]/g, "");
  const caps = first.replace(/[^A-Z]/g, "").length;
  if (first.length >= 2 && caps / first.length >= 0.6) return text;
  return lowerFirst(text);
}

export function usd(amount) {
  const n = Math.round(Number(amount));
  if (!Number.isFinite(n) || n <= 0) return "";
  return `$${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function indicationPhrase(raw) {
  let text = String(raw || "").replace(/<[^>]+>/g, " ").replace(/[•●]/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/^\d+\s*INDICATIONS AND USAGE\s*/i, "");
  text = text.replace(/\(\s*\d+(?:\.\d+)?\s*\)/g, " ");
  let phrase = "";
  const treat = /\bfor ((?:the )?treatment of [^:]{8,240})/i.exec(text);
  if (treat) phrase = treat[1];
  else {
    const match = /\bindicated(?:\s+for|:)\s+([^:]{8,240})/i.exec(text);
    if (match) phrase = match[1];
  }
  if (!phrase) return "";
  phrase = phrase.split(/\.(?:\s|$)|(?:\s+who\s+)/i)[0].replace(/\s+/g, " ").trim().replace(/[,\s]+$/g, "");
  if (phrase.length > 110) {
    const cut = phrase.slice(0, 110);
    const space = cut.lastIndexOf(" ");
    phrase = (space > 40 ? cut.slice(0, space) : cut).trim();
  }
  if (phrase.length < 8) return "";
  if (OUTCOME_CLAIM.test(phrase) || /\b(cure|breakthrough|miracle|promising)\b/i.test(phrase)) return "";
  return lowerFirst(phrase);
}

export function areaFromClass(value) {
  return String(value || "").replace(/\s*\[[^\]]+\]\s*$/g, "").replace(/\s+/g, " ").trim();
}

export function unescapeBasic(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(body, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(body);
  return match ? match[1].trim() : "";
}

function atomLink(body) {
  let fallback = "";
  for (const tag of body.matchAll(/<link\b([^>]*)\/?>/gi)) {
    const href = /href=["']([^"']+)["']/i.exec(tag[1] || "");
    if (!href) continue;
    const rel = /rel=["']([^"']+)["']/i.exec(tag[1] || "");
    if (!rel || rel[1] === "alternate") return decodeXml(href[1]);
    if (!fallback) fallback = decodeXml(href[1]);
  }
  return fallback;
}

export function rssEntries(xml) {
  const text = String(xml || "");
  const chunks = [];
  for (const part of text.split(/<item\b[^>]*>/i).slice(1)) chunks.push(part.split(/<\/item>/i)[0]);
  for (const part of text.split(/<entry\b[^>]*>/i).slice(1)) chunks.push(part.split(/<\/entry>/i)[0]);
  return chunks.map((body) => ({
    title: decodeXml(tagText(body, "title")),
    link: decodeXml(tagText(body, "link")) || atomLink(body),
    date: decodeXml(tagText(body, "pubDate") || tagText(body, "updated") || tagText(body, "dc:date")),
    description: decodeXml(tagText(body, "description") || tagText(body, "summary") || tagText(body, "content")),
  })).filter((row) => row.title);
}

export function isoFromRfc822(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

export function preferHttps(url) {
  return String(url || "").replace(/^http:\/\/((?:www\.)?(?:fda\.gov|nih\.gov|sec\.gov|ncbi\.nlm\.nih\.gov|reporter\.nih\.gov))\b/i, "https://$1");
}

export function pressProduct(description) {
  const text = String(description || "").replace(/\s+/g, " ").trim();
  const match = /\bapproved\s+([^.]{3,180})/i.exec(text);
  if (!match) return "";
  let phrase = match[1].split(/\b(?:to reduce|to help|for the treatment|for use|the first)\b/i)[0];
  phrase = phrase.split(",")[0].replace(/[.\s]+$/g, "").trim();
  if (phrase.length < 3 || phrase.length > 100) return "";
  if (OUTCOME_CLAIM.test(phrase) || /\b(cure|breakthrough|miracle|promising)\b/i.test(phrase)) return "";
  return phrase;
}

export function journalAllowed(name) {
  return JOURNAL_OK.has(String(name || "").trim().toLowerCase());
}

export const HEADLINE_WORD_TARGET = 12;
export const HEADLINE_WORD_MAX = 14;

export function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

const HEADLINE_TRAILS = [
  /\s+in\s+(?:adult|adults|pediatric|paediatric|children|patients|people|women|men|healthy|certain|persons|individuals)\b[^:]*$/i,
  /\s+without\b[^:]*$/i,
  /\s+who\b[\s\S]*$/i,
  /\s+when\b[\s\S]*$/i,
  /\s+where\b[\s\S]*$/i,
  /\s+which\b[\s\S]*$/i,
  /\s+that\b[\s\S]*$/i,
  /\s+associated\b[\s\S]*$/i,
  /\s+related\b[\s\S]*$/i,
  /\s+following\b[\s\S]*$/i,
  /\s+using\b[\s\S]*$/i,
  /\s+via\b[\s\S]*$/i,
  /\s+among\b[\s\S]*$/i,
  /\s+during\b[\s\S]*$/i,
  /\s+after\b[\s\S]*$/i,
  /\s+before\b[\s\S]*$/i,
  /\s+across\b[\s\S]*$/i,
  /\s+between\b[\s\S]*$/i,
  /\s+through\b[\s\S]*$/i,
  /\s+from\b[\s\S]*$/i,
  /\s+of the\b[\s\S]*$/i,
  /\s+with\s+(?:overweight|obesity)\b[\s\S]*$/i,
];

const HEADLINE_LATE_TRAILS = [
  /\s+for\b[^:]*$/i,
  /\s+to\b[^:]*$/i,
];

function headlineCuts(text, { late = false } = {}) {
  const cuts = [];
  const add = (index, skip, minRight) => {
    const left = text.slice(0, index).replace(/[\s,:;—–-]+$/g, "").trim();
    const right = text.slice(index + skip).replace(/^[\s,:;—–-]+/g, "").trim();
    const n = wordCount(left);
    if (left && right && wordCount(right) >= minRight && n >= 4 && n < wordCount(text)) cuts.push({ left, right, n });
  };
  for (const match of text.matchAll(/\s*[:;]\s+/g)) add(match.index, match[0].length, 5);
  for (const match of text.matchAll(/\s+[–—]\s+/g)) add(match.index, match[0].length, 5);
  for (const match of text.matchAll(/\s+-\s+/g)) add(match.index, match[0].length, 5);
  for (const match of text.matchAll(/,\s+/g)) add(match.index, match[0].length, 1);
  for (const pattern of HEADLINE_TRAILS) {
    const match = pattern.exec(text);
    if (match) add(match.index, 0, 1);
  }
  if (late) {
    for (const pattern of HEADLINE_LATE_TRAILS) {
      const match = pattern.exec(text);
      if (match) add(match.index, 0, 1);
    }
  }
  return cuts;
}

export function compactIndication(phrase, maxWords = 6) {
  const original = String(phrase || "").replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  let text = original;
  const lead = /^(?:the\s+)?treatment\s+of\s+(?:(?:adults|adult|patients|children|people)\s+with\s+)?/i.exec(text);
  if (lead && lead[0].length < text.length) text = text.slice(lead[0].length).trim();
  const cut = shortenHeadline(text, maxWords, maxWords);
  const changed = cut.headline.toLowerCase() !== original.toLowerCase();
  return { core: cut.headline, extra: changed ? original : "" };
}

export function shortenPaperHeadline(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  if (wordCount(text) <= HEADLINE_WORD_MAX) return { headline: text, extra: "" };
  const cuts = [];
  const add = (index, skip) => {
    const left = text.slice(0, index).replace(/[\s,:;—–-]+$/g, "").trim();
    const right = text.slice(index + skip).replace(/^[\s,:;—–-]+/g, "").trim();
    const n = wordCount(left);
    if (left && right && n >= 6 && n <= HEADLINE_WORD_MAX) cuts.push({ left, right, n });
  };
  for (const match of text.matchAll(/\s*[:;]\s+/g)) add(match.index, match[0].length);
  for (const match of text.matchAll(/\s+[–—]\s+/g)) add(match.index, match[0].length);
  for (const match of text.matchAll(/,\s+/g)) add(match.index, match[0].length);
  for (const pattern of [/\s+of\b/gi, /\s+for\b/gi, /\s+from\b/gi, /\s+to\b/gi, /\s+with\b/gi, /\s+in\b/gi, /\s+after\b/gi, /\s+using\b/gi, /\s+via\b/gi]) {
    for (const match of text.matchAll(pattern)) add(match.index, 0);
  }
  if (cuts.length) {
    cuts.sort((a, b) => b.n - a.n);
    return { headline: cuts[0].left, extra: cuts[0].right };
  }
  const words = text.split(/\s+/);
  const dangling = new Set(["a", "an", "the", "of", "and", "or", "for", "to", "in", "with", "on", "by", "from", "as"]);
  let keep = Math.min(HEADLINE_WORD_MAX, words.length);
  while (keep > 6 && dangling.has(words[keep - 1].toLowerCase().replace(/[^a-z]/g, ""))) keep -= 1;
  return { headline: words.slice(0, keep).join(" "), extra: words.slice(keep).join(" ") };
}

export function shortenHeadline(value, target = HEADLINE_WORD_TARGET, hardMax = HEADLINE_WORD_MAX) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  const removed = [];
  const peel = (limit, late) => {
    const choices = headlineCuts(text, { late }).filter((cut) => cut.n <= limit);
    if (!choices.length) return false;
    choices.sort((a, b) => b.n - a.n);
    text = choices[0].left;
    removed.unshift(choices[0].right);
    return true;
  };
  let guard = 0;
  while (wordCount(text) > target && guard < 6) {
    if (!peel(target, false)) break;
    guard += 1;
  }
  while (wordCount(text) > hardMax && guard < 10) {
    if (!peel(hardMax, true)) break;
    guard += 1;
  }
  if (wordCount(text) > hardMax) {
    const words = text.split(/\s+/);
    const dangling = new Set(["a", "an", "the", "of", "and", "or", "for", "to", "in", "with", "on", "by", "from", "as"]);
    let keep = hardMax;
    while (keep > 4 && dangling.has(words[keep - 1].toLowerCase().replace(/[^a-z]/g, ""))) keep -= 1;
    const left = words.slice(0, keep).join(" ");
    const right = words.slice(keep).join(" ");
    if (right) removed.unshift(right);
    text = left;
  }
  return {
    headline: text.replace(/[\s,:;—–-]+$/g, "").trim(),
    extra: removed.join(" ").replace(/\s+/g, " ").trim(),
  };
}

function firstSentence(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const match = /^(.+?\.)(?:\s+|$)/.exec(text);
  return match ? match[1] : text;
}

export function makeItem(fields) {
  let raw = stripVenue(fields.headline);
  raw = raw.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => humanDate(iso) || iso);
  raw = sentenceCase(raw);
  const shortened = fields.source_type === "paper"
    ? shortenPaperHeadline(raw)
    : (fields.source_type === "trial" || fields.source_type === "news" || fields.source_type === "regulator" || wordCount(raw) <= HEADLINE_WORD_MAX)
      ? { headline: raw, extra: "" }
      : shortenHeadline(raw);
  const fragment = /^(in|for|to|with|of|from|through|by|on|at|into|via)\b/i.test(shortened.extra || "");
  if (danglingEnd(shortened.headline) || (fragment && wordCount(raw) <= HEADLINE_WORD_MAX)) {
    shortened.headline = raw;
    shortened.extra = "";
  } else if (fragment) {
    shortened.extra = "";
  }
  if (wordCount(shortened.headline) > HEADLINE_WORD_MAX) {
    const words = shortened.headline.split(/\s+/);
    let keep = HEADLINE_WORD_MAX;
    while (keep > 6 && danglingEnd(words.slice(0, keep).join(" "))) keep -= 1;
    shortened.headline = words.slice(0, keep).join(" ");
    shortened.extra = "";
  }
  shortened.headline = sentenceCase(shortened.headline);
  let blurbSource = fields.blurb || "";
  if (shortened.extra && !/^(in|for|to|with|of|from|through|by|on|at|into|via)\b/i.test(shortened.extra)) {
    const extra = shortened.extra.replace(/\s+/g, " ").trim();
    const probe = extra.toLowerCase().slice(0, 40);
    if (extra && !blurbSource.toLowerCase().includes(probe)) blurbSource = sentences(extra, firstSentence(blurbSource));
  }
  const headline = clip(shortened.headline, 220).replace(/\.{2,}/g, ".");
  const blurb = clip(blurbSource, 420).replace(/\.{2,}/g, ".");
  if (!headline.trim() || !blurb.trim()) return null;
  assertFactual(headline, fields.id);
  assertFactual(blurb, fields.id);
  const source_url = httpUrl(fields.source_url);
  if (!source_url || !/^\d{4}-\d{2}-\d{2}$/.test(fields.published_at)) return null;
  return {
    id: fields.id,
    headline,
    blurb,
    source_url,
    source_type: fields.source_type,
    source_name: fields.source_name,
    published_at: fields.published_at,
    scout_source: fields.scout_source,
    rule: fields.rule,
    adjustments: fields.adjustments || [],
    dedupe_key: fields.dedupe_key || fields.id,
  };
}

export function safeItems(rows) {
  const out = [];
  for (const row of rows) {
    try {
      const made = makeItem(row);
      if (made) out.push(made);
    } catch {
      /* A generated line failed the factual check. Drop it rather than rewrite it. */
    }
  }
  return out;
}

function kindOf(rule, id) {
  const list = FDA_KINDS[rule] || ["approval"];
  return list[hashId(`${id}:kind`) % list.length];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CONDITION_RULES = [
  [/head and neck squamous cell carcinoma/i, "head and neck cancer"],
  [/non[-\s]?squamous non[-\s]?small cell lung cancer/i, "a common form of lung cancer"],
  [/non[-\s]?small cell lung cancer|\bnsclc\b/i, "a common form of lung cancer"],
  [/hypertension/i, "high blood pressure"],
  [/chronic hepatitis b\b/i, "chronic hepatitis B"],
  [/alzheimer(?:'s)? disease/i, "Alzheimer's disease"],
  [/type 2 diabetes(?: mellitus)?/i, "type 2 diabetes"],
];

export function humanDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return "";
  return `${month} ${Number(match[3])}`;
}

export function sentenceCase(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function stripVenue(value) {
  return String(value || "").replace(/^(?:jama|int j oncol|cytotechnology|biorxiv|medrxiv|nature medicine|nature biotechnology|nature|science|cell|the lancet|bmj|arxiv)\s*:\s+/i, "").trim();
}

export function danglingEnd(value) {
  return /\b(in|for|to|with|of|and|or|a|an|the|through|from|by|on|at|into|via|across|over|under|after|before|during)$/i.test(String(value || "").trim());
}

export function plainCondition(phrase) {
  let text = String(phrase || "").replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  text = text.replace(/^(?:the\s+)?treatment of\s+/i, "");
  text = text.replace(/^(?:adults|adult patients|patients|children|people)\s+with\s+/i, "");
  const adults = /\bin adults\b/i.test(text);
  for (const [pattern, plain] of CONDITION_RULES) {
    if (pattern.test(text)) return adults && !/in adults/i.test(plain) ? `${plain} in adults` : plain;
  }
  text = text.replace(/\s+in adult patients\b[\s\S]*$/i, "").replace(/\s+without\b[\s\S]*$/i, "").trim();
  if (wordCount(text) > 8) {
    const cut = text.split(/,|:/)[0].trim();
    text = wordCount(cut) >= 2 && wordCount(cut) <= 8 ? cut : text.split(/\s+/).slice(0, 6).join(" ");
  }
  return text;
}

export function sponsorShort(name) {
  let text = String(name || "").replace(/\s+/g, " ").trim();
  text = text.replace(/\b(l\.?l\.?c\.?|inc\.?|incorporated|ltd\.?|limited|gmbh|a\.?g\.?|a\.?b\.?|s\.?a\.?|n\.?v\.?|p\.?l\.?c\.?|b\.?v\.?|corp\.?|corporation|company|co\.?)\b/gi, " ");
  text = text.replace(/\b(healthcare|health care|pharmaceuticals|pharmaceutical|pharma|laboratories|labs|llc)\b/gi, " ");
  text = text.replace(/[^A-Za-z0-9&.\- ]/g, " ").replace(/\s+/g, " ").trim();
  const words = text.split(" ").filter(Boolean).slice(0, 2);
  return words.join(" ");
}

export function possessive(name) {
  const short = sponsorShort(name);
  if (!short) return "";
  return /s$/i.test(short) ? `${short}'` : `${short}'s`;
}

export function offTopicText(value) {
  return /\b(estimands?|tale of two|microsoft outage|services during|new blog for science|cuda at 20|scientific computing|supercomput|slurm|mlperf|photonics|quantum computing|evidence gaps|public involvement)\b/i.test(String(value || ""));
}

export function blurbStartsMetadata(value) {
  return /^(accession|cik\b|authors listed|card fields|europe pmc|item dated|section headings include|indexed as)\b/i.test(String(value || "").trim());
}

function fitLead(options) {
  const ready = options.map((line) => sentenceCase(line)).filter((line) => line && wordCount(line) <= HEADLINE_WORD_MAX && !danglingEnd(line) && !/^[a-z]/.test(line));
  return ready[0] || sentenceCase(options[options.length - 1] || "");
}

export function fdaApprovalCopy(id, facts) {
  const inn = String(facts.ingredient || "").toLowerCase();
  const who = facts.brand ? (inn ? `${facts.brand} (${inn})` : facts.brand) : (inn || "");
  const owner = possessive(facts.sponsor);
  const named = owner && facts.brand ? `${owner} ${who}` : who;
  const focus = facts.indication ? plainCondition(facts.indication) : "";
  const nme = /new molecular entity|\btype\s*1\b/i.test(facts.desc || "");
  const classBit = nme ? ", a new molecular entity" : "";
  const why = focus
    ? `The FDA approval covers ${facts.indication.replace(/\.$/, "")}.`
    : (nme ? `${who || "The medicine"} is listed as a new molecular entity.` : "The FDA record does not list a condition.");
  const tail = [facts.sponsor ? `${facts.sponsor} is the sponsor` : "", facts.app || "", facts.published ? `approved ${humanDate(facts.published)}` : ""].filter(Boolean).join(". ");
  const blurb = sentences(why, tail);
  const templates = [];
  const product = facts.brand || who;
  if (named && focus) {
    templates.push(() => ({ headline: fitLead([`FDA approves ${named} for ${focus}`, `FDA approves ${product} for ${focus}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`${owner ? `${owner} ${product}` : product} wins FDA approval for ${focus}`, `FDA approves ${product} for ${focus}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`FDA approves ${named}${classBit} for ${focus}`, `FDA approves ${product} for ${focus}`]), blurb }));
  } else if (named && nme) {
    templates.push(() => ({ headline: fitLead([`FDA approves ${named}${classBit}`, `FDA approves ${facts.brand || who}, a new molecular entity`]), blurb }));
    templates.push(() => ({ headline: fitLead([`FDA approves ${named}${classBit}`, `FDA approves ${facts.brand || who}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`${owner || "The sponsor"} gets FDA approval for ${facts.brand || who}${classBit}`, `FDA approves ${facts.brand || who}`]), blurb }));
  } else if (named) {
    templates.push(() => ({ headline: fitLead([`FDA approves ${named}`, `FDA approves ${facts.brand || who}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`${facts.brand || who} clears an FDA review`, `FDA approves ${facts.brand || who}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`${owner || "A sponsor"} gets FDA approval for ${facts.brand || who}`, `FDA approves ${facts.brand || who}`]), blurb }));
  } else {
    templates.push(() => ({ headline: "FDA approves a new medicine with no brand listed", blurb }));
    templates.push(() => ({ headline: "New FDA approval has no brand name yet", blurb }));
    templates.push(() => ({ headline: "FDA posts an approval before the brand name", blurb }));
  }
  return compose(id, templates);
}

export function crlCopy(id, facts) {
  const company = facts.company || "the sponsor";
  const owner = possessive(facts.company);
  const product = facts.product || "";
  const topics = facts.topics || [];
  const topicText = topics.length ? topics.join(" and ") : "";
  const why = "A complete response letter means the application was not approved as submitted.";
  const detail = topicText ? `The letter's headings name ${topicText}.` : "";
  const tail = [facts.apps ? `Application ${facts.apps}` : "", facts.published ? `Letter date ${humanDate(facts.published)}` : ""].filter(Boolean).join(". ");
  const blurb = sentences(why, detail, tail);
  const named = product ? `${owner || company} ${product}` : "";
  const templates = [
    () => ({ headline: fitLead([product ? `FDA rejects ${named} application${topicText ? `, citing ${topicText} issues` : ""}` : `FDA sends ${company} a complete response letter`, `FDA sends ${company} a complete response letter`]), blurb }),
    () => ({ headline: fitLead([`FDA sends ${company} a complete response letter`]), blurb }),
    () => ({ headline: fitLead([`${company} receives an FDA complete response letter`, `FDA sends ${company} a complete response letter`]), blurb }),
  ];
  return compose(id, templates);
}

export function orangeCopy(id, facts) {
  const who = facts.who;
  const codeLine = `Last unexpired listing is ${facts.kind} ${facts.code}`.trim();
  const caveat = facts.kind === "patent" ? "Listed patents are not verified by FDA" : "Exclusivity date is the Orange Book listing";
  const applicant = facts.applicant ? `Applicant listed as ${facts.applicant}` : "";
  const templates = [
    () => ({ headline: `${who} (NDA ${facts.applNo}): Orange Book last listed protection ${facts.date}`, blurb: sentences(applicant, codeLine) }),
    () => ({ headline: `Orange Book last listed protection for ${who} is ${facts.date}`, blurb: sentences(codeLine, caveat) }),
    () => ({ headline: `${who}: Orange Book protection date ${facts.date}`, blurb: sentences(`NDA ${facts.applNo}`, applicant || codeLine) }),
  ];
  return compose(id, templates);
}

export function purpleCopy(id, facts) {
  const who = facts.who;
  const applicant = facts.applicant ? facts.applicant : "";
  const license = facts.license ? `License type ${facts.license}` : "";
  const tail = [facts.bla ? `BLA ${facts.bla}` : "", facts.published ? `date ${humanDate(facts.published) || facts.published}` : "", applicant].filter(Boolean).join(", ");
  const templates = [];
  if (facts.event === "revoked") {
    const blurb = sentences(`The Purple Book lists ${who} licensure as ${facts.licensure}`, tail || license);
    templates.push(() => ({ headline: fitLead([`FDA lists ${who} licensure as ${facts.licensure}`, `${who} licensure listed as ${facts.licensure}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`${who}: Purple Book licensure is ${facts.licensure}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`Purple Book change for ${who}: ${facts.licensure}`]), blurb }));
  } else if (facts.event === "interchangeable") {
    const ref = facts.ref ? ` with ${facts.ref}` : "";
    const blurb = sentences(`The Purple Book lists ${who} as interchangeable${ref}`, tail || license);
    templates.push(() => ({ headline: fitLead([`FDA lists ${who} as interchangeable${ref}`, facts.ref ? `${who} interchangeable with ${facts.ref}` : `${who} listed as interchangeable`]), blurb }));
    templates.push(() => ({ headline: fitLead([facts.ref ? `${who} interchangeable with ${facts.ref} in the Purple Book` : `${who} listed as interchangeable in the Purple Book`]), blurb }));
    templates.push(() => ({ headline: fitLead([`Purple Book: ${who} is interchangeable${ref}`]), blurb }));
  } else {
    const substance = facts.substance && facts.substance.toLowerCase() !== who.toLowerCase() ? ` (${facts.substance})` : "";
    const blurb = sentences(`The Purple Book records a new biologics license for ${who}${substance}`, tail || license);
    templates.push(() => ({ headline: fitLead([`Purple Book lists a new license for ${who}`, `Purple Book adds ${who}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`${who}${substance} gets a Purple Book license`, `Purple Book adds ${who}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`Purple Book adds ${who}${substance}`]), blurb }));
  }
  return compose(id, templates);
}

function shortCommittee(name) {
  const text = String(name || "").replace(/\s+/g, " ").trim();
  const cut = text.replace(/\s+of the\b[\s\S]*$/i, "").trim();
  return cut || text;
}

export function adcomCopy(id, facts) {
  const committee = shortCommittee(facts.committee);
  const full = facts.committee && facts.committee !== committee ? facts.committee : "";
  const when = facts.kind === "cancel" ? "" : facts.meeting;
  const lead = {
    meeting: `FDA advisory meeting ${facts.meeting}: ${committee}`,
    postpone: `FDA advisory meeting postponed to ${facts.meeting}: ${committee}`,
    cancel: `FDA advisory meeting cancelled: ${committee}`,
    amendment: `FDA advisory meeting amended for ${facts.meeting}: ${committee}`,
  }[facts.kind];
  const alt = {
    meeting: `${committee}: FDA advisory meeting ${facts.meeting}`,
    postpone: `${committee} postponed to ${facts.meeting}`,
    cancel: `${committee} meeting cancelled`,
    amendment: `${committee} notice amended ${facts.meeting}`,
  }[facts.kind];
  const detail = facts.rest ? clip(facts.rest, 180).replace(/[.\s]+$/g, "") : "";
  const templates = [
    () => ({ headline: lead, blurb: sentences(full || detail, `Federal Register publication date ${facts.published}`) }),
    () => ({ headline: alt, blurb: sentences(`Federal Register publication date ${facts.published}`, full || detail || "FDA advisory committee meeting notice") }),
    () => ({ headline: when ? `${facts.meeting}: ${committee}` : `${committee} advisory committee notice`, blurb: sentences(full || detail, `Federal Register publication date ${facts.published}`) }),
  ];
  return compose(id, templates);
}

export function emaCopy(id, facts) {
  const brand = unescapeBasic(facts.name);
  const inn = unescapeBasic(facts.inn || "");
  const name = inn ? `${inn} (${brand})` : brand;
  const event = facts.event;
  const fullIndication = facts.indication ? unescapeBasic(facts.indication).replace(/\.+$/, "") : "";
  const focus = fullIndication ? plainCondition(fullIndication) : "";
  const owner = possessive(unescapeBasic(facts.holder || ""));
  const named = owner && brand ? `${owner} ${brand}` : name;
  const why = fullIndication
    ? `The European record covers ${lowerFirst(fullIndication)}.`
    : `This is an EMA ${event.toLowerCase()}.`;
  const extra = focus && /lung cancer/i.test(focus) && /non-?small|nsclc/i.test(fullIndication) ? "NSCLC is a common form of lung cancer" : "";
  const holder = facts.holder ? `${unescapeBasic(facts.holder)} is the applicant` : "";
  const group = facts.group ? unescapeBasic(facts.group) : "";
  const detail = [extra, holder, group, facts.productNumber ? `EMA product number ${facts.productNumber}` : ""].filter(Boolean).join(". ");
  const blurb = sentences(why, detail);
  const templates = [];
  const positive = facts.rule === "ema-opinion" || facts.rule === "ema-authorisation";
  if (positive && focus) {
    templates.push(() => ({ headline: fitLead([`Europe backs ${named} for ${focus}`, `EU recommends ${name} for ${focus}`, `Europe recommends ${brand} for ${focus}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`EU recommends ${name} for ${focus}`, `Europe backs ${brand} for ${focus}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`Europe recommends ${named} for ${focus}`, `Europe backs ${brand} for ${focus}`]), blurb }));
  } else {
    templates.push(() => ({ headline: fitLead([`${event} for ${brand}`, `${brand}: ${event}`]), blurb }));
    templates.push(() => ({ headline: fitLead([`${brand}: ${event}`]), blurb }));
    templates.push(() => ({ headline: fitLead([facts.rule === "ema-lapse" ? `EMA lists a status change for ${brand}` : `${event} for ${brand}`]), blurb }));
  }
  return compose(id, templates);
}

export function healthCanadaCopy(id, facts) {
  const who = joinName(facts.brand, facts.ingredient) || `NOC ${facts.notice}`;
  const area = facts.therapeuticClass ? `, ${facts.therapeuticClass}` : "";
  const maker = facts.manufacturer ? `Manufacturer listed as ${facts.manufacturer}` : "";
  const notice = `Notice ${facts.notice}, date ${facts.published}`;
  const reason = facts.reason ? `Submission reason listed as ${facts.reason}` : "";
  const licence = "Source: Health Canada Notice of Compliance Database, Open Government Licence – Canada";
  const templates = facts.therapeuticClass
    ? [
      () => ({ headline: `${who} (${facts.therapeuticClass}): Health Canada ${facts.kind}`, blurb: sentences(maker, reason || notice) }),
      () => ({ headline: `Health Canada notice of compliance: ${who} for ${facts.therapeuticClass}`, blurb: sentences(notice, maker || licence) }),
      () => ({ headline: `${who}, ${facts.therapeuticClass}`, blurb: sentences(`${facts.kind}, notice ${facts.notice}`, maker || licence) }),
    ]
    : [
      () => ({ headline: `Health Canada notice of compliance: ${who} (${facts.kind}${area})`, blurb: sentences(maker, reason || notice) }),
      () => ({ headline: `${who}: Health Canada ${facts.kind}`, blurb: sentences(notice, reason || licence) }),
      () => ({ headline: `${who} receives a Health Canada notice of compliance`, blurb: sentences(`${facts.kind}, notice ${facts.notice}`, maker || licence) }),
    ];
  return compose(id, templates);
}

export function paperCopy(id, facts) {
  const title = sentenceCase(stripVenue(facts.title));
  const journal = facts.journal || "";
  const finding = `The paper reports ${leadIn(title)}`;
  const where = [journal ? `published in ${journal}` : "", facts.date ? `first published ${facts.date}` : "", facts.recordId ? `record ${facts.recordId}` : ""].filter(Boolean).join(", ");
  const blurb = sentences(finding, where);
  const templates = [
    () => ({ headline: title, blurb }),
    () => ({ headline: title, blurb }),
    () => ({ headline: title, blurb }),
  ];
  return compose(id, templates) || { headline: title, blurb };
}

function drugToken(title) {
  const tokens = String(title || "").match(/\b\d*[A-Za-z][A-Za-z0-9-]*\b/g) || [];
  const codedSkip = new Set(["ii", "iii", "iv"]);
  const coded = tokens.find((token) => token.length >= 3 && !codedSkip.has(token.toLowerCase()) && (/\d/.test(token) || /[a-z][A-Z]|[A-Z]{3}/.test(token)));
  if (coded) return coded;
  const skip = new Set(["study", "phase", "evaluate", "safety", "efficacy", "program", "combined", "investigational", "healthy", "clinical", "adult", "patients", "treatment", "associated", "response", "immune", "compare", "learn", "about"]);
  return tokens.find((token) => token.length >= 3 && !skip.has(token.toLowerCase()) && token[0] === token[0].toUpperCase()) || "";
}

function layCondition(value) {
  return plainCondition(value).replace(/\b[A-Z][a-z]+(?:'[a-z]+)?\b/g, (word) => (/^Alzheimer/.test(word) ? word : word.toLowerCase()));
}

export function trialCopy(id, facts) {
  const phase = facts.phase3 ? "Phase 3" : "Phase 2";
  const title = facts.title || "";
  let focus = "";
  if (/alzheimer/i.test(`${facts.condition || ""} ${title}`) && /psychosis/i.test(title)) focus = "Alzheimer's psychosis";
  else if (facts.condition && !/\d/.test(facts.condition)) focus = layCondition(facts.condition);
  else {
    const fromTitle = title.match(/\bwith ([A-Za-z][^.]{2,40})/i);
    focus = fromTitle ? layCondition(fromTitle[1].split(/,| in | for /i)[0]) : (facts.condition ? layCondition(facts.condition) : "");
  }
  const when = humanDate(facts.date);
  const drug = drugToken(title);
  const same = drug && focus && drug.toLowerCase() === focus.toLowerCase();
  const study = same
    ? (/vaccine/i.test(title) ? `${phase} ${focus} vaccine study` : `${phase} ${focus} study`)
    : drug && focus ? `${phase} ${drug} study in ${focus}` : focus ? `${phase} study in ${focus}` : drug ? `${phase} ${drug} study` : `${phase} study`;
  const sponsor = facts.sponsor ? `${facts.sponsor} is the sponsor` : "";
  const status = facts.status ? `ClinicalTrials.gov lists the status as ${facts.status}` : "";
  const blurb = sentences(`The study reaches primary completion on ${when}.`, title, sponsor || status);
  const templates = [
    () => ({ headline: fitLead([`${study} reaches primary completion ${when}`]), blurb }),
    () => ({ headline: fitLead([`${study} reaches its primary completion ${when}`, `${study} reaches primary completion ${when}`]), blurb }),
    () => ({ headline: fitLead([`${study} reaches primary completion ${when}`]), blurb }),
  ];
  return compose(id, templates);
}

export function pressLead(title) {
  const clean = sentenceCase(String(title || "").replace(/\s+/g, " ").trim());
  if (wordCount(clean) <= HEADLINE_WORD_MAX && !danglingEnd(clean)) return clean;
  const accel = /accelerated approval/i.test(clean);
  const condition = /head and neck/i.test(clean) ? "head and neck cancer"
    : /stroke/i.test(clean) ? "stroke"
    : (clean.match(/\bfor (?:the )?(?:treatment of )?([A-Za-z][^.]{3,40})/) || [])[1];
  const focus = condition ? plainCondition(condition) : "";
  if (/factor x[li1]a/i.test(clean) && /stroke/i.test(clean)) return "FDA approves a first Factor XIa inhibitor to prevent stroke";
  if (accel && focus) return fitLead([`FDA grants accelerated approval to new ${focus} treatment`, `FDA grants accelerated approval for ${focus}`]);
  if (focus) return fitLead([`FDA approves a new treatment for ${focus}`, `FDA approves a new ${focus} treatment`]);
  const clause = clean.split(/[:;]/)[0].trim();
  if (wordCount(clause) >= 4 && wordCount(clause) <= HEADLINE_WORD_MAX && !danglingEnd(clause)) return clause;
  const words = clean.split(/\s+/);
  let keep = Math.min(HEADLINE_WORD_MAX, words.length);
  while (keep > 4 && danglingEnd(words.slice(0, keep).join(" "))) keep -= 1;
  return sentenceCase(words.slice(0, keep).join(" "));
}

export function pressCopy(id, facts) {
  const product = facts.product || "";
  const headline = pressLead(facts.title);
  const why = product ? `The release names ${product}.` : `The ${facts.feed} reports ${leadIn(facts.title)}.`;
  const blurb = sentences(why, facts.published ? `Published ${humanDate(facts.published)}.` : "");
  const templates = [
    () => ({ headline, blurb }),
    () => ({ headline, blurb }),
    () => ({ headline, blurb }),
  ];
  return compose(id, templates);
}

const ITEM_NAMES = {
  "1.01": "a material definitive agreement",
  "1.02": "termination of a material agreement",
  "2.01": "an acquisition or disposition",
  "2.02": "results of operations",
  "5.02": "a director or officer change",
  "5.03": "bylaw or charter amendments",
  "7.01": "a Regulation FD disclosure",
  "8.01": "other events",
  "9.01": "financial statements and exhibits",
};

export function grantCopy(id, facts) {
  const title = sentenceCase(stripVenue(facts.title));
  const org = facts.org || "The listed organization";
  const amount = facts.amount ? `The award is ${facts.amount}` : "";
  const purpose = `The grant supports ${leadIn(title)}.`;
  const tail = [org, facts.activity ? `activity ${facts.activity}` : "", facts.published ? `starting ${humanDate(facts.published)}` : ""].filter(Boolean).join(", ");
  const blurb = sentences(purpose, amount, tail ? `${tail}.` : "");
  const templates = [
    () => ({ headline: title, blurb }),
    () => ({ headline: title, blurb }),
    () => ({ headline: title, blurb }),
  ];
  return compose(id, templates);
}

export function secCopy(id, facts) {
  const form = facts.amended ? "an amended 8-K" : "an 8-K";
  const codes = Array.isArray(facts.itemCodes) ? facts.itemCodes : [];
  const described = codes.map((code) => ITEM_NAMES[code]).filter(Boolean);
  const leadItem = described[0] || "";
  const what = leadItem
    ? `${facts.company} discloses ${leadItem} in ${form}`
    : `${facts.company} files ${form}`;
  const why = leadItem
    ? `The filing index lists ${codes.map((code) => `Item ${code}${ITEM_NAMES[code] ? ` ${ITEM_NAMES[code]}` : ""}`).join(" and ")}.`
    : (Array.isArray(facts.itemCodes) ? "The SEC submissions index did not list an item code for this filing." : "The filing is a current report on Form 8-K.");
  const tail = facts.accession ? `Accession ${facts.accession}.` : "";
  const blurb = sentences(why, tail);
  const templates = [
    () => ({ headline: fitLead([what, `${facts.company} files ${form}`]), blurb }),
    () => ({ headline: fitLead([what, `${facts.company} files ${form}`]), blurb }),
    () => ({ headline: fitLead([leadItem ? `${facts.company} reports ${leadItem}` : `${facts.company} files ${form}`, `${facts.company} files ${form}`]), blurb }),
  ];
  return compose(id, templates);
}

export function preprintCopy(id, facts) {
  const where = facts.server === "medrxiv" ? "medRxiv" : "bioRxiv";
  const title = sentenceCase(stripVenue(facts.title));
  const when = humanDate(facts.date);
  const blurb = sentences(
    `This preprint, not peer-reviewed, reports ${leadIn(title)}.`,
    `Posted on ${where}${when ? ` on ${when}` : ""}.`,
  );
  const templates = [
    () => ({ headline: title, blurb }),
    () => ({ headline: title, blurb }),
    () => ({ headline: title, blurb }),
  ];
  return compose(id, templates);
}

export function modelCopy(id, facts) {
  const title = sentenceCase(stripVenue(facts.title));
  const bits = [
    facts.license ? `license ${facts.license}` : "",
    facts.base ? `base model ${facts.base}` : "",
    facts.params ? `parameters ${facts.params}` : "",
  ].filter(Boolean);
  const blurb = sentences(
    `${facts.org} released ${title} as a model for biological work.`,
    facts.disclaimer || "The card describes a model release, not an experimental finding.",
    bits.length ? `Card lists ${bits.join(", ")}.` : "",
  );
  const templates = [
    () => ({ headline: fitLead([`${facts.org} releases ${title}`, title]), blurb }),
    () => ({ headline: title, blurb }),
    () => ({ headline: fitLead([`${title} model release from ${facts.org}`, title]), blurb }),
  ];
  return compose(id, templates);
}

export function arxivCopy(id, facts) {
  const title = sentenceCase(stripVenue(facts.title));
  const when = humanDate(facts.date);
  const blurb = sentences(
    `This preprint, not peer-reviewed, reports ${leadIn(title)}.`,
    facts.tags ? `Posted on arXiv${when ? ` on ${when}` : ""} under ${facts.tags}.` : `Posted on arXiv${when ? ` on ${when}` : ""}.`,
  );
  const templates = [
    () => ({ headline: title, blurb }),
    () => ({ headline: title, blurb }),
    () => ({ headline: title, blurb }),
  ];
  return compose(id, templates);
}

export function edgarIndexUrl(cik, filename) {
  const base = String(filename || "").split("/").pop().replace(/\.txt$/i, "");
  const nodash = base.replaceAll("-", "");
  const cikNum = String(Number(cik));
  if (!base || !nodash || !cikNum || cikNum === "NaN") return "";
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${nodash}/${base}-index.html`;
}

export function companyName(value) {
  const cleaned = String(value || "").replace(/\\[A-Za-z]{2}\\/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned !== cleaned.toUpperCase()) return cleaned;
  return cleaned.toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

export function paperRecords(results, options = {}) {
  const mode = options.mode || "phase3";
  const rows = [];
  for (const record of results || []) {
    const title = unescapeBasic(String(record.title || "").replace(/<[^>]+>/g, " "));
    if (!title || OUTCOME_CLAIM.test(title) || offTopicText(title)) continue;
    if (mode === "phase3") {
      if (!/\bphase\s*(3|iii)\b/i.test(title)) continue;
      if (!/\b(trial|study|randomi[sz]ed)\b/i.test(title)) continue;
    }
    const journal = String(record.journalTitle || record.journalInfo?.journal?.title || "").replace(/\s+/g, " ").trim();
    if (mode === "journal" && !journalAllowed(journal)) continue;
    if (mode === "ai" && !/\b(machine learning|deep learning|artificial intelligence|protein language|foundation model|neural network|CRISPR|single-cell|genomic)\b/i.test(title)) continue;
    const published = String(record.firstPublicationDate || "").slice(0, 10);
    if (options.from && (!published || published < options.from || (options.today && published > options.today))) continue;
    const doi = String(record.doi || "");
    const source = String(record.source || "");
    const recordId = String(record.id || "");
    const url = /^10\.\d+\//.test(doi) ? `https://doi.org/${doi}` : (source && recordId ? `https://europepmc.org/article/${source}/${recordId}` : "");
    const scout = options.scout || "europepmc";
    const id = `${scout}:${source}:${recordId}`;
    const copy = paperCopy(id, {
      title,
      journal,
      date: /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : "",
      label: options.label || "Europe PMC",
      recordId: `${source} ${recordId}`.trim(),
      authors: String(record.authorString || "").replace(/\s+/g, " ").trim(),
    });
    if (!copy || !/^\d{4}-\d{2}-\d{2}$/.test(published)) continue;
    rows.push({
      id,
      headline: copy.headline,
      blurb: copy.blurb,
      source_url: url,
      source_type: "paper",
      source_name: options.sourceName || "Europe PMC",
      published_at: published,
      scout_source: scout,
      rule: options.rule || "paper-phase3",
      dedupe_key: `paper:${doi || recordId}`,
    });
  }
  return safeItems(rows);
}

export function personName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = /^([^,]+),\s*(.+)$/.exec(text);
  const ordered = match ? `${match[2]} ${match[1]}` : text;
  if (ordered !== ordered.toUpperCase()) return ordered;
  return ordered.toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}
