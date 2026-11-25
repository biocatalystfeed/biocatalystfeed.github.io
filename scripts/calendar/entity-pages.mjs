// Sponsor, modality, and "alternatives to" pages for the calendar entity pipeline.
//
// Inputs are records already published on /calendar/ (trial rows, drug pages, company
// pages, disease-area matchers). Nothing is fetched. Modality is read from the drug
// name only. A name that does not match a rule stays unclassified.
//
// Thresholds (pages below these are not written):
// - Sponsor: at least 2 distinct trials that are not already listed on a matched
//   company page, and at least 1 linked drug page or disease-area match among them.
//   A sponsor whose trials are already on a company page does not get a second page.
//   When the names match but the company page is missing those trials, the sponsor
//   page is kept and links to the company page. Junk labels (comparator, background
//   chemotherapy, placebo, arm/group/cohort/part/lot/level) never get a page.
// - Modality: at least 4 drugs with their own drug pages and a name-rule match.
//   Unclassified drugs are omitted. There is no default of "small molecule".
// - Alternatives: a drug page only if at least 2 other non-junk drug pages share
//   one disease area and the same modality. Broad areas are excluded (solid tumors,
//   lung cancer (all), vaccines, bacterial infections, pain, rare metabolic,
//   anxiety and PTSD) because they are not one indication. No page when modality
//   is unclassified.

import { areasForText, compileAreas } from "./areas.mjs";
import { cleanDrugNames, drugSlug, isPlaceholderDrug } from "./drug-names.mjs";

export const SITE = "https://biocat.ai";

export const THRESHOLDS = {
  minSponsorTrials: 2,
  minSponsorContext: 1,
  minModalityDrugs: 4,
  minAlternativeOthers: 2,
  maxTableRows: 80,
  maxDrugsOnPage: 40,
  maxAreasOnPage: 12,
  maxAltPerSection: 30,
  maxLinkAreas: 8,
  maxLinkMods: 4,
  maxLinkSponsors: 8,
};

export const BROAD_ALTERNATIVE_AREAS = new Set([
  "solid-tumors",
  "lung-cancer",
  "vaccines",
  "bacterial-infections",
  "pain",
  "rare-metabolic",
  "anxiety-ptsd",
]);

export const MODALITIES = [
  { id: "adc", slug: "antibody-drug-conjugate", label: "Antibody-drug conjugate" },
  { id: "bispecific", slug: "bispecific", label: "Bispecific antibody" },
  { id: "cell", slug: "cell-therapy", label: "Cell therapy" },
  { id: "vaccine", slug: "vaccine", label: "Vaccine" },
  { id: "gene", slug: "gene-therapy", label: "Gene therapy" },
  { id: "rna", slug: "rna-oligonucleotide", label: "RNA and oligonucleotide" },
  { id: "radio", slug: "radiopharmaceutical", label: "Radiopharmaceutical" },
  { id: "mab", slug: "monoclonal-antibody", label: "Monoclonal antibody" },
  { id: "peptide", slug: "peptide", label: "Peptide" },
  { id: "small", slug: "small-molecule", label: "Small molecule" },
];

const MODALITY_BY_ID = new Map(MODALITIES.map((m) => [m.id, m]));

const RULE_TEXT = {
  adc: "The name contains an antibody-drug conjugate word or an INN payload stem such as vedotin, deruxtecan, govitecan, mafodotin, soravtansine, emtansine, ozogamicin, or tesirine.",
  bispecific: "The drug name contains the word bispecific, or ends in the INN stem -mig (multi-immunoglobulin). Other antibody names stay with monoclonal antibodies or stay unclassified.",
  cell: "The drug name contains CAR-T, CAR-NK, cell therapy, tumor-infiltrating, or an INN -leucel stem.",
  vaccine: "The drug name contains the word vaccine. An mRNA vaccine stays in this group.",
  gene: "The drug name contains gene therapy, gene editing, CRISPR, AAV, lentiviral, or adeno-associated.",
  rna: "The drug name contains siRNA, mRNA, RNAi, antisense, oligonucleotide, or an INN stem -siran, -rsen, or -meran.",
  radio: "The drug name contains radiopharmaceutical, radioligand, lutetium, actinium, or an isotope token such as 177Lu, 68Ga, or 225Ac.",
  mab: "The drug name ends in the INN stem -mab, or a longer antibody stem (-tug, -bart, -ment), and was not already classified as an antibody-drug conjugate or a bispecific.",
  peptide: "The drug name contains the word peptide, or ends in the INN stem -tide (not nucleotide).",
  small: "The drug name contains the words small molecule. Other unclassified names are not placed here.",
};

// Same junk-drug pattern the page pipeline applies before a drug can be an entity.
const JUNK_DRUG = /^(background|best available|standard|supportive care|lymphodepleting|lymphodepletion|platinum|chemotherapy|comparator|matching|usual|test drug|test product|vaccine|androgen deprivation|conventional|optimal|local|physician|treatment|therapy|medication|drug|product|non-platinum|doublets?|single agent)\b|\bchemotherapy$|\bppm\b|\bdical base\b|^fluoride\b|\bcomparator\b|^(adt|bat|esa|ici|pdt|usp|mic|naf|na therapy|soc|bsc|tpc)$/i;

const SPONSOR_JUNK = /^(background( chemotherapy| treatment)?|best available therapy|standard of care|standard treatment|supportive care(?: measures)?|lymphodepletion|lymphodepleting chemotherapy|platinum chemotherapy|chemotherapy|comparator|placebo|vehicle|control|matching dosage|usual care|test drug\b.*|test product\b.*|androgen deprivation|single agent|physician'?s choice|investigational (drug|product)|study drug|na therapy|arm\b.*|cohort\b.*|group\b.*|part\b.*|level\b.*|lot\b.*)$/i;

const ORG_DROP = new Set([
  "inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "sa", "ag", "gmbh", "nv", "bv",
  "pty", "kk", "the", "of", "and", "group", "holdings", "holding", "pharmaceuticals", "pharmaceutical", "pharma",
  "therapeutics", "biosciences", "bioscience", "biopharmaceuticals", "biopharma", "laboratories", "labs",
  "incorporated", "usa", "us", "lp", "srl", "sas", "oy", "spa", "sl",
]);

// Tokens that show up in many unrelated organisation names. They do not count toward a company match.
const MATCH_STOP = new Set([
  "medical", "technology", "technologies", "science", "sciences", "bio", "biotech", "biotechnology",
  "health", "healthcare", "united", "international", "global", "research", "development", "institute",
  "hospital", "university", "national", "center", "centre", "college", "clinical", "innovation", "life",
  "new", "care", "services", "system", "systems", "solutions", "holdings", "holding",
  "oncology", "medicine", "medicines", "biologics", "diagnostics", "vaccine", "vaccines",
]);

const ADC_STEMS = ["vedotin", "deruxtecan", "govitecan", "mafodotin", "soravtansine", "emtansine", "ozogamicin", "tesirine", "ixodotin"];

const CSS = "table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}small{color:#777}.tag{font-size:12px;padding:1px 6px;border-radius:8px;background:#eef;white-space:nowrap}.cols{columns:3 260px}h2{margin-top:28px}";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function decodeBasic(value) {
  return String(value ?? "")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function stripTags(value) {
  return decodeBasic(String(value ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function nameTokens(value) {
  return String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function orgTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1 && !ORG_DROP.has(token));
}

export function sponsorKey(name) {
  return orgTokens(name).join(" ");
}

export function entitySlug(name) {
  return drugSlug(name).slice(0, 60).replace(/-+$/g, "");
}

export function isJunkDrugName(name) {
  const raw = String(name || "").trim();
  if (!raw || !/[A-Za-z]/.test(raw)) return true;
  if (isPlaceholderDrug(raw)) return true;
  const cleaned = cleanDrugNames(raw);
  if (cleaned.length !== 1) return true;
  const next = cleaned[0];
  if (JUNK_DRUG.test(next)) return true;
  if (/\b(group|cohort|arm|level|lot|part)\s*[0-9a-z-]*$/i.test(next)) return true;
  if (/\b(group|cohort|arm)\s+\d/i.test(next)) return true;
  const opens = (raw.match(/[(\[]/g) || []).length;
  const closes = (raw.match(/[)\]]/g) || []).length;
  if (opens !== closes) return true;
  return false;
}

export function isJunkSponsor(name) {
  const raw = String(name || "").replace(/\s+/g, " ").trim();
  if (raw.length < 3 || raw.length > 140 || !/[A-Za-z]/.test(raw)) return true;
  if (isPlaceholderDrug(raw) || SPONSOR_JUNK.test(raw) || JUNK_DRUG.test(raw)) return true;
  if (/\b(comparator|placebo|background chemotherapy|standard of care|best available therapy)\b/i.test(raw)) return true;
  if (raw.split(/\s+/).length > 18) return true;
  return false;
}

export function classifyModality(name) {
  if (isJunkDrugName(name)) return null;
  const text = String(name || "");
  const tokens = nameTokens(text);
  const has = (pattern) => pattern.test(text);
  const stem = (list) => tokens.some((token) => list.some((item) => token === item || token.startsWith(item)));
  if (has(/\bantibody[- ]drug conjugate\b|\badc\b/i) || stem(ADC_STEMS)) return "adc";
  if (has(/\bbispecific\b/i) || tokens.some((token) => token.length >= 10 && token.endsWith("mig"))) return "bispecific";
  if (has(/\bcar[- ]?t\b|\bcar[- ]?nk\b|cell therapy|tumor-infiltrating|\bleucel\b/i) || tokens.some((token) => token.endsWith("leucel"))) return "cell";
  if (has(/\bvaccines?\b/i)) return "vaccine";
  if (has(/gene therapy|gene editing|\bcrispr\b|\baav\d*\b|lentiviral|adeno-associated/i)) return "gene";
  if (has(/\b(siRNA|mRNA|RNAi|ASO|antisense|oligonucleotide)\b/i) || tokens.some((token) => token.length >= 8 && /(?:siran|rsen|meran)$/.test(token))) return "rna";
  if (has(/radiopharmaceutical|radioligand|radioimmunoconjugate|lutetium|actinium|\b(68ga|177lu|225ac|212pb|131i|90y)\b|dotatate/i)) return "radio";
  if (tokens.some((token) => token.length >= 6 && token.endsWith("mab"))) return "mab";
  if (tokens.some((token) => token.length >= 10 && /(?:tug|bart|ment)$/.test(token))) return "mab";
  if (has(/\bpeptides?\b/i) || tokens.some((token) => token.length >= 8 && token.endsWith("tide") && !token.includes("nucleotide"))) return "peptide";
  if (has(/small molecule/i)) return "small";
  return null;
}

export function distinctiveTokens(name) {
  return orgTokens(name).filter((token) => token.length >= 3 && !MATCH_STOP.has(token));
}

function mentionsCompany(name, tokens) {
  if (!tokens.length) return false;
  const text = ` ${String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const phrase = tokens.join(" ");
  if (phrase.length < 5) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:subsidiary of|owned by| a | an )${escaped}(?: company)? `).test(text)
    || new RegExp(` ${escaped} company `).test(text);
}

export function matchCompany(name, companies) {
  const tokens = distinctiveTokens(name);
  if (!tokens.length) return null;
  const hits = [];
  for (const company of companies || []) {
    const other = company.tokens || distinctiveTokens(company.name);
    if (!other.length) continue;
    const right = new Set(other);
    const shared = tokens.filter((token) => right.has(token) && token.length >= 5);
    const same = tokens.length === other.length && tokens.every((token) => right.has(token));
    const prefix = tokens.length === 1 && other.length === 1 && (
      (tokens[0].startsWith(other[0]) && other[0].length >= 6 && tokens[0].length - other[0].length <= 3)
      || (other[0].startsWith(tokens[0]) && tokens[0].length >= 6 && other[0].length - tokens[0].length <= 3)
    );
    const filler = new Set(["instituto", "institute", "subsidiary", "wholly", "owned", "division", "branch", "affiliate", "affiliates"]);
    const lead = other.length === 1 && other[0].length >= 7 && (
      tokens[0] === other[0]
      || (tokens.includes(other[0]) && tokens.every((token) => token === other[0] || filler.has(token)))
    );
    if (same || shared.length >= 2 || prefix || lead || mentionsCompany(name, other)) hits.push(company);
  }
  const unique = [];
  const seen = new Set();
  for (const hit of hits) {
    if (seen.has(hit.ticker)) continue;
    seen.add(hit.ticker);
    unique.push(hit);
  }
  return unique.length === 1 ? unique[0] : null;
}

function mostCommon(map) {
  let best = "";
  let n = -1;
  for (const [name, count] of map) {
    if (count > n || (count === n && name.localeCompare(best) < 0)) {
      best = name;
      n = count;
    }
  }
  return best;
}

function allocateSlug(name, used) {
  const base = entitySlug(name);
  if (!base) return "";
  let slug = base;
  let i = 2;
  while (used.has(slug)) {
    const suffix = `-${i}`;
    slug = `${base.slice(0, Math.max(1, 60 - suffix.length))}${suffix}`.replace(/-+$/g, "");
    i += 1;
  }
  used.add(slug);
  return slug;
}

function byCountThenName(a, b) {
  return (b.count - a.count) || a.name.localeCompare(b.name);
}

function drugRecords(trials, drugsBySlug) {
  const counts = new Map();
  for (const trial of trials) {
    for (const slug of trial.drugSlugs || []) {
      const drug = drugsBySlug.get(slug);
      if (!drug || drug.junk) continue;
      counts.set(slug, (counts.get(slug) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, name: drugsBySlug.get(slug).name, count }))
    .sort(byCountThenName);
}

function areaRecords(trials, areaNames) {
  const counts = new Map();
  for (const trial of trials) {
    for (const slug of trial.areas || []) counts.set(slug, (counts.get(slug) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, name: areaNames.get(slug) || slug, count }))
    .sort(byCountThenName);
}

function modalityIdsForTrials(trials, drugsBySlug) {
  const ids = new Set();
  for (const trial of trials) {
    for (const slug of trial.drugSlugs || []) {
      const drug = drugsBySlug.get(slug);
      if (!drug || drug.junk || !drug.modality) continue;
      if (drug.modalityPage) ids.add(drug.modality);
    }
  }
  return [...ids];
}

export function planEntities(input) {
  const areaNames = input.areaNames || new Map();
  const companies = (input.companies || []).map((company) => ({
    ...company,
    tokens: company.tokens || distinctiveTokens(company.name),
    ncts: company.ncts instanceof Set ? company.ncts : new Set(company.ncts || []),
  }));
  const drugs = input.drugs || [];
  const drugsBySlug = new Map(drugs.map((drug) => [drug.slug, {
    ...drug,
    junk: drug.junk ?? isJunkDrugName(drug.name),
    modality: null,
    modalityPage: false,
    ncts: new Set(drug.ncts || []),
  }]));
  for (const drug of drugsBySlug.values()) {
    if (!drug.junk) drug.modality = classifyModality(drug.name);
  }
  const trials = input.trials || [];
  const fda = input.fda || [];
  for (const event of fda) {
    if (!/approval/i.test(event.kind || "")) continue;
    const drug = event.drugSlug && drugsBySlug.get(event.drugSlug);
    if (drug) drug.fdaApproval = true;
  }

  const modalityBuckets = new Map(MODALITIES.map((item) => [item.id, []]));
  for (const drug of drugsBySlug.values()) {
    if (drug.junk || !drug.modality) continue;
    modalityBuckets.get(drug.modality).push(drug);
  }
  const modalities = [];
  for (const item of MODALITIES) {
    const list = modalityBuckets.get(item.id) || [];
    if (list.length < THRESHOLDS.minModalityDrugs) continue;
    for (const drug of list) drug.modalityPage = true;
    const rows = list.map((drug) => {
      const drugTrials = trials.filter((trial) => drug.ncts.has(trial.nct));
      return {
        slug: drug.slug,
        name: drug.name,
        count: drugTrials.length,
        sponsors: topNames(drugTrials.map((trial) => trial.ticker ? "" : trial.sponsor).filter(Boolean), 3),
        areas: areaRecords(drugTrials, areaNames).slice(0, 3),
      };
    }).sort(byCountThenName);
    modalities.push({ ...item, drugs: rows, rule: RULE_TEXT[item.id] });
  }
  const modalityById = new Map(modalities.map((item) => [item.id, item]));

  const sponsorGroups = new Map();
  for (const trial of trials) {
    if (trial.ticker) continue;
    if (!trial.sponsor || isJunkSponsor(trial.sponsor)) continue;
    const key = sponsorKey(trial.sponsor);
    if (!key) continue;
    let group = sponsorGroups.get(key);
    if (!group) {
      group = { key, names: new Map(), trials: [], seen: new Set() };
      sponsorGroups.set(key, group);
    }
    group.names.set(trial.sponsor, (group.names.get(trial.sponsor) || 0) + 1);
    if (!group.seen.has(trial.nct)) {
      group.seen.add(trial.nct);
      group.trials.push(trial);
    }
  }

  const sponsorPages = [];
  for (const group of sponsorGroups.values()) {
    const name = mostCommon(group.names);
    const company = matchCompany(name, companies);
    let rows = group.trials;
    if (company) rows = rows.filter((trial) => !company.ncts.has(trial.nct));
    if (rows.length < THRESHOLDS.minSponsorTrials) continue;
    const drugRows = drugRecords(rows, drugsBySlug);
    const areas = areaRecords(rows, areaNames);
    if (drugRows.length + areas.length < THRESHOLDS.minSponsorContext) continue;
    const events = fda.filter((event) => !event.ticker && sponsorKey(event.company) === group.key);
    sponsorPages.push({
      key: group.key,
      name,
      company: company ? { ticker: company.ticker, name: company.name } : null,
      trials: sortTrials(rows),
      drugs: drugRows,
      areas,
      fda: events.sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    });
  }
  sponsorPages.sort((a, b) => b.trials.length - a.trials.length || a.name.localeCompare(b.name));
  const usedSponsorSlugs = new Set();
  for (const page of sponsorPages) page.slug = allocateSlug(page.name, usedSponsorSlugs);

  const areaModality = new Map();
  for (const drug of drugsBySlug.values()) {
    if (drug.junk || !drug.modality) continue;
    const counts = new Map();
    for (const trial of trials) {
      if (!drug.ncts.has(trial.nct)) continue;
      for (const area of trial.areas || []) {
        if (BROAD_ALTERNATIVE_AREAS.has(area)) continue;
        counts.set(area, (counts.get(area) || 0) + 1);
      }
    }
    for (const [area, count] of counts) {
      const key = `${area}|${drug.modality}`;
      if (!areaModality.has(key)) areaModality.set(key, []);
      areaModality.get(key).push({ slug: drug.slug, name: drug.name, count, modality: drug.modality, area });
    }
  }

  const altSections = new Map();
  for (const members of areaModality.values()) {
    if (members.length < THRESHOLDS.minAlternativeOthers + 1) continue;
    for (const member of members) {
      const others = members
        .filter((item) => item.slug !== member.slug)
        .sort(byCountThenName)
        .slice(0, THRESHOLDS.maxAltPerSection)
        .map((item) => ({
          slug: item.slug,
          name: item.name,
          count: item.count,
          fdaApproval: Boolean(drugsBySlug.get(item.slug)?.fdaApproval),
        }));
      if (others.length < THRESHOLDS.minAlternativeOthers) continue;
      if (!altSections.has(member.slug)) altSections.set(member.slug, []);
      altSections.get(member.slug).push({
        area: member.area,
        areaName: areaNames.get(member.area) || member.area,
        others,
      });
    }
  }
  const alternatives = [];
  for (const [slug, sections] of altSections) {
    const drug = drugsBySlug.get(slug);
    if (!drug || !drug.modality) continue;
    sections.sort((a, b) => a.areaName.localeCompare(b.areaName));
    alternatives.push({
      slug,
      name: drug.name,
      modality: modalityById.get(drug.modality) || MODALITY_BY_ID.get(drug.modality),
      sections,
    });
  }
  alternatives.sort((a, b) => a.name.localeCompare(b.name));

  const companyLinks = new Map();
  for (const company of companies) {
    const rows = trials.filter((trial) => trial.ticker === company.ticker);
    const areas = areaRecords(rows, areaNames).slice(0, THRESHOLDS.maxLinkAreas);
    const mods = modalityIdsForTrials(rows, drugsBySlug)
      .map((id) => modalityById.get(id))
      .filter(Boolean)
      .slice(0, THRESHOLDS.maxLinkMods);
    const sponsors = sponsorPages.filter((page) => page.company?.ticker === company.ticker);
    if (areas.length || mods.length || sponsors.length) {
      companyLinks.set(company.ticker, { areas, modalities: mods, sponsors });
    }
  }

  const drugLinks = new Map();
  for (const drug of drugsBySlug.values()) {
    if (drug.junk) continue;
    const modality = drug.modalityPage ? modalityById.get(drug.modality) : null;
    const alternative = altSections.has(drug.slug);
    if (modality || alternative) drugLinks.set(drug.slug, { name: drug.name, modality, alternative });
  }

  const conditionLinks = new Map();
  for (const [slug, name] of areaNames) {
    const sponsors = sponsorPages
      .map((page) => ({ page, count: page.areas.find((area) => area.slug === slug)?.count || 0 }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.page.name.localeCompare(b.page.name))
      .slice(0, THRESHOLDS.maxLinkSponsors)
      .map((item) => item.page);
    const mods = modalities.filter((item) => item.drugs.some((drug) => drug.areas.some((area) => area.slug === slug)));
    if (sponsors.length || mods.length) conditionLinks.set(slug, { name, sponsors, modalities: mods.slice(0, THRESHOLDS.maxLinkMods) });
  }

  return { sponsors: sponsorPages, modalities, alternatives, companyLinks, drugLinks, conditionLinks };
}

function topNames(names, limit) {
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([name]) => name);
}

function sortTrials(trials) {
  return [...trials].sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.nct.localeCompare(b.nct));
}

export function assignTrialAreas(trials, areas = compileAreas()) {
  for (const trial of trials) trial.areas = areasForText(trial.conditions || "", areas);
  return trials;
}

export function parseReadoutRow(rowHtml) {
  if (/<th\b|colspan=/i.test(rowHtml)) return null;
  const cells = [...String(rowHtml).matchAll(/<td>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
  if (cells.length < 5) return null;
  const nct = (cells[3].match(/NCT\d+/) || [])[0];
  if (!nct) return null;
  const phase = stripTags(cells[1]);
  if (!/P\d|PHASE|N\/A|^NA$/i.test(phase)) return null;
  const ticker = (cells[2].match(/company\/([A-Z0-9.]+)\//) || [])[1] || "";
  let sponsor = stripTags(cells[2]);
  if (ticker) sponsor = sponsor.replace(new RegExp(`\\s+${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim();
  const date = stripTags(cells[0]).replace(/\s*est\.\s*/i, "").trim();
  const title = stripTags(cells[3]).replace(nct, "").trim();
  return {
    nct,
    date,
    estimated: /est\./i.test(cells[0]),
    phase,
    sponsor,
    ticker,
    title,
    conditions: stripTags(cells[4] || ""),
    status: cells[5] ? stripTags(cells[5]) : "",
    enrollment: cells[6] ? stripTags(cells[6]) : "",
    drugSlugs: [],
  };
}

export function parseFdaRow(rowHtml) {
  if (/<th\b|colspan=/i.test(rowHtml)) return null;
  const cells = [...String(rowHtml).matchAll(/<td>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
  if (cells.length < 6) return null;
  const date = stripTags(cells[0]).replace(/\s*\([^)]*\)\s*/g, "").trim();
  if (!/^\d{4}-\d{2}/.test(date)) return null;
  if ((cells[3].match(/NCT\d+/) || [])[0]) return null;
  const ticker = (cells[3].match(/company\/([A-Z0-9.]+)\//) || [])[1] || "";
  let company = stripTags(cells[3]);
  if (ticker) company = company.replace(new RegExp(`\\s+${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim();
  const href = (cells[5].match(/href="([^"]+)"/) || [])[1] || "";
  return {
    date,
    kind: stripTags(cells[1]),
    status: stripTags(cells[2]),
    company,
    ticker,
    drugSlug: (cells[4].match(/drug\/([^"/]+)\//) || [])[1] || "",
    drugName: stripTags(cells[4]),
    url: decodeBasic(href),
    title: stripTags(cells[5]),
  };
}

export function extractSections(html) {
  const trials = [];
  const fda = [];
  const re = /<h2>([^<]*)<\/h2>([\s\S]*?)(?=<h2>|<\/main>|$)/gi;
  let match;
  let found = false;
  while ((match = re.exec(html))) {
    found = true;
    const heading = match[1].toLowerCase();
    const rows = match[2].match(/<tr[\s\S]*?<\/tr>/gi) || [];
    if (heading.includes("readout") || heading.includes("trial")) {
      for (const row of rows) {
        const trial = parseReadoutRow(row);
        if (trial) trials.push(trial);
      }
    } else if (heading.includes("fda")) {
      for (const row of rows) {
        const event = parseFdaRow(row);
        if (event) fda.push(event);
      }
    }
  }
  if (!found) {
    for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const trial = parseReadoutRow(row);
      if (trial) trials.push(trial);
    }
  }
  return { trials, fda };
}

function nav(depth) {
  const up = "../".repeat(depth);
  const items = [
    [up, "Readout calendar"],
    [`${up}fda/`, "FDA decisions"],
    [`${up}drug/`, "Drugs"],
    [`${up}condition/`, "Disease areas"],
    [`${up}company/`, "Companies"],
    [`${up}month/`, "Months"],
    [`${up}sponsor/`, "Sponsors"],
    [`${up}modality/`, "Modalities"],
    [`${up}alternative/`, "Alternatives"],
  ];
  return items.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join(" / ");
}

function shell({ title, description, path, body, generatedAt, depth, jsonld }) {
  const ld = jsonld ? `${jsonld}\n` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} - BioCatalystFeed</title>
<meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(SITE + path)}">
<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/style.css"><style>${CSS}</style>
${ld}</head>
<body><main style="max-width:1100px;margin:auto;padding:16px">
<p><a href="/">BioCatalystFeed</a> / ${nav(depth)}</p>
${body}
<p><small>Readout = ClinicalTrials.gov primary completion date (sponsor-reported; <small>est.</small> dates often slip; top-line
results usually follow weeks to months later). FDA events: PDUFA dates are extracted from company 8-K filings (SEC EDGAR) and are
company-disclosed and UNVERIFIED - read the filing; AdCom meetings come from Federal Register notices; approvals from Drugs@FDA
(openFDA); complete response letters from openFDA (published with a lag). Tickers are matched by name with a confidence score.
Generated ${esc(generatedAt)}. Same data: <code>bcf readouts search</code>, <code>bcf fda-decisions search</code>, MCP
<code>readout_calendar</code> / <code>fda_decisions</code>. Not investment advice. Not medical advice.</small></p>
</main></body></html>
`;
}

function disclaimer() {
  return `<p class="disclaimer">Not medical advice. This page lists records already in the BioCatalystFeed dataset. It does not compare efficacy or safety and does not recommend any drug, test, or sponsor.</p>`;
}

function eventJsonLd(trials, url) {
  const items = [];
  for (const trial of trials) {
    if (!trial.date || items.length >= 80) continue;
    items.push({
      "@type": "Event",
      name: `${trial.nct} primary completion${trial.estimated ? " (estimated)" : ""}: ${(trial.title || "").slice(0, 110)}`,
      startDate: trial.date,
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
      location: { "@type": "VirtualLocation", url: `https://clinicaltrials.gov/study/${trial.nct}` },
      organizer: { "@type": "Organization", name: trial.sponsor || "" },
      url: `https://clinicaltrials.gov/study/${trial.nct}`,
    });
  }
  if (!items.length) return "";
  const blob = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    url,
    itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, item })),
  }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${blob}</script>`;
}

function thingJsonLd(things, url) {
  if (!things.length) return "";
  const blob = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    url,
    itemListElement: things.slice(0, 80).map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: { "@type": "Thing", name: item.name, url: item.url },
    })),
  }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${blob}</script>`;
}

function readoutTable(trials, empty) {
  const shown = trials.slice(0, THRESHOLDS.maxTableRows);
  const rows = shown.map((trial) => {
    const est = trial.estimated ? " <small>est.</small>" : "";
    return `<tr><td>${esc(trial.date)}${est}</td><td>${esc(trial.phase)}</td><td>${esc(trial.sponsor)}</td><td><a href="https://clinicaltrials.gov/study/${esc(trial.nct)}">${esc(trial.nct)}</a> ${esc((trial.title || "").slice(0, 160))}</td><td>${esc((trial.conditions || "").slice(0, 100))}</td><td>${esc(trial.status || "")}</td><td>${esc(trial.enrollment || "")}</td></tr>`;
  });
  const more = trials.length > shown.length ? `<p><small>Showing ${shown.length} of ${trials.length}.</small></p>` : "";
  return `<table><thead><tr><th>Readout</th><th>Phase</th><th>Sponsor</th><th>Trial</th><th>Conditions</th><th>Status</th><th>Enrollment</th></tr></thead><tbody>${rows.join("") || `<tr><td colspan=7>${esc(empty)}</td></tr>`}</tbody></table>${more}`;
}

function fdaTable(events) {
  const shown = events.slice(0, THRESHOLDS.maxTableRows);
  const rows = shown.map((event) => {
    const drug = event.drugSlug && !isJunkDrugName(event.drugName || event.drugSlug)
      ? `<a href="../../drug/${esc(event.drugSlug)}/">${esc(event.drugName || event.drugSlug)}</a>`
      : esc(event.drugName || "");
    const source = event.url ? `<a href="${esc(event.url)}">${esc((event.title || event.url).slice(0, 170))}</a>` : esc(event.title || "");
    return `<tr><td>${esc(event.date)}</td><td><span class=tag>${esc(event.kind || "")}</span></td><td>${esc(event.status || "")}</td><td>${esc(event.company || "")}</td><td>${drug}</td><td>${source}</td></tr>`;
  });
  const more = events.length > shown.length ? `<p><small>Showing ${shown.length} of ${events.length}.</small></p>` : "";
  return `<table><thead><tr><th>Date</th><th>Event</th><th>Status</th><th>Company</th><th>Drug</th><th>Source</th></tr></thead><tbody>${rows.join("")}</tbody></table>${more}`;
}

function drugLinks(drugs, limit = THRESHOLDS.maxDrugsOnPage) {
  const shown = drugs.slice(0, limit);
  const more = drugs.length > shown.length ? ` <small>(${shown.length} of ${drugs.length})</small>` : "";
  return shown.map((drug) => `<a href="../../drug/${esc(drug.slug)}/">${esc(drug.name)}</a>`).join(", ") + more;
}

function areaLinks(areas, limit = THRESHOLDS.maxAreasOnPage) {
  return areas.slice(0, limit).map((area) => `<a href="../../condition/${esc(area.slug)}/">${esc(area.name)}</a>`).join(", ");
}

function isUpcoming(trial, today) {
  return Boolean(trial.date) && trial.date >= today;
}

export function renderSponsor(page, generatedAt, today) {
  const path = `/calendar/sponsor/${page.slug}/`;
  const upcoming = page.trials.filter((trial) => isUpcoming(trial, today));
  const earlier = page.trials.filter((trial) => !isUpcoming(trial, today));
  const company = page.company
    ? `<p>A company page with a similar name is <a href="../../company/${esc(page.company.ticker)}/">${esc(page.company.name)} (${esc(page.company.ticker)})</a>. Trial rows already listed on that page are not repeated here.</p>`
    : "";
  const body = `<h1>${esc(page.name)} trials, drugs and catalysts</h1><p>${esc(page.name)}: ${page.trials.length} industry Phase 2/3 trial readout(s) in this dataset whose sponsor was not matched to a ticker. Drugs and disease areas are those already linked on the calendar pages. One product can appear under more than one name.</p>${company}<p>Drugs: ${drugLinks(page.drugs) || "none linked from a drug page."}</p><p>Disease areas: ${areaLinks(page.areas) || "none matched."}</p>${disclaimer()}${page.fda.length ? `<h2>FDA decision events</h2>${fdaTable(page.fda)}` : ""}<h2>Upcoming trial readouts</h2>${readoutTable(upcoming, "No upcoming readouts in this dataset.")}<h2>Other trial readouts in this dataset</h2>${readoutTable(earlier, "No earlier readouts in this dataset.")}`;
  const description = `${page.name}: ${page.trials.length} trial readout(s) in this dataset, with linked drugs and disease areas. Not medical advice.`;
  return shell({
    title: `${page.name} clinical trials and catalysts`,
    description,
    path,
    body,
    generatedAt,
    depth: 2,
    jsonld: eventJsonLd(page.trials, SITE + path),
  });
}

export function renderModality(page, generatedAt) {
  const path = `/calendar/modality/${page.slug}/`;
  const rows = page.drugs.map((drug) => `<tr><td><a href="../../drug/${esc(drug.slug)}/">${esc(drug.name)}</a></td><td>${drug.count}</td><td>${esc(drug.sponsors.join(", "))}</td><td>${drug.areas.map((area) => `<a href="../../condition/${esc(area.slug)}/">${esc(area.name)}</a>`).join(", ")}</td></tr>`);
  const body = `<h1>${esc(page.label)}</h1><p>${page.drugs.length} drugs with a drug page whose names match this modality. ${esc(page.rule)} Trial titles are not used. Drugs that do not match stay unclassified and are left off this page. One product can appear under more than one name.</p>${disclaimer()}<table><thead><tr><th>Drug</th><th>Trials in dataset</th><th>Sponsors without a ticker</th><th>Disease areas</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  return shell({
    title: `${page.label} drugs and trials`,
    description: `${page.label}: ${page.drugs.length} drugs in this dataset classified from the drug name, with trial and disease-area links. Not medical advice.`,
    path,
    body,
    generatedAt,
    depth: 2,
    jsonld: thingJsonLd(page.drugs.map((drug) => ({ name: drug.name, url: `${SITE}/calendar/drug/${drug.slug}/` })), SITE + path),
  });
}

export function renderAlternative(page, generatedAt) {
  const path = `/calendar/alternative/${page.slug}/`;
  const sections = page.sections.map((section) => {
    const rows = section.others.map((other) => `<tr><td><a href="../../drug/${esc(other.slug)}/">${esc(other.name)}</a></td><td>${other.count}</td><td>${other.fdaApproval ? "<span class=tag>FDA approval event in this dataset</span>" : ""}</td></tr>`);
    return `<h2>${esc(section.areaName)}</h2><p>Other drug pages with at least one trial whose condition text matches this disease area and the same modality classification (${esc(page.modality.label)}).</p><table><thead><tr><th>Drug</th><th>Trials in this area</th><th>FDA decision record</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }).join("");
  const body = `<h1>Alternatives to ${esc(page.name)}</h1><p>Other drugs in this dataset in the same disease area and the same modality as <a href="../../drug/${esc(page.slug)}/">${esc(page.name)}</a> (${esc(page.modality.label)}). The grouping uses disease-area labels and name rules already on this site. It is a registry grouping only. One product can appear under more than one name (code, generic, brand).</p>${disclaimer()}${sections}`;
  return shell({
    title: `Alternatives to ${page.name}`,
    description: `Other drugs in this dataset in the same disease area and modality as ${page.name}. A registry grouping, not a comparison or a recommendation.`,
    path,
    body,
    generatedAt,
    depth: 2,
    jsonld: thingJsonLd(
      page.sections.flatMap((section) => section.others).filter((item, index, all) => all.findIndex((other) => other.slug === item.slug) === index)
        .map((item) => ({ name: item.name, url: `${SITE}/calendar/drug/${item.slug}/` })),
      SITE + path,
    ),
  });
}

export function renderSponsorIndex(pages, generatedAt) {
  const path = "/calendar/sponsor/";
  const items = pages.map((page) => `<li><a href="${esc(page.slug)}/">${esc(page.name)}</a> - ${page.trials.length} trial(s)${page.company ? `, see also <a href="../company/${esc(page.company.ticker)}/">${esc(page.company.ticker)}</a>` : ""}</li>`);
  const body = `<h1>Trial sponsors</h1><p>${pages.length} sponsors with at least ${THRESHOLDS.minSponsorTrials} industry Phase 2/3 trial readouts in this dataset and a linked drug or disease area. Sponsors that already have those trials on a company page are not repeated. Junk labels such as comparator, background chemotherapy, and arm or group names are omitted. <a href="../company/">Company pages</a> list sponsors that matched a ticker.</p>${disclaimer()}<ul class=cols>${items.join("")}</ul>`;
  return shell({
    title: "Trial sponsors: clinical trials and catalysts",
    description: `${pages.length} trial sponsors in this dataset that do not already have those trials on a company page, with drugs and disease areas.`,
    path,
    body,
    generatedAt,
    depth: 1,
    jsonld: "",
  });
}

export function renderModalityIndex(pages, generatedAt) {
  const path = "/calendar/modality/";
  const items = pages.map((page) => `<li><a href="${esc(page.slug)}/">${esc(page.label)}</a> - ${page.drugs.length} drug(s)</li>`);
  const body = `<h1>Therapeutic modalities</h1><p>${pages.length} modality pages. A drug is listed only when its name matches a conservative rule. Unclassified drugs, and modalities with fewer than ${THRESHOLDS.minModalityDrugs} drugs, do not get a page. This is not a default of small molecule.</p>${disclaimer()}<ul>${items.join("")}</ul>`;
  return shell({
    title: "Drugs by therapeutic modality",
    description: `Modality pages for drugs in this dataset, classified from the drug name only. Unclassified drugs are omitted.`,
    path,
    body,
    generatedAt,
    depth: 1,
    jsonld: "",
  });
}

export function renderAlternativeIndex(pages, generatedAt) {
  const path = "/calendar/alternative/";
  const items = pages.map((page) => `<li><a href="${esc(page.slug)}/">Alternatives to ${esc(page.name)}</a> <small>${esc(page.modality.label)}</small></li>`);
  const body = `<h1>Alternatives by drug</h1><p>${pages.length} drugs with at least ${THRESHOLDS.minAlternativeOthers} other drug pages in the same disease area and modality. Broad disease areas are not used for this grouping. Each page is a registry list, not a comparison.</p>${disclaimer()}<ul class=cols>${items.join("")}</ul>`;
  return shell({
    title: "Alternatives to drugs in this dataset",
    description: `Pages listing other drugs in this dataset in the same disease area and modality. Not a comparison or a recommendation.`,
    path,
    body,
    generatedAt,
    depth: 1,
    jsonld: "",
  });
}

export function renderEntityPages(plan, generatedAt, today) {
  const files = new Map();
  files.set("sponsor/index.html", renderSponsorIndex(plan.sponsors, generatedAt));
  for (const page of plan.sponsors) files.set(`sponsor/${page.slug}/index.html`, renderSponsor(page, generatedAt, today));
  files.set("modality/index.html", renderModalityIndex(plan.modalities, generatedAt));
  for (const page of plan.modalities) files.set(`modality/${page.slug}/index.html`, renderModality(page, generatedAt));
  files.set("alternative/index.html", renderAlternativeIndex(plan.alternatives, generatedAt));
  for (const page of plan.alternatives) files.set(`alternative/${page.slug}/index.html`, renderAlternative(page, generatedAt));
  return files;
}

export function sitemapLocs(plan) {
  const urls = ["/calendar/sponsor/", "/calendar/modality/", "/calendar/alternative/"];
  for (const page of plan.sponsors) urls.push(`/calendar/sponsor/${page.slug}/`);
  for (const page of plan.modalities) urls.push(`/calendar/modality/${page.slug}/`);
  for (const page of plan.alternatives) urls.push(`/calendar/alternative/${page.slug}/`);
  return urls;
}

export function addSitemapUrls(xml, urls, lastmod) {
  const prefixes = ["/calendar/sponsor/", "/calendar/modality/", "/calendar/alternative/"];
  const kept = [...String(xml).matchAll(/<url>[\s\S]*?<\/url>/g)]
    .map((match) => match[0])
    .filter((block) => {
      const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1] || "";
      return !prefixes.some((prefix) => loc.startsWith(`${SITE}${prefix}`));
    });
  const fresh = urls.map((url) => `<url><loc>${SITE}${url}</loc><lastmod>${lastmod}</lastmod></url>`);
  const body = kept.join("") + fresh.join("");
  if (!String(xml).includes("</urlset>")) return xml;
  return xml.replace(/<urlset[^>]*>[\s\S]*<\/urlset>/, (tag) => {
    const open = tag.match(/<urlset[^>]*>/)[0];
    return `${open}${body}</urlset>`;
  });
}

export function insertEntityLinks(html, paragraph) {
  const has = html.includes('class="entity-links"');
  if (!paragraph) {
    return has ? html.replace(/<p class="entity-links">[\s\S]*?<\/p>/, "") : html;
  }
  if (has) return html.replace(/<p class="entity-links">[\s\S]*?<\/p>/, paragraph);
  if (!/<\/h1><p>[\s\S]*?<\/p>/.test(html)) return html;
  return html.replace(/<\/h1><p>[\s\S]*?<\/p>/, (match) => match + paragraph);
}

export function companyLinkParagraph(info) {
  if (!info) return "";
  const bits = [];
  if (info.areas?.length) {
    bits.push(`Disease areas: ${info.areas.map((area) => `<a href="../../condition/${esc(area.slug)}/">${esc(area.name)}</a>`).join(", ")}.`);
  }
  if (info.modalities?.length) {
    bits.push(`Modalities: ${info.modalities.map((item) => `<a href="../../modality/${esc(item.slug)}/">${esc(item.label)}</a>`).join(", ")}.`);
  }
  if (info.sponsors?.length) {
    bits.push(`Sponsor name on trial records: ${info.sponsors.map((page) => `<a href="../../sponsor/${esc(page.slug)}/">${esc(page.name)}</a>`).join(", ")}.`);
  }
  return bits.length ? `<p class="entity-links">${bits.join(" ")}</p>` : "";
}

export function drugLinkParagraph(info) {
  if (!info) return "";
  const bits = [];
  if (info.modality) bits.push(`Modality, from the drug name only: <a href="../../modality/${esc(info.modality.slug)}/">${esc(info.modality.label)}</a>.`);
  if (info.alternative) bits.push(`<a href="../../alternative/${esc(info.slug)}/">Alternatives to ${esc(info.name)}</a> lists other drugs in this dataset in the same disease area and modality.`);
  return bits.length ? `<p class="entity-links">${bits.join(" ")}</p>` : "";
}

export function conditionLinkParagraph(info) {
  if (!info) return "";
  const bits = [];
  if (info.sponsors?.length) {
    bits.push(`Sponsor pages: ${info.sponsors.map((page) => `<a href="../../sponsor/${esc(page.slug)}/">${esc(page.name)}</a>`).join(", ")}.`);
  }
  if (info.modalities?.length) {
    bits.push(`Modalities: ${info.modalities.map((item) => `<a href="../../modality/${esc(item.slug)}/">${esc(item.label)}</a>`).join(", ")}.`);
  }
  return bits.length ? `<p class="entity-links">${bits.join(" ")}</p>` : "";
}

export function indexNav(html) {
  const next = ' / <a href="../sponsor/">Sponsors</a> / <a href="../modality/">Modalities</a> / <a href="../alternative/">Alternatives</a>';
  if (html.includes('href="../sponsor/"')) return html;
  const needle = '<a href="../month/">Months</a>';
  if (!html.includes(needle)) return html;
  return html.replace(needle, needle + next);
}

export function calendarHubLinks(html) {
  const needle = '<a href="condition/">by disease area</a>';
  if (!html.includes(needle) || html.includes('href="sponsor/"')) return html;
  return html.replace(
    needle,
    `${needle} - <a href="sponsor/">by sponsor</a> - <a href="modality/">by modality</a> - <a href="alternative/">alternatives</a>`,
  );
}
