import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  adcomCopy,
  areaFromClass,
  crlCopy,
  emaCopy,
  fdaApprovalCopy,
  healthCanadaCopy,
  indicationPhrase,
  orangeCopy,
  paperRecords,
  purpleCopy,
  safeItems,
  trialCopy,
} from "./copy.mjs";
import { MORE_SOURCES } from "./more-sources.mjs";
import { addDays, isoFromDmy, isoFromMdy, isoFromUs, isoFromYmd, parseCsv, titleCaseCaps } from "./text.mjs";

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

function namesOf(application, labels) {
  const brands = [];
  const ingredients = [];
  let route = "";
  let dosage = "";
  for (const product of application.products || []) {
    if (product.brand_name && !brands.includes(product.brand_name)) brands.push(product.brand_name);
    if (!route && product.route) route = product.route;
    if (!dosage && product.dosage_form) dosage = product.dosage_form;
    for (const ingredient of product.active_ingredients || []) {
      if (ingredient.name && !ingredients.includes(ingredient.name)) ingredients.push(ingredient.name);
    }
  }
  const brand = titleCaseCaps(brands[0] || "");
  const ingredient = titleCaseCaps(ingredients[0] || "");
  const key = String(application.application_number || "").replace(/\s+/g, "");
  const extra = labels?.get?.(key) || {};
  const epc = areaFromClass((application.openfda?.pharm_class_epc || [])[0] || "");
  return {
    brand,
    ingredient: ingredient.length > 80 ? "" : ingredient,
    sponsor: titleCaseCaps(application.sponsor_name || ""),
    route,
    dosage,
    indication: extra.indication || "",
    area: extra.area || epc,
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

export function drugsfdaItems(applications, today, labels = new Map()) {
  const from = addDays(today, -100);
  const rows = [];
  for (const application of applications) {
    for (const submission of application.submissions || []) {
      if (submission.submission_status !== "AP") continue;
      const published = isoFromYmd(submission.submission_status_date);
      if (!published || published < from || published > today) continue;
      const rule = fdaRule(application, submission);
      if (!rule) continue;
      const named = namesOf(application, labels);
      const app = prettyApp(application.application_number);
      const desc = submission.submission_class_code_description || submission.submission_class_code || "original";
      const priority = submission.review_priority === "PRIORITY";
      const id = `openfda-drugsfda:${application.application_number}:${published}:${submission.submission_type}:${submission.submission_number || ""}`;
      const copy = fdaApprovalCopy(id, {
        rule,
        brand: named.brand,
        ingredient: named.ingredient,
        sponsor: named.sponsor,
        app,
        desc,
        priority,
        reviewPriority: submission.review_priority || "",
        published,
        indication: named.indication,
        area: named.area,
        route: named.route,
        dosage: named.dosage,
      });
      if (!copy) continue;
      const adjustments = [];
      if (priority && rule !== "fda-anda") adjustments.push("priority-review");
      if (/\bfirst\b/i.test(`${named.indication} ${desc}`)) adjustments.push("source-first");
      rows.push({
        id,
        headline: copy.headline,
        blurb: copy.blurb,
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
    const id = `openfda-crl:${file}`;
    const copy = crlCopy(id, { apps: apps.join(", "), company, topics, status, published });
    if (!copy) continue;
    rows.push({
      id,
      headline: copy.headline,
      blurb: copy.blurb,
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
  return safeItems(hits.slice(0, 8).map((hit) => {
    const id = `orange-book:${hit.applNo}:${hit.protection.date}`;
    const copy = orangeCopy(id, {
      who: hit.who,
      applNo: hit.applNo,
      date: hit.protection.date,
      kind: hit.protection.kind,
      code: hit.protection.code,
      applicant: hit.applicant,
    });
    if (!copy) return null;
    return {
    id,
    headline: copy.headline,
    blurb: copy.blurb,
    source_url: `${ORANGE_PAGE}?Appl_Type=N&Appl_No=${encodeURIComponent(hit.applNo)}`,
    source_type: "regulator",
    source_name: "FDA Orange Book",
    published_at: hit.protection.date,
    scout_source: "orange-book",
    rule: hit.protection.kind === "exclusivity" ? "orange-loe-exclusivity" : "orange-loe-patent",
    dedupe_key: `orange:${hit.applNo}`,
    };
  }));
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
    const report = stamp ? stamp[0] : "monthly";
    const pushPurple = (event, published, rule, dedupe) => {
      const id = `purple-book:${bla}:${event}:${published}`;
      const copy = purpleCopy(id, {
        event, who, bla, applicant, license, licensure, published, report, substance,
        ref: refTrade || refProper,
      });
      if (!copy) return;
      rows.push({
        id,
        headline: copy.headline,
        blurb: copy.blurb,
        source_url: source,
        source_type: "regulator",
        source_name: "FDA Purple Book",
        published_at: published,
        scout_source: "purple-book",
        rule,
        dedupe_key: dedupe,
      });
    };
    if (/revok/i.test(licensure) && bounds.start) {
      pushPurple("revoked", bounds.start, "purple-revoked", `bla:${bla}:revoked`);
      continue;
    }
    if (inter) {
      pushPurple("interchangeable", inter, "purple-interchangeable", `bla:${bla}:interchangeable`);
      continue;
    }
    if (!flaggedNew || !approval || (bounds.end && approval < addDays(bounds.end, -150))) continue;
    const biosimilar = /351\(k\)|biosimilar/i.test(license);
    pushPurple("new", approval, biosimilar ? "purple-biosimilar" : "purple-351a", `bla:${bla}:orig`);
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
    const id = `adcom:${doc.document_number || meeting}:${kind}`;
    const copy = adcomCopy(id, { kind, meeting, committee, rest, published });
    if (!copy) continue;
    rows.push({
      id,
      headline: copy.headline,
      blurb: copy.blurb,
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
    const statusWord = String(record.opinion_status || "recorded").toLowerCase();
    const event = {
      "ema-opinion": `EMA ${statusWord} opinion`,
      "ema-authorisation": "EMA marketing authorisation",
      "ema-refusal": "EMA refusal",
      "ema-withdrawal": "EMA application withdrawal",
      "ema-lapse": `EMA lists ${record.medicine_status || "a status change"}`,
    }[rule];
    const id = `ema:${record.ema_product_number || name}:${rule}:${published}`;
    const indication = String(record.therapeutic_indication || "").replace(/\s+/g, " ").trim();
    const copy = emaCopy(id, {
      rule,
      name,
      inn,
      event,
      indication: indication.length <= 140 ? indication : "",
      mesh: String(record.therapeutic_area_mesh || "").replace(/\s+/g, " ").trim(),
      group: String(record.pharmacotherapeutic_group_human || "").replace(/\s+/g, " ").trim(),
      holder: String(record.marketing_authorisation_developer_applicant_holder || "").replace(/\s+/g, " ").trim(),
      productNumber: record.ema_product_number || "",
      published,
      orphan: yes(record.orphan_medicine),
      conditional: yes(record.conditional_approval),
      biosimilar: yes(record.biosimilar),
      medicineStatus: record.medicine_status || "",
    });
    if (!copy) continue;
    rows.push({
      id,
      headline: copy.headline,
      blurb: copy.blurb,
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
    const kind = {
      "hc-priority-nas": "priority new active substance",
      "hc-nas": "new active substance",
      "hc-noc-c": "notice of compliance with conditions",
      "hc-nds": "new drug submission",
      "hc-snds": "supplement",
      "hc-ands": "abbreviated submission",
    }[rule];
    const id = `health-canada:${row.noc_number}`;
    const reason = String(row.noc_reason_submission || row.noc_reason_supplement || "").replace(/\s+/g, " ").trim();
    const copy = healthCanadaCopy(id, {
      brand,
      ingredient,
      notice: row.noc_number,
      kind,
      manufacturer: titleCaseCaps(row.noc_manufacturer_name || ""),
      published,
      therapeuticClass: String(row.noc_therapeutic_class || "").replace(/\s+/g, " ").trim(),
      reason: reason.length <= 140 ? reason : "",
    });
    if (!copy) continue;
    rows.push({
      id,
      headline: copy.headline,
      blurb: copy.blurb,
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

export function europePmcItems(results, options = {}) {
  return paperRecords(results, { mode: "phase3", scout: "europepmc", sourceName: "Europe PMC", rule: "paper-phase3", label: "Europe PMC", ...options });
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
    const id = `clinicaltrials-calendar:${event.nct_id}:${event.readout_date}`;
    const copy = trialCopy(id, {
      phase3,
      title: String(event.title || "").replace(/\s+/g, " ").trim(),
      condition: titleCaseCaps(event.conditions || ""),
      sponsor: event.sponsor || "",
      status,
      when,
      date: event.readout_date,
      generated,
    });
    if (!copy) continue;
    rows.push({
      id,
      headline: copy.headline,
      blurb: copy.blurb,
      source_url: event.url,
      source_type: "trial",
      source_name: "ClinicalTrials.gov",
      published_at: event.readout_date,
      scout_source: "clinicaltrials-calendar",
      rule: phase3 ? "trial-phase3" : "trial-phase2",
      adjustments: phase3 ? ["pivotal-readout"] : [],
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

async function labelFacts(polite, applicationNumbers) {
  const map = new Map();
  const apps = [...new Set(applicationNumbers.map((value) => String(value || "").replace(/\s+/g, "")).filter(Boolean))].slice(0, 40);
  for (let i = 0; i < apps.length; i += 4) {
    const chunk = apps.slice(i, i + 4);
    const search = `(${chunk.map((value) => `openfda.application_number:${value}`).join("+OR+")})`;
    const url = `${OPENFDA}/drug/label.json?search=${search}&limit=${chunk.length}`;
    let payload = null;
    try {
      payload = await polite.getJson(url);
    } catch {
      continue;
    }
    for (const rec of payload?.results || []) {
      const indication = indicationPhrase((rec.indications_and_usage || [])[0] || "");
      const area = areaFromClass((rec.openfda?.pharm_class_epc || [])[0] || "");
      for (const num of rec.openfda?.application_number || []) {
        map.set(String(num).replace(/\s+/g, ""), { indication, area });
      }
    }
  }
  return map;
}

async function fetchDrugsfda(ctx) {
  const from = addDays(ctx.today, -100).replaceAll("-", "");
  const to = ctx.today.replaceAll("-", "");
  const search = `submissions.submission_status_date:[${from}+TO+${to}]+AND+submissions.submission_status:AP`;
  const applications = await openFdaSearch(ctx.polite, "/drug/drugsfda.json", search);
  const prelim = drugsfdaItems(applications, ctx.today);
  const byDate = [...prelim].sort((a, b) => (a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0));
  const preferred = byDate.filter((row) => row.rule === "fda-nme" || row.rule === "fda-bla");
  const numbers = [];
  const seen = new Set();
  for (const row of [...preferred, ...byDate]) {
    const num = String(row.id.split(":")[1] || "").replace(/\s+/g, "");
    if (!num || seen.has(num)) continue;
    seen.add(num);
    numbers.push(num);
    if (numbers.length >= 40) break;
  }
  let labels = new Map();
  try {
    labels = await labelFacts(ctx.polite, numbers);
  } catch {
    labels = new Map();
  }
  const withLabels = labels.size ? drugsfdaItems(applications, ctx.today, labels) : prelim;
  return {
    items: withLabels,
    note: `openFDA drugsfda applications with an approval dated ${from} to ${to}, filtered locally to the matching submission. Indication text is copied only when an openFDA label indications_and_usage field, or an EPC class, is present (${labels.size} labels matched).`,
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

async function europeQuery(polite, query, pageSize) {
  const url = new URL(EPMC);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("sort", "P_PDATE_D desc");
  const payload = await polite.getJson(url.href);
  return payload?.resultList?.result || [];
}

async function fetchEuropePmc(ctx) {
  const phaseFrom = addDays(ctx.today, -45);
  const recentFrom = addDays(ctx.today, -21);
  const phase = await europeQuery(ctx.polite, `FIRST_PDATE:[${phaseFrom} TO ${ctx.today}] AND (TITLE:"phase 3" OR TITLE:"phase III") AND (TITLE:trial OR TITLE:study OR TITLE:randomized OR TITLE:randomised)`, 15);
  const journals = await europeQuery(ctx.polite, `FIRST_PDATE:[${recentFrom} TO ${ctx.today}] AND SRC:MED AND (JOURNAL:"N Engl J Med" OR JOURNAL:"Lancet" OR JOURNAL:"JAMA" OR JOURNAL:"Nature Medicine" OR JOURNAL:"Nature Biotechnology" OR JOURNAL:"Nature" OR JOURNAL:"Science" OR JOURNAL:"Cell" OR JOURNAL:"BMJ")`, 15);
  const ai = await europeQuery(ctx.polite, `FIRST_PDATE:[${recentFrom} TO ${ctx.today}] AND (TITLE:"machine learning" OR TITLE:"deep learning" OR TITLE:"protein language" OR TITLE:"artificial intelligence") AND (TITLE:protein OR TITLE:genom OR TITLE:molecul OR TITLE:drug OR TITLE:cell OR TITLE:biolog)`, 12);
  const items = [
    ...paperRecords(phase, { mode: "phase3", from: phaseFrom, today: ctx.today, rule: "paper-phase3" }),
    ...paperRecords(journals, { mode: "journal", from: recentFrom, today: ctx.today, rule: "paper-journal" }),
    ...paperRecords(ai, { mode: "ai", from: recentFrom, today: ctx.today, rule: "paper-ai" }),
  ];
  return {
    items,
    note: "Europe PMC metadata, including MEDLINE records. PubMed E-utilities are not called: eutils.ncbi.nlm.nih.gov robots.txt is Disallow: /. Queries cover phase 3 titles, a fixed high-impact journal list, and AI-in-biology titles. Titles that assert efficacy or effectiveness are skipped. Crawl-delay on ebi.ac.uk is respected.",
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
  ...MORE_SOURCES,
  {
    id: "clinicaltrials-api",
    enabled: false,
    reason: "clinicaltrials.gov robots.txt Disallow: /api/ for User-agent *. The populator does not call it. Study records already extracted into calendar/calendar.json are read locally.",
  },
  {
    id: "pubmed-eutils",
    enabled: false,
    // eutils.ncbi.nlm.nih.gov robots.txt is a blanket disallow. MEDLINE records are read through Europe PMC instead.
    reason: "Disabled. eutils.ncbi.nlm.nih.gov robots.txt says Disallow: / for User-agent *. The populator does not call PubMed E-utilities. MEDLINE records are queried through Europe PMC, whose API allows this use.",
  },
  {
    id: "x",
    enabled: false,
    // data/x_allowlist_v1.csv lists handles, but reading posts needs the X API.
    // That API requires credentials, and this repository does not store any.
    // Unofficial scraping or syndication would conflict with X's terms.
    reason: "Disabled. X posts are not fetched. The X API requires credentials, and this repository does not store any. Scraping or an unofficial syndication feed would conflict with X's terms. Handles that would be in scope remain listed in data/x_allowlist_v1.csv.",
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
  {
    id: "arxiv-rss",
    enabled: false,
    reason: "Disabled. export.arxiv.org robots.txt is Disallow: / for User-agent *. arXiv items still arrive through the BioCatalystFeed Worker /ai-discovery endpoint, which is our own API.",
  },
  {
    id: "anthropic",
    enabled: false,
    reason: "Disabled. No official public RSS was found at anthropic.com/rss.xml or /news/rss.xml (both 404). Not scraped.",
  },
  {
    id: "meta-ai",
    enabled: false,
    reason: "Disabled. ai.meta.com/blog/rss/ returned 404. No official RSS confirmed. Not scraped.",
  },
  {
    id: "arc-institute",
    enabled: false,
    reason: "Disabled. arcinstitute.org/feed returned 404. No official RSS confirmed. Not scraped.",
  },
  {
    id: "isomorphic",
    enabled: false,
    reason: "Disabled. isomorphiclabs.com/feed and /rss.xml returned 404. No official RSS confirmed. Not scraped.",
  },
  {
    id: "evolutionaryscale",
    enabled: false,
    reason: "Disabled. evolutionaryscale.ai/blog/rss.xml returned 404. No official RSS confirmed. Not scraped.",
  },
  {
    id: "nature-news",
    enabled: false,
    reason: "Disabled. Nature publishes an RSS file and robots.txt allows /nature.rss, but Springer Nature terms do not clearly allow a third party to aggregate headlines into another product.",
  },
  {
    id: "science-news",
    enabled: false,
    reason: "Disabled. Science/AAAS publishes a news RSS and robots.txt allows the path, but AAAS terms do not clearly allow headline aggregation.",
  },
  {
    id: "mit-tech-review",
    enabled: false,
    reason: "Disabled. MIT Technology Review publishes an RSS feed, but its terms do not clearly allow reuse of headlines in another product. robots.txt also disallows a long list of automated agents.",
  },
  {
    id: "new-scientist",
    enabled: false,
    reason: "Disabled. New Scientist publishes an RSS feed, but its terms do not clearly allow headline aggregation, and robots.txt blocks many automated clients.",
  },
  {
    id: "bbc-news",
    enabled: false,
    reason: "Disabled. BBC health and science RSS feeds exist and robots.txt allows those paths, but BBC RSS use is limited to personal, non-commercial use.",
  },
  {
    id: "reuters",
    enabled: false,
    reason: "Disabled. The Reuters outbound news RSS URL returned 404. No official public RSS was confirmed, and third-party Reuters feeds are not used.",
  },
  {
    id: "ap-news",
    enabled: false,
    reason: "Disabled. apnews.com did not return an official RSS document (403). Third-party AP feeds are not used.",
  },
  {
    id: "stat-news",
    enabled: false,
    reason: "Disabled. STAT terms reserve republication and do not clearly allow an aggregation product.",
  },
  {
    id: "endpoints-news",
    enabled: false,
    reason: "Disabled. Endpoints News terms do not clearly allow headline aggregation.",
  },
  {
    id: "fierce-biotech",
    enabled: false,
    reason: "Disabled. Fierce Biotech terms do not clearly allow headline aggregation.",
  },
  {
    id: "nmpa",
    enabled: false,
    reason: "Disabled. No official English NMPA or CDE feed with clear automated-reuse terms was confirmed. The site is not scraped.",
  },
  {
    id: "cdsco",
    enabled: false,
    reason: "Disabled. No official CDSCO RSS with clear reuse terms was confirmed. The site is not scraped.",
  },
  {
    id: "mfds",
    enabled: false,
    reason: "Disabled. No official English MFDS RSS with clear reuse terms was confirmed. The site is not scraped.",
  },
  {
    id: "japan-english-news",
    enabled: false,
    reason: "Disabled. PMDA automated retrieval stays off. No separate official English Japan regulator news feed with clear reuse terms was confirmed.",
  },
  {
    id: "china-biotech-press",
    enabled: false,
    reason: "Disabled. No English-language Chinese biotech press RSS was found whose terms clearly allow headline-and-link aggregation.",
  },
];
