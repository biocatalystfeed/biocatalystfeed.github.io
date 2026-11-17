import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { addDays, assertFactual, clip, httpUrl, isoFromDmy, isoFromMdy, isoFromUs, isoFromYmd, parseCsv, titleCaseCaps } from "./text.mjs";

const execFileAsync = promisify(execFile);

const OPENFDA = "https://api.fda.gov";
const DRUGSFDA = "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=";
const ORANGE_ZIP = "https://www.fda.gov/media/76860/download";
const ORANGE_PAGE = "https://www.accessdata.fda.gov/scripts/cder/ob/results_product.cfm";
const CRL_PDF = "https://download.open.fda.gov/crl/";
const EMA_URL = "https://www.ema.europa.eu/en/documents/report/medicines-output-medicines_json-report_en.json";
const HC_BASE = "https://health-products.canada.ca/api/notice-of-compliance/";
const HC_PAGE = "https://health-products.canada.ca/noc-ac/nocInfo?lang=eng&no=";
const FR_API = "https://www.federalregister.gov/api/v1/documents.json";
const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

const CONSENT_DATE = "2026-11-17";

function item(fields) {
  const headline = clip(fields.headline, 220).replace(/\.{2,}/g, ".");
  const blurb = clip(fields.blurb || "", 420).replace(/\.{2,}/g, ".");
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

function safeItems(rows) {
  const out = [];
  for (const row of rows) {
    try {
      const made = item(row);
      if (made) out.push(made);
    } catch {
      /* A generated line failed the factual check. Drop it rather than rewrite it. */
    }
  }
  return out;
}

function approvalHeadline(prefix, who, app) {
  if (!who || who === app) return `${prefix} ${app}`;
  return `${prefix} ${who}, ${app}`;
}

function prettyApp(applicationNumber) {
  const m = /^(NDA|ANDA|BLA)\s*(\d+)$/i.exec(String(applicationNumber || "").replace(/\s+/g, ""));
  if (!m) return String(applicationNumber || "");
  return `${m[1].toUpperCase()} ${m[2]}`;
}

function applDigits(applicationNumber) {
  const m = /(\d{5,6})$/.exec(String(applicationNumber || "").replace(/\s+/g, ""));
  return m ? m[1] : "";
}

function drugsFdaUrl(applicationNumber) {
  const digits = applDigits(applicationNumber);
  return digits ? `${DRUGSFDA}${digits}` : "";
}

function namesOf(application) {
  const brands = [];
  const ingredients = [];
  for (const product of application.products || []) {
    if (product.brand_name && !brands.includes(product.brand_name)) brands.push(product.brand_name);
    for (const ingredient of product.active_ingredients || []) {
      if (ingredient.name && !ingredients.includes(ingredient.name)) ingredients.push(ingredient.name);
    }
  }
  const brand = titleCaseCaps(brands[0] || "");
  const ingredient = titleCaseCaps(ingredients[0] || "");
  return {
    brand,
    ingredient: ingredient.length > 80 ? "" : ingredient,
    sponsor: titleCaseCaps(application.sponsor_name || ""),
  };
}

function fdaRule(application, submission) {
  const code = submission.submission_class_code || "";
  const desc = submission.submission_class_code_description || "";
  const hay = `${code} ${desc}`;
  const app = application.application_number || "";
  if (submission.submission_type === "ORIG" && (/TYPE\s*1\b/i.test(code) || /new molecular entity/i.test(desc))) return "fda-nme";
  if (submission.submission_type === "ORIG" && app.startsWith("BLA") && /TYPE\s*2|biosimilar/i.test(hay)) return "fda-biosimilar";
  if (submission.submission_type === "ORIG" && app.startsWith("BLA")) return "fda-bla";
  if (submission.submission_type === "ORIG" && app.startsWith("ANDA")) return "fda-anda";
  if (submission.submission_type === "ORIG" && app.startsWith("NDA")) return "fda-orig";
  if (submission.submission_type === "SUPPL" && code === "EFFICACY") return "fda-efficacy";
  return "";
}

export function drugsfdaItems(applications, today) {
  const from = addDays(today, -100);
  const rows = [];
  for (const application of applications) {
    for (const submission of application.submissions || []) {
      if (submission.submission_status !== "AP") continue;
      const published = isoFromYmd(submission.submission_status_date);
      if (!published || published < from || published > today) continue;
      const rule = fdaRule(application, submission);
      if (!rule) continue;
      const { brand, ingredient, sponsor } = namesOf(application);
      const app = prettyApp(application.application_number);
      const what = brand || ingredient;
      const desc = submission.submission_class_code_description || submission.submission_class_code || "original";
      const priority = submission.review_priority === "PRIORITY";
      let headline = approvalHeadline("FDA records an approval for", what, app);
      let blurb = "";
      if (rule === "fda-nme") headline = approvalHeadline("FDA records original approval of", what, app);
      else if (rule === "fda-bla") headline = approvalHeadline("FDA records original BLA approval of", what, app);
      else if (rule === "fda-biosimilar") headline = approvalHeadline("FDA records biosimilar approval of", what, app);
      else if (rule === "fda-orig") headline = approvalHeadline("FDA records original NDA approval of", what, app);
      else if (rule === "fda-efficacy") headline = approvalHeadline("FDA records an efficacy supplement for", what, app);
      else if (rule === "fda-anda") headline = approvalHeadline("FDA records ANDA approval of", what, app);
      if (rule !== "fda-anda") {
        blurb = `Sponsor listed as ${sponsor || "not named"}. FDA submission class: ${desc}${priority ? ", review priority: priority" : ""}. Approval date ${published}.`;
      }
      const adjustments = [];
      if (priority && rule !== "fda-anda") adjustments.push("priority-review");
      rows.push({
        id: `openfda-drugsfda:${application.application_number}:${published}:${submission.submission_type}:${submission.submission_number || ""}`,
        headline,
        blurb,
        source_url: drugsFdaUrl(application.application_number),
        source_type: "regulator",
        source_name: "FDA Drugs@FDA (openFDA)",
        published_at: published,
        scout_source: "openfda-drugsfda",
        rule,
        adjustments,
        dedupe_key: app.startsWith("BLA") && submission.submission_type === "ORIG"
          ? `bla:${applDigits(application.application_number)}:orig`
          : `drugsfda:${application.application_number}:${published}:${submission.submission_type}:${submission.submission_number || ""}`,
      });
    }
  }
  return safeItems(rows);
}

const CRL_TOPICS = [
  ["facility", ["FACILITY", "FACILITIES", "INSPECTION"]],
  ["product quality", ["PRODUCT QUALITY", "CHEMISTRY", "MANUFACTURING", "MICROBIOLOGY"]],
  ["clinical", ["CLINICAL", "EFFICACY"]],
  ["safety", ["SAFETY"]],
];

export function crlTopics(text) {
  const found = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const heading = line.trim();
    if (!/^[A-Z][A-Z0-9 ,/&()-]{3,70}$/.test(heading)) continue;
    for (const [label, needles] of CRL_TOPICS) {
      if (needles.some((needle) => heading.includes(needle)) && !found.includes(label)) found.push(label);
    }
  }
  return found;
}

export function crlItems(records, today) {
  const from = addDays(today, -160);
  const rows = [];
  for (const record of records) {
    const published = isoFromMdy(record.letter_date);
    const file = record.file_name;
    if (!published || published < from || published > today || !file) continue;
    const apps = (record.application_number || []).map((value) => String(value).replace(/\s+/g, " ").trim()).filter(Boolean);
    const company = titleCaseCaps(record.company_name || "");
    const topics = crlTopics(record.text);
    const status = record.approval_status || "not stated";
    const topicSentence = topics.length ? ` Section headings include ${topics.length === 1 ? topics[0] : `${topics.slice(0, -1).join(", ")} and ${topics.at(-1)}`}.` : "";
    rows.push({
      id: `openfda-crl:${file}`,
      headline: `FDA complete response letter for ${apps.join(", ") || "an application"}${company ? `, ${company}` : ""}`,
      blurb: `Letter date ${published}. openFDA lists the application status as ${status}.${topicSentence}`,
      source_url: `${CRL_PDF}${encodeURIComponent(file)}`,
      source_type: "regulator",
      source_name: "FDA complete response letters (openFDA)",
      published_at: published,
      scout_source: "openfda-crl",
      rule: "fda-crl",
      dedupe_key: `crl:${file}`,
    });
  }
  return safeItems(rows);
}

export function parseTildeTable(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.trim());
  if (!lines.length) return [];
  const head = lines[0].split("~").map((cell) => cell.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split("~");
    const row = {};
    head.forEach((key, index) => {
      row[key] = (cells[index] || "").trim();
    });
    return row;
  });
}

export function orangeBookLoe(tables, today, horizonDays = 75) {
  const products = new Map();
  for (const row of tables.products || []) {
    if ((row.Appl_Type || "").toUpperCase() !== "N") continue;
    const key = row.Appl_No;
    if (!key) continue;
    const current = products.get(key) || { appl_no: key, trades: [], ingredients: [], applicant: "" };
    const trade = (row.Trade_Name || "").trim();
    const ingredient = (row.Ingredient || "").trim();
    if (trade && !current.trades.includes(trade)) current.trades.push(trade);
    if (ingredient && !current.ingredients.includes(ingredient)) current.ingredients.push(ingredient);
    current.applicant = current.applicant || (row.Applicant_Full_Name || row.Applicant || "").trim();
    products.set(key, current);
  }
  const best = new Map();
  const consider = (applNo, date, kind, code, delisted = false) => {
    if ((tables.products || []).length && !products.has(applNo)) return;
    if (!date || date < today || delisted) return;
    const current = best.get(applNo);
    if (!current || date > current.date) best.set(applNo, { date, kind, code });
  };
  for (const row of tables.exclusivity || []) {
    if ((row.Appl_Type || "").toUpperCase() !== "N") continue;
    consider(row.Appl_No, isoFromUs(row.Exclusivity_Date), "exclusivity", row.Exclusivity_Code || "");
  }
  for (const row of tables.patent || []) {
    if ((row.Appl_Type || "").toUpperCase() !== "N") continue;
    consider(row.Appl_No, isoFromUs(row.Patent_Expire_Date_Text), "patent", row.Patent_No || "", row.Delist_Flag === "Y");
  }
  const until = addDays(today, horizonDays);
  const hits = [];
  for (const [applNo, protection] of best) {
    if (protection.date > until) continue;
    const product = products.get(applNo) || { trades: [], ingredients: [], applicant: "" };
    const trade = titleCaseCaps(product.trades[0] || "");
    const ingredient = titleCaseCaps(product.ingredients[0] || "");
    const who = trade || ingredient || `NDA ${applNo}`;
    hits.push({ applNo, protection, trade, ingredient, who, applicant: titleCaseCaps(product.applicant || "") });
  }
  hits.sort((a, b) => a.protection.date.localeCompare(b.protection.date) || a.applNo.localeCompare(b.applNo));
  return safeItems(hits.slice(0, 8).map((hit, index) => ({
    id: `orange-book:${hit.applNo}:${hit.protection.date}`,
    headline: `${hit.who} (NDA ${hit.applNo}): Orange Book last listed protection ${hit.protection.date}`,
    blurb: index < 2
      ? `Applicant listed as ${hit.applicant || "not named"}. Last unexpired listing is ${hit.protection.kind} ${hit.protection.code}. Listed patents are not verified by FDA.`
      : "",
    source_url: `${ORANGE_PAGE}?Appl_Type=N&Appl_No=${encodeURIComponent(hit.applNo)}`,
    source_type: "regulator",
    source_name: "FDA Orange Book",
    published_at: hit.protection.date,
    scout_source: "orange-book",
    rule: hit.protection.kind === "exclusivity" ? "orange-loe-exclusivity" : "orange-loe-patent",
    dedupe_key: `orange:${hit.applNo}`,
  })));
}

function monthBounds(year, monthIndex) {
  const start = `${year}-${String(monthIndex).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, monthIndex, 0));
  return { start, end: endDate.toISOString().slice(0, 10) };
}

export function purpleBookItems(csvText, csvUrl) {
  const table = parseCsv(csvText);
  const title = table[0]?.[0] || "";
  const stamp = /([A-Za-z]+)\s+(\d{4})/.exec(title);
  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const monthIndex = stamp ? monthNames.indexOf(stamp[1].toLowerCase()) + 1 : 0;
  const bounds = monthIndex ? monthBounds(Number(stamp[2]), monthIndex) : { start: "", end: "" };
  let header = null;
  const changes = [];
  for (const cells of table) {
    if ((cells[0] || "").trim() === "N/R/U") {
      if (header) break;
      header = cells.map((cell) => cell.trim());
      continue;
    }
    if (!header) continue;
    const record = {};
    header.forEach((key, index) => {
      record[key] = (cells[index] || "").trim();
    });
    if (record["BLA Number"]) changes.push(record);
  }
  const grouped = new Map();
  for (const row of changes) {
    const list = grouped.get(row["BLA Number"]) || [];
    list.push(row);
    grouped.set(row["BLA Number"], list);
  }
  const rows = [];
  for (const [bla, group] of grouped) {
    const name = titleCaseCaps(group.map((row) => row["Proprietary Name"]).find(Boolean) || "");
    const proper = titleCaseCaps(group.map((row) => row["Proper Name"]).find(Boolean) || "");
    const applicant = titleCaseCaps(group[0].Applicant || "");
    const center = group[0].Center || "";
    const license = group.map((row) => row["License Type"]).find(Boolean) || "";
    const licensure = group.map((row) => row.Licensure).find((value) => /revok/i.test(value || "")) || group[0].Licensure || "";
    const approval = group.map((row) => isoFromUs(row["Approval Date"])).filter(Boolean).sort()[0] || "";
    const inter = group.map((row) => isoFromUs(row["Inter. Approval Date"])).filter((date) => bounds.start && date >= bounds.start && date <= bounds.end).sort().at(-1) || "";
    const flaggedNew = group.some((row) => row["N/R/U"] === "N" || row["N/R/U"] === "R");
    const refTrade = titleCaseCaps(group.map((row) => row["Ref. Product Proprietary Name"]).find(Boolean) || "");
    const refProper = titleCaseCaps(group.map((row) => row["Ref. Product Proper Name"]).find(Boolean) || "");
    const source = (center || "").toUpperCase() === "CDER"
      ? `${DRUGSFDA}${bla}`
      : csvUrl;
    const who = name || proper || `BLA ${bla}`;
    const substance = proper && proper.length <= 80 ? proper : "";
    if (/revok/i.test(licensure) && bounds.start) {
      rows.push({
        id: `purple-book:${bla}:revoked:${bounds.start}`,
        headline: `FDA Purple Book lists ${who} (BLA ${bla}) licensure as ${licensure}`,
        blurb: `Applicant listed as ${applicant || "not named"}. License type: ${license || "not stated"}. From the ${stamp ? stamp[0] : "monthly"} Purple Book changes report.`,
        source_url: source,
        source_type: "regulator",
        source_name: "FDA Purple Book",
        published_at: bounds.start,
        scout_source: "purple-book",
        rule: "purple-revoked",
        dedupe_key: `bla:${bla}:revoked`,
      });
      continue;
    }
    if (inter) {
      const ref = refTrade || refProper;
      rows.push({
        id: `purple-book:${bla}:interchangeable:${inter}`,
        headline: ref
          ? `FDA Purple Book lists ${who} (BLA ${bla}) as interchangeable with ${ref}`
          : `FDA Purple Book lists ${who} (BLA ${bla}) as interchangeable`,
        blurb: `Applicant listed as ${applicant || "not named"}. Interchangeability date ${inter}. License type: ${license || "not stated"}.`,
        source_url: source,
        source_type: "regulator",
        source_name: "FDA Purple Book",
        published_at: inter,
        scout_source: "purple-book",
        rule: "purple-interchangeable",
        dedupe_key: `bla:${bla}:interchangeable`,
      });
      continue;
    }
    if (!flaggedNew || !approval || (bounds.end && approval < addDays(bounds.end, -150))) continue;
    const biosimilar = /351\(k\)|biosimilar/i.test(license);
    rows.push({
      id: `purple-book:${bla}:new:${approval}`,
      headline: `FDA Purple Book lists a new license for ${who}${substance ? ` (${substance})` : ""}, BLA ${bla}`,
      blurb: `Applicant listed as ${applicant || "not named"}. License type: ${license || "not stated"}. Approval date ${approval}.`,
      source_url: source,
      source_type: "regulator",
      source_name: "FDA Purple Book",
      published_at: approval,
      scout_source: "purple-book",
      rule: biosimilar ? "purple-biosimilar" : "purple-351a",
      dedupe_key: `bla:${bla}:orig`,
    });
  }
  return safeItems(rows);
}

const MEETING_MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

export function adcomItems(documents, today) {
  const rows = [];
  for (const doc of documents) {
    const title = String(doc.title || "").replace(/\s+/g, " ").trim();
    const kind = adcomKind(title);
    if (!kind) continue;
    if (/tobacco/i.test(title)) continue;
    const meeting = firstIsoDate(`${doc.dates || ""} ${title}`);
    if (!meeting) continue;
    if (meeting < addDays(today, -21) || meeting > addDays(today, 75)) continue;
    const committee = title.split(";")[0].trim();
    const rest = title.split(";").slice(1).join(";").trim();
    const published = doc.publication_date || meeting;
    const lead = {
      meeting: `FDA advisory committee meeting listed for ${meeting}: ${committee}`,
      postpone: `FDA advisory committee meeting postponed to ${meeting}: ${committee}`,
      cancel: `FDA advisory committee meeting cancelled: ${committee}`,
      amendment: `FDA advisory committee meeting notice amended for ${meeting}: ${committee}`,
    }[kind];
    rows.push({
      id: `adcom:${doc.document_number || meeting}:${kind}`,
      headline: lead,
      blurb: `${rest ? `${clip(rest, 220).replace(/[.\s]+$/g, "")}. ` : ""}Federal Register publication date ${published}.`,
      source_url: doc.html_url,
      source_type: "regulator",
      source_name: "Federal Register",
      published_at: meeting,
      scout_source: "federal-register-adcom",
      rule: kind === "meeting" ? "adcom-meeting" : kind === "postpone" ? "adcom-postpone" : kind === "cancel" ? "adcom-cancel" : "adcom-amendment",
      dedupe_key: `adcom:${doc.document_number || title}`,
    });
  }
  return safeItems(rows);
}

function adcomKind(title) {
  const text = title.toLowerCase();
  if (!text.includes("advisory committee") && !text.includes("panel")) return "";
  if (text.includes("cancellation")) return "cancel";
  if (text.includes("postponement")) return "postpone";
  if (text.includes("amendment of notice") || text.includes("amendment to the notice")) return "amendment";
  if (text.includes("notice of meeting")) return "meeting";
  return "";
}

function firstIsoDate(text) {
  const re = new RegExp(`\\b(${MEETING_MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i");
  const match = re.exec(text || "");
  return match ? isoFromUs(`${match[1]} ${match[2]}, ${match[3]}`) : "";
}

function yes(value) {
  return String(value || "").trim().toLowerCase() === "yes";
}

export function emaItems(records, today) {
  const from = addDays(today, -45);
  const rows = [];
  for (const record of records) {
    if (record.category !== "Human" || yes(record.generic)) continue;
    const opinion = isoFromDmy(record.opinion_adopted_date);
    const authorised = isoFromDmy(record.marketing_authorisation_date);
    const refusal = isoFromDmy(record.refusal_of_marketing_authorisation_date);
    const withdrawn = isoFromDmy(record.withdrawal_of_application_date);
    const lapse = isoFromDmy(record.withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date);
    let rule = "";
    let published = "";
    if (refusal >= from && refusal <= today) {
      rule = "ema-refusal";
      published = refusal;
    } else if (record.medicine_status === "Opinion" && opinion >= from && opinion <= today) {
      rule = String(record.opinion_status).toLowerCase() === "negative" ? "ema-refusal" : "ema-opinion";
      published = opinion;
    } else if (record.medicine_status === "Authorised" && authorised >= from && authorised <= today) {
      rule = "ema-authorisation";
      published = authorised;
    } else if (withdrawn >= from && withdrawn <= today) {
      rule = "ema-withdrawal";
      published = withdrawn;
    } else if (lapse >= from && lapse <= today) {
      rule = "ema-lapse";
      published = lapse;
    }
    if (!rule) continue;
    const name = record.name_of_medicine || record.ema_product_number;
    const inn = record.international_non_proprietary_name_common_name || "";
    const adjustments = [];
    if (yes(record.biosimilar)) adjustments.push("biosimilar");
    if (yes(record.conditional_approval)) adjustments.push("conditional");
    const verb = {
      "ema-opinion": `EMA lists a ${String(record.opinion_status || "recorded").toLowerCase()} opinion for`,
      "ema-authorisation": "EMA marketing authorisation date for",
      "ema-refusal": "EMA records a refusal for",
      "ema-withdrawal": "EMA application withdrawn:",
      "ema-lapse": `EMA lists ${record.medicine_status || "a status change"} for`,
    }[rule];
    rows.push({
      id: `ema:${record.ema_product_number || name}:${rule}:${published}`,
      headline: `${verb} ${name}${inn ? ` (${inn})` : ""}`,
      blurb: rule === "ema-lapse"
        ? `Event date ${published}. Source: European Medicines Agency.`
        : `Medicine status in the EMA export: ${record.medicine_status || "not stated"}${yes(record.orphan_medicine) ? ". Listed as an orphan medicine" : ""}. Source: European Medicines Agency.`,
      source_url: record.medicine_url,
      source_type: "regulator",
      source_name: "European Medicines Agency",
      published_at: published,
      scout_source: "ema",
      rule,
      adjustments,
      dedupe_key: `ema:${record.ema_product_number || name}`,
    });
  }
  return safeItems(rows);
}

const HC_SUBMISSIONS = {
  "New Drug Submission": "NDS",
  "Supplement to a New": "SNDS",
  "Abbreviated New Drug": "ANDS",
  "Supplement to an Abb": "SANDS",
};

export function healthCanadaItems(tables, today) {
  const from = addDays(today, -45);
  const brands = new Map();
  const ingredients = new Map();
  for (const row of tables.drugproduct || []) {
    const name = (row.noc_br_brandname || "").trim();
    if (!name) continue;
    const list = brands.get(row.noc_number) || [];
    if (!list.includes(name)) list.push(name);
    brands.set(row.noc_number, list);
  }
  for (const row of tables.medicinalingredient || []) {
    const name = (row.noc_pi_medic_ingr_name || "").trim();
    if (!name || name.length > 80) continue;
    const list = ingredients.get(row.noc_number) || [];
    if (!list.includes(name)) list.push(name);
    ingredients.set(row.noc_number, list);
  }
  const rows = [];
  for (const row of tables.noticeofcompliancemain || []) {
    const published = row.noc_date || "";
    if (published < from || published > today) continue;
    if (row.noc_is_admin === "Y" || row.noc_submission_class === "Admin") continue;
    if (row.noc_product_type === "Veterinary") continue;
    const submission = HC_SUBMISSIONS[row.noc_on_submission_type] || "";
    if (!submission || submission === "SANDS") continue;
    const cls = row.noc_submission_class || "";
    let rule = "";
    if (cls === "Priority-NAS" || cls.startsWith("Priority")) rule = "hc-priority-nas";
    else if (cls === "New Active Substance") rule = "hc-nas";
    else if (row.noc_status_with_conditions === "Y") rule = "hc-noc-c";
    else if (submission === "NDS") rule = "hc-nds";
    else if (submission === "SNDS") rule = "hc-snds";
    else if (submission === "ANDS") rule = "hc-ands";
    else continue;
    const brand = titleCaseCaps((brands.get(row.noc_number) || [])[0] || "");
    const ingredient = titleCaseCaps((ingredients.get(row.noc_number) || [])[0] || "");
    const who = brand || ingredient || `NOC ${row.noc_number}`;
    const kind = {
      "hc-priority-nas": "priority new active substance",
      "hc-nas": "new active substance",
      "hc-noc-c": "notice of compliance with conditions",
      "hc-nds": "new drug submission",
      "hc-snds": "supplement",
      "hc-ands": "abbreviated submission",
    }[rule];
    rows.push({
      id: `health-canada:${row.noc_number}`,
      headline: `Health Canada notice of compliance: ${who} (${kind})`,
      blurb: rule === "hc-ands" || rule === "hc-snds"
        ? ""
        : `Manufacturer listed as ${titleCaseCaps(row.noc_manufacturer_name || "not named")}. Notice ${row.noc_number}, date ${published}. Source: Health Canada Notice of Compliance Database, Open Government Licence – Canada.`,
      source_url: `${HC_PAGE}${row.noc_number}`,
      source_type: "regulator",
      source_name: "Health Canada Notice of Compliance Database",
      published_at: published,
      scout_source: "health-canada-noc",
      rule,
      adjustments: row.noc_status_with_conditions === "Y" && rule !== "hc-noc-c" ? ["with-conditions"] : [],
      dedupe_key: `hc:${row.noc_number}`,
    });
  }
  return safeItems(rows);
}

const PAPER_CLAIM = /\b(effective|efficacy|superior|improved|benefit|success|safe and well)\b/i;

export function europePmcItems(results) {
  const rows = [];
  for (const record of results || []) {
    const title = String(record.title || "").replace(/\s+/g, " ").trim();
    if (!title || PAPER_CLAIM.test(title)) continue;
    if (!/\bphase\s*(3|iii)\b/i.test(title)) continue;
    if (!/\b(trial|study|randomi[sz]ed)\b/i.test(title)) continue;
    const published = String(record.firstPublicationDate || "").slice(0, 10);
    const doi = String(record.doi || "");
    const source = String(record.source || "");
    const id = String(record.id || "");
    const url = /^10\.\d+\//.test(doi) ? `https://doi.org/${doi}` : (source && id ? `https://europepmc.org/article/${source}/${id}` : "");
    rows.push({
      id: `europepmc:${source}:${id}`,
      headline: title,
      blurb: rows.length % 2 === 0 ? "" : `Europe PMC ${source} ${id}, first publication date ${published}.`,
      source_url: url,
      source_type: "paper",
      source_name: "Europe PMC",
      published_at: published,
      scout_source: "europepmc",
      rule: "paper-phase3",
      dedupe_key: `paper:${doi || id}`,
    });
  }
  return safeItems(rows);
}

export function calendarItems(calendar, today) {
  const from = addDays(today, -5);
  const until = addDays(today, 18);
  const generated = String(calendar.generated_at || "").slice(0, 10);
  const events = (calendar.events || []).filter((event) => {
    if (!event || (event.phase !== "PHASE3" && event.phase !== "PHASE2")) return false;
    if (!event.readout_date || event.readout_date < from || event.readout_date > until) return false;
    if (["WITHDRAWN", "TERMINATED", "SUSPENDED"].includes(event.status)) return false;
    return String(event.url || "").startsWith("https://clinicaltrials.gov/study/");
  });
  events.sort((a, b) => a.readout_date.localeCompare(b.readout_date) || a.nct_id.localeCompare(b.nct_id));
  let phase2 = 0;
  const rows = [];
  for (const event of events) {
    const phase3 = event.phase === "PHASE3";
    if (!phase3) {
      phase2 += 1;
      if (phase2 > 2) continue;
    }
    const status = String(event.status || "").replaceAll("_", " ").toLowerCase();
    const when = String(event.readout_date_type || "listed").toLowerCase();
    rows.push({
      id: `clinicaltrials-calendar:${event.nct_id}:${event.readout_date}`,
      headline: `${phase3 ? "Phase 3" : "Phase 2"} primary completion listed for ${event.readout_date}: ${event.title}`,
      blurb: !phase3 && phase2 === 2
        ? ""
        : `${event.sponsor || "Sponsor not named"}. ClinicalTrials.gov status ${status}. The ${when} primary completion date is taken from this site's readout calendar generated ${generated || "earlier"}.`,
      source_url: event.url,
      source_type: "trial",
      source_name: "ClinicalTrials.gov",
      published_at: event.readout_date,
      scout_source: "clinicaltrials-calendar",
      rule: phase3 ? "trial-phase3" : "trial-phase2",
      dedupe_key: `nct:${event.nct_id}`,
    });
  }
  return safeItems(rows);
}

async function openFdaSearch(polite, pathName, search, { pages = 8, limit = 100 } = {}) {
  const out = [];
  for (let page = 0; page < pages; page++) {
    const url = `${OPENFDA}${pathName}?search=${search}&limit=${limit}&skip=${page * limit}`;
    const payload = await polite.getJson(url);
    if (!payload) break;
    const batch = payload.results || [];
    out.push(...batch);
    const total = payload.meta?.results?.total ?? out.length;
    if (!batch.length || out.length >= total) break;
  }
  return out;
}

async function fetchDrugsfda(ctx) {
  const from = addDays(ctx.today, -100).replaceAll("-", "");
  const to = ctx.today.replaceAll("-", "");
  const search = `submissions.submission_status_date:[${from}+TO+${to}]+AND+submissions.submission_status:AP`;
  const applications = await openFdaSearch(ctx.polite, "/drug/drugsfda.json", search);
  return {
    items: drugsfdaItems(applications, ctx.today),
    note: `openFDA drugsfda applications with an approval dated ${from} to ${to}, filtered locally to the matching submission.`,
  };
}

async function fetchCrl(ctx) {
  const from = addDays(ctx.today, -160);
  const search = `letter_date:[${from.replaceAll("-", "")}+TO+${ctx.today.replaceAll("-", "")}]`;
  const url = `${OPENFDA}/transparency/crl.json?search=${search}&limit=20&sort=letter_date:desc`;
  const payload = await ctx.polite.getJson(url);
  return {
    items: crlItems(payload?.results || [], ctx.today),
    note: "Personal fields in the openFDA letter (representative, signatory, address) are not copied.",
  };
}

async function fetchOrange(ctx) {
  const buf = await ctx.polite.cachedBuffer(ORANGE_ZIP, "orangebook.zip", { timeout: 180000 });
  if (!buf || buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("Orange Book download was not a zip");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ob-"));
  const zipPath = path.join(dir, "orangebook.zip");
  fs.writeFileSync(zipPath, buf);
  const listed = await execFileAsync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  const names = listed.stdout.split(/\r?\n/).filter(Boolean);
  const tables = {};
  for (const key of ["products", "patent", "exclusivity"]) {
    const inner = names.find((name) => path.basename(name).toLowerCase() === `${key}.txt`);
    if (!inner) throw new Error(`Orange Book zip is missing ${key}.txt`);
    const extracted = await execFileAsync("unzip", ["-p", zipPath, inner], { encoding: "buffer", maxBuffer: 80 * 1024 * 1024 });
    tables[key] = parseTildeTable(extracted.stdout.toString("latin1"));
  }
  return {
    items: orangeBookLoe(tables, ctx.today),
    note: "Monthly Orange Book zip. Headlines are NDA applications whose last unexpired listed protection falls within 75 days. Listed patents are not verified by FDA.",
  };
}

const PURPLE_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function purpleCandidates(today) {
  const [year, month] = today.split("-").map(Number);
  const out = [];
  for (let offset = 0; offset < 3; offset++) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    const name = PURPLE_MONTHS[date.getUTCMonth()];
    const y = date.getUTCFullYear();
    out.push({
      label: `${name} ${y}`,
      file: `purplebook-${y}-${name.toLowerCase()}.csv`,
      url: `https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/${y}/purplebook-search-${name}-data-download.csv`,
    });
  }
  return out;
}

async function fetchPurple(ctx) {
  let used = null;
  let csv = null;
  for (const candidate of purpleCandidates(ctx.today)) {
    const buf = await ctx.polite.cachedBuffer(candidate.url, candidate.file, { timeout: 120000 });
    if (!buf) continue;
    used = candidate;
    csv = buf.toString("utf8");
    break;
  }
  if (!csv || !used) throw new Error("no Purple Book monthly CSV was available for the current or two previous months");
  return {
    items: purpleBookItems(csv, used.url),
    note: `Changes section of ${used.label} (${used.url}). The full-database section of the file is not turned into headlines.`,
  };
}

async function fetchAdcom(ctx) {
  const url = new URL(FR_API);
  url.searchParams.append("conditions[agencies][]", "food-and-drug-administration");
  url.searchParams.append("conditions[type][]", "NOTICE");
  url.searchParams.append("conditions[term]", "\"advisory committee\"");
  url.searchParams.append("conditions[publication_date][gte]", addDays(ctx.today, -120));
  url.searchParams.append("order", "newest");
  url.searchParams.append("per_page", "100");
  for (const field of ["title", "document_number", "publication_date", "dates", "html_url", "abstract"]) {
    url.searchParams.append("fields[]", field);
  }
  const payload = await ctx.polite.getJson(url.href);
  return {
    items: adcomItems(payload?.results || [], ctx.today),
    note: "Meeting, amendment, postponement, and cancellation notices only. Nominations, renewals, and tobacco notices are dropped.",
  };
}

async function fetchEma(ctx) {
  const buf = await ctx.polite.cachedBuffer(EMA_URL, "ema-medicines.json", { timeout: 180000 });
  if (!buf) throw new Error("EMA medicines export was not available");
  const payload = JSON.parse(buf.toString("utf8"));
  const records = Array.isArray(payload) ? payload : payload.data || [];
  return {
    items: emaItems(records, ctx.today),
    note: "EMA daily medicines JSON. Variation decisions are not used; European Commission decision dates on already-authorised medicines are ignored. Source: European Medicines Agency.",
  };
}

async function fetchHealthCanada(ctx) {
  const tables = {};
  for (const name of ["noticeofcompliancemain", "drugproduct", "medicinalingredient"]) {
    const buf = await ctx.polite.cachedBuffer(`${HC_BASE}${name}/?lang=en&type=json`, `hc_noc_${name}.json`, { timeout: 180000 });
    if (!buf) throw new Error(`Health Canada table ${name} was not available`);
    tables[name] = JSON.parse(buf.toString("utf8"));
  }
  return {
    items: healthCanadaItems(tables, ctx.today),
    note: "Health Canada Notice of Compliance Database. Contains information licensed under the Open Government Licence – Canada. Administrative and veterinary notices are dropped.",
  };
}

async function fetchEuropePmc(ctx) {
  const url = new URL(EPMC);
  const from = addDays(ctx.today, -21);
  url.searchParams.set("query", `FIRST_PDATE:[${from} TO ${ctx.today}] AND (TITLE:"phase 3 trial" OR TITLE:"phase III trial" OR TITLE:"phase 3 study" OR TITLE:"phase III study" OR TITLE:"phase 3 randomized" OR TITLE:"phase III randomized" OR TITLE:"phase 3 randomised" OR TITLE:"phase III randomised")`);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", "15");
  url.searchParams.set("resultType", "lite");
  const payload = await ctx.polite.getJson(url.href);
  return {
    items: europePmcItems(payload?.resultList?.result || []),
    note: "Europe PMC, the same API the site demo calls. Titles that assert efficacy or effectiveness are skipped. Crawl-delay on ebi.ac.uk is respected.",
  };
}

async function fetchCalendar(ctx) {
  const file = path.join(ctx.root, "calendar", "calendar.json");
  const calendar = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    items: calendarItems(calendar, ctx.today),
    note: "Read-only use of calendar/calendar.json. The ClinicalTrials.gov API is not called, because robots.txt disallows /api/. Study-page links are used. This job does not write calendar files.",
  };
}

export const SOURCES = [
  {
    id: "openfda-drugsfda",
    enabled: true,
    fetch: fetchDrugsfda,
  },
  {
    id: "openfda-crl",
    enabled: true,
    fetch: fetchCrl,
  },
  {
    id: "orange-book",
    enabled: true,
    fetch: fetchOrange,
  },
  {
    id: "purple-book",
    enabled: true,
    fetch: fetchPurple,
  },
  {
    id: "federal-register-adcom",
    enabled: true,
    fetch: fetchAdcom,
  },
  {
    id: "ema",
    enabled: true,
    fetch: fetchEma,
  },
  {
    id: "health-canada-noc",
    enabled: true,
    fetch: fetchHealthCanada,
  },
  {
    id: "europepmc",
    enabled: true,
    fetch: fetchEuropePmc,
  },
  {
    id: "clinicaltrials-calendar",
    enabled: true,
    fetch: fetchCalendar,
  },
  {
    id: "clinicaltrials-api",
    enabled: false,
    reason: "clinicaltrials.gov robots.txt Disallow: /api/ for User-agent *. The populator does not call it. Study records already extracted into calendar/calendar.json are read locally.",
  },
  {
    id: "swissmedic",
    enabled: false,
    reason: `Disabled. Written consent was requested on ${CONSENT_DATE} and has not been granted. Swissmedic terms require prior written consent for reproduction and prohibit automated extraction except on areas meant for it.`,
  },
  {
    id: "pmda",
    enabled: false,
    reason: `Disabled. Written consent was requested on ${CONSENT_DATE} and has not been granted. PMDA site policy says automated crawling or download applications are not permitted.`,
  },
];
