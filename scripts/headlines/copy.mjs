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
  const shortened = shortenHeadline(fields.headline);
  let blurbSource = fields.blurb || "";
  if (shortened.extra) {
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

export function fdaApprovalCopy(id, facts) {
  const kind = kindOf(facts.rule, id);
  const who = joinName(facts.brand, facts.ingredient);
  const indication = facts.indication ? compactIndication(facts.indication, 6) : { core: "", extra: "" };
  const focus = indication.core;
  const indicationLine = indication.extra ? `Indication detail: ${indication.extra}` : "";
  const area = facts.indication ? "" : facts.area || "";
  const sponsorLine = facts.sponsor ? `Sponsor listed as ${facts.sponsor}` : "";
  const classLine = facts.desc ? `Submission class: ${facts.desc}` : "";
  const dateLine = facts.published ? `Approval date ${facts.published}` : "";
  const priorityLine = facts.priority ? "Review priority on the record: priority" : (facts.reviewPriority ? `Review priority on the record: ${String(facts.reviewPriority).toLowerCase()}` : "");
  const routeBits = [facts.dosage ? `dosage form ${String(facts.dosage).toLowerCase()}` : "", facts.route ? `route ${String(facts.route).toLowerCase()}` : ""].filter(Boolean);
  const routeLine = routeBits.length ? `Product record lists ${routeBits.join(", ")}` : "";
  const appLine = facts.app ? `Drugs@FDA application ${facts.app}` : "";
  const lead = focus ? `${who}: FDA ${kind}, indicated for ${focus}` : "";
  const templates = [];
  if (who && focus) {
    templates.push(() => ({ headline: lead, blurb: sentences(indicationLine || sponsorLine, classLine || dateLine) }));
    templates.push(() => ({ headline: `FDA ${kind} of ${who} for ${focus}`, blurb: sentences(indicationLine || dateLine, priorityLine || appLine) }));
    templates.push(() => ({ headline: `${who} indicated for ${focus}`, blurb: sentences(indicationLine || `FDA ${kind} dated ${facts.published}`, sponsorLine || classLine) }));
  } else if (who && area) {
    templates.push(() => ({ headline: `${who}: FDA ${kind}, ${area}`, blurb: sentences(sponsorLine, dateLine) }));
    templates.push(() => ({ headline: `FDA ${kind} of ${who} (${area})`, blurb: sentences(classLine, appLine || priorityLine) }));
    templates.push(() => ({ headline: `${who}, ${area}`, blurb: sentences(`FDA ${kind} on ${facts.published}`, sponsorLine || routeLine) }));
  } else if (who) {
    templates.push(() => ({ headline: `${who}: FDA ${kind}`, blurb: sentences(sponsorLine, classLine || dateLine) }));
    templates.push(() => ({ headline: `FDA ${kind} of ${who}`, blurb: sentences(dateLine, priorityLine || appLine) }));
    templates.push(() => ({ headline: `${who} listed under ${facts.app}`, blurb: sentences(classLine || `FDA ${kind}`, routeLine || sponsorLine || dateLine) }));
  } else if (facts.app) {
    templates.push(() => ({ headline: `FDA records ${kind} of ${facts.app}`, blurb: sentences(sponsorLine, classLine || dateLine) }));
    templates.push(() => ({ headline: `${facts.app}: FDA ${kind}`, blurb: sentences(dateLine, priorityLine || sponsorLine) }));
    templates.push(() => ({ headline: `FDA ${kind} recorded for ${facts.app}`, blurb: sentences(sponsorLine || classLine, dateLine) }));
  }
  return compose(id, templates);
}

export function crlCopy(id, facts) {
  const who = [facts.apps, facts.company].filter(Boolean).join(", ");
  const topicLine = facts.topics?.length
    ? `Section headings include ${facts.topics.length === 1 ? facts.topics[0] : `${facts.topics.slice(0, -1).join(", ")} and ${facts.topics.at(-1)}`}`
    : "";
  const statusLine = `openFDA lists the application status as ${facts.status || "not stated"}`;
  const dateLine = `Letter date ${facts.published}`;
  const templates = [
    () => ({ headline: `FDA complete response letter for ${who || "an application"}`, blurb: sentences(dateLine, topicLine || statusLine) }),
    () => ({ headline: `Complete response letter posted for ${who || "an application"}`, blurb: sentences(statusLine, topicLine || dateLine) }),
    () => ({ headline: facts.company ? `${facts.company}: FDA complete response letter` : `FDA complete response letter, ${facts.published}`, blurb: sentences(facts.apps ? `Applications listed: ${facts.apps}` : dateLine, topicLine || statusLine) }),
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
  const applicant = facts.applicant ? `Applicant listed as ${facts.applicant}` : "";
  const license = facts.license ? `License type: ${facts.license}` : "";
  const templates = [];
  if (facts.event === "revoked") {
    templates.push(() => ({ headline: `FDA Purple Book lists ${who} (BLA ${facts.bla}) licensure as ${facts.licensure}`, blurb: sentences(applicant, license || `Report month starting ${facts.published}`) }));
    templates.push(() => ({ headline: `${who}: Purple Book licensure listed as ${facts.licensure}`, blurb: sentences(`BLA ${facts.bla}`, applicant || license) }));
    templates.push(() => ({ headline: `Purple Book change for ${who} (BLA ${facts.bla}): ${facts.licensure}`, blurb: sentences(license, `From the ${facts.report} Purple Book changes report`) }));
  } else if (facts.event === "interchangeable") {
    const ref = facts.ref ? ` with ${facts.ref}` : "";
    templates.push(() => ({ headline: `FDA Purple Book lists ${who} (BLA ${facts.bla}) as interchangeable${ref}`, blurb: sentences(applicant, `Interchangeability date ${facts.published}`) }));
    templates.push(() => ({ headline: `${who}: Purple Book interchangeability date ${facts.published}${facts.ref ? `, reference product ${facts.ref}` : ""}`, blurb: sentences(`BLA ${facts.bla}`, license || applicant) }));
    templates.push(() => ({ headline: facts.ref ? `${who} interchangeable with ${facts.ref} in the Purple Book` : `${who} listed as interchangeable in the Purple Book`, blurb: sentences(`BLA ${facts.bla}, date ${facts.published}`, applicant || license) }));
  } else {
    const substance = facts.substance && facts.substance.toLowerCase() !== who.toLowerCase() ? ` (${facts.substance})` : "";
    templates.push(() => ({ headline: `FDA Purple Book lists a new license for ${who}${substance}, BLA ${facts.bla}`, blurb: sentences(applicant, license || `Approval date ${facts.published}`) }));
    templates.push(() => ({ headline: `${who}${substance}: new Purple Book license, BLA ${facts.bla}`, blurb: sentences(`Approval date ${facts.published}`, applicant || license) }));
    templates.push(() => ({ headline: `Purple Book adds ${who}, BLA ${facts.bla}`, blurb: sentences(license || `Approval date ${facts.published}`, applicant || `Approval date ${facts.published}`) }));
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
  const name = facts.inn ? `${unescapeBasic(facts.name)} (${unescapeBasic(facts.inn)})` : unescapeBasic(facts.name);
  const event = facts.event;
  const fullIndication = facts.indication ? lowerFirst(unescapeBasic(facts.indication).replace(/\.+$/, "")) : "";
  const packedIndication = fullIndication ? compactIndication(fullIndication, 5) : { core: "", extra: "" };
  const indication = packedIndication.core;
  const indicationDetail = packedIndication.extra ? `Indication detail: ${fullIndication}` : "";
  const mesh = unescapeBasic(facts.mesh || "");
  const holder = facts.holder ? `Applicant or holder listed as ${unescapeBasic(facts.holder)}` : "";
  const group = facts.group ? `Pharmacotherapeutic group: ${unescapeBasic(facts.group)}` : "";
  const number = facts.productNumber ? `EMA product number ${facts.productNumber}` : "";
  const dateLine = facts.published ? `Event date ${facts.published}` : "";
  const flags = [
    facts.orphan ? "Listed as an orphan medicine" : "",
    facts.conditional ? "Conditional approval flag is yes" : "",
    facts.biosimilar ? "Biosimilar flag is yes" : "",
  ].filter(Boolean).join(". ");
  const templates = [];
  if (indication) {
    templates.push(() => ({ headline: `${name}: ${event} for ${indication}`, blurb: sentences(indicationDetail || holder || group, number || dateLine) }));
    templates.push(() => ({ headline: `${event} on ${name} for ${indication}`, blurb: sentences(indicationDetail || group || holder, flags || dateLine) }));
    templates.push(() => ({ headline: `${name} for ${indication}: ${event}`, blurb: sentences(indicationDetail || number || group, holder || dateLine) }));
  } else if (mesh) {
    templates.push(() => ({ headline: `${name}, ${mesh}: ${event}`, blurb: sentences(holder || group, number || dateLine) }));
    templates.push(() => ({ headline: `${event}: ${name} (${mesh})`, blurb: sentences(group || holder, dateLine) }));
    templates.push(() => ({ headline: `${name}: ${event}, ${mesh}`, blurb: sentences(holder || number, flags || dateLine) }));
  } else {
    templates.push(() => ({ headline: `${name}: ${event}`, blurb: sentences(holder || group || number, dateLine) }));
    templates.push(() => ({ headline: `${event} for ${name}`, blurb: sentences(group || number, flags || dateLine) }));
    templates.push(() => ({ headline: facts.rule === "ema-lapse" ? `${name}: EMA lists ${facts.medicineStatus || "a status change"}` : `${name} on the EMA medicines list`, blurb: sentences(dateLine, holder || number || "Record is from the EMA medicines export") }));
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
  const title = facts.title;
  const journal = facts.journal || "";
  const dateLine = facts.date ? `First publication date ${facts.date}` : "";
  const idLine = `${facts.label} ${facts.recordId}`.trim();
  const authors = facts.authors ? `Authors listed: ${clip(facts.authors, 160)}` : "";
  const journalLine = journal ? `Journal listed as ${journal}` : "";
  const templates = [
    () => ({ headline: title, blurb: sentences(idLine, dateLine || authors || journalLine) }),
    () => ({ headline: journal ? `${journal}: ${title}` : title, blurb: sentences(authors || idLine, dateLine || idLine) }),
    () => ({ headline: title, blurb: sentences(journalLine || authors, dateLine || idLine) }),
  ];
  return compose(id, templates) || { headline: title, blurb: sentences(idLine, dateLine || "Record carries no separate publication date") };
}

export function trialCopy(id, facts) {
  const phase = facts.phase3 ? "Phase 3" : "Phase 2";
  const title = facts.title;
  const condition = facts.condition || "";
  const sponsor = facts.sponsor ? `Sponsor listed as ${facts.sponsor}` : "Sponsor not named on the calendar extract";
  const status = `ClinicalTrials.gov status ${facts.status || "not stated"}`;
  const when = `The ${facts.when || "listed"} primary completion date is ${facts.date}`;
  const action = `${phase} primary completion ${facts.date}`;
  const shortTitle = wordCount(title) <= 8 ? title : "";
  const templates = [
    () => ({
      headline: condition ? `${condition}: ${action}` : (shortTitle ? `${action}: ${shortTitle}` : action),
      blurb: sentences(shortTitle ? sponsor : title, shortTitle ? status : sponsor),
    }),
    () => ({
      headline: shortTitle || (condition ? `${condition} ${action}` : action),
      blurb: sentences(title, status),
    }),
    () => ({
      headline: condition ? `${condition}: ${phase} primary completion` : action,
      blurb: sentences(title, when),
    }),
  ];
  return compose(id, templates);
}

export function pressCopy(id, facts) {
  const product = facts.product || "";
  const dateLine = `Published ${facts.published}`;
  const feed = facts.feed;
  const templates = [
    () => ({ headline: facts.title, blurb: sentences(product ? `The release names ${product}` : feed, dateLine) }),
    () => ({ headline: product ? `${product}: ${facts.title}` : facts.title, blurb: sentences(dateLine, feed) }),
    () => ({ headline: facts.title, blurb: sentences(`${feed} item dated ${facts.published}`, product ? `Named product text: ${product}` : "") }),
  ];
  return compose(id, templates);
}

export function grantCopy(id, facts) {
  const title = facts.title;
  const org = facts.org || "the organization on the record";
  const amount = facts.amount ? `Award amount listed as ${facts.amount}` : "";
  const activity = facts.activity ? `Activity code ${facts.activity}` : "";
  const institute = facts.institute || "";
  const pi = facts.pi ? `Contact PI listed as ${facts.pi}` : "";
  const number = facts.projectNum ? `Project number ${facts.projectNum}` : "";
  const dateLine = `Project start date ${facts.published}`;
  const templates = [
    () => ({ headline: title, blurb: sentences(`${org}, ${activity || "NIH award"}`, amount || dateLine) }),
    () => ({ headline: `${org}: ${title}`, blurb: sentences(amount || activity, dateLine) }),
    () => ({ headline: facts.activity ? `NIH ${facts.activity}: ${title}` : title, blurb: sentences(pi || institute || org, number || amount || dateLine) }),
  ];
  return compose(id, templates);
}

export function secCopy(id, facts) {
  const form = facts.amended ? "amended Form 8-K" : "Form 8-K";
  const ticker = facts.ticker ? ` (${facts.ticker})` : "";
  const dateLine = `Filing date ${facts.date}`;
  const cikLine = `CIK ${facts.cik}`;
  const accession = `Accession number ${facts.accession}`;
  const templates = [
    () => ({ headline: `${facts.company} files ${form}`, blurb: sentences(dateLine, accession) }),
    () => ({ headline: `${form} filed by ${facts.company}${ticker}`, blurb: sentences(cikLine, dateLine) }),
    () => ({ headline: `${facts.company}${ticker}: SEC ${form}`, blurb: sentences(accession, cikLine) }),
  ];
  return compose(id, templates);
}

export function preprintCopy(id, facts) {
  const where = facts.server === "medrxiv" ? "medRxiv" : "bioRxiv";
  const dateLine = `Posted ${facts.date}`;
  const category = facts.category ? `Category: ${facts.category}` : "";
  const version = facts.version && String(facts.version) !== "1" ? `Version ${facts.version}` : "";
  const license = facts.license ? `License field: ${facts.license}` : "";
  const place = facts.institution ? `Corresponding author institution: ${clip(facts.institution, 120)}` : "";
  const note = `Preprint on ${where}, not a peer-reviewed article`;
  const templates = [
    () => ({ headline: facts.title, blurb: sentences(category || note, dateLine) }),
    () => ({ headline: `${where}: ${facts.title}`, blurb: sentences(note, license || version || category) }),
    () => ({ headline: facts.title, blurb: sentences(place || category, version || license || dateLine) }),
  ];
  return compose(id, templates);
}

export function modelCopy(id, facts) {
  const bits = [
    facts.license ? `license ${facts.license}` : "",
    facts.base ? `base model ${facts.base}` : "",
    facts.params ? `parameters listed as ${facts.params}` : "",
  ].filter(Boolean);
  const card = bits.length ? `Card fields: ${bits.join(", ")}` : "Curated model-release card";
  const verified = facts.verified ? `Card verified as of ${facts.verified}` : "";
  const note = facts.disclaimer || "This card is a model release, not an experimental finding";
  const templates = [
    () => ({ headline: `${facts.title}: model release from ${facts.org}`, blurb: sentences(card, note) }),
    () => ({ headline: `${facts.org} model release: ${facts.title}`, blurb: sentences(verified || card, note) }),
    () => ({ headline: facts.title, blurb: sentences(`${facts.org} model-release card`, card) }),
  ];
  return compose(id, templates);
}

export function arxivCopy(id, facts) {
  const authors = facts.authors ? `Authors listed: ${clip(facts.authors, 160)}` : "";
  const tags = facts.tags ? `arXiv categories: ${facts.tags}` : "";
  const note = facts.disclaimer || "arXiv preprint. Not peer-reviewed";
  const templates = [
    () => ({ headline: facts.title, blurb: sentences(note, authors || tags) }),
    () => ({ headline: facts.title, blurb: sentences(tags || note, `Posted ${facts.date}`) }),
    () => ({ headline: `arXiv preprint: ${facts.title}`, blurb: sentences(authors || note, tags || `Posted ${facts.date}`) }),
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
    if (!title || OUTCOME_CLAIM.test(title)) continue;
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
