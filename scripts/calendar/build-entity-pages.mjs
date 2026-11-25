// Build sponsor, modality, and alternative pages from the calendar HTML already in this repo.
// Re-run after a calendar data refresh. The private full-site renderer rewrites company, drug,
// and disease-area HTML and the calendar sitemap; run this script after that render so the new
// pages, in-body links, and sitemap entries come back. It does not fetch anything and does not
// edit /headlines/.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileAreas } from "./areas.mjs";
import {
  addSitemapUrls,
  assignTrialAreas,
  calendarHubLinks,
  companyLinkParagraph,
  conditionLinkParagraph,
  drugLinkParagraph,
  extractSections,
  indexNav,
  insertEntityLinks,
  isJunkDrugName,
  planEntities,
  renderEntityPages,
  sitemapLocs,
} from "./entity-pages.mjs";

const repo = path.resolve(import.meta.dirname, "../..");
const calendar = path.join(repo, "calendar");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function mergeTrial(left, right) {
  if (right.ticker && !left.ticker) return mergeTrial(right, left);
  const longer = (a, b) => ((a || "").length >= (b || "").length ? a : b) || a || b || "";
  return {
    nct: left.nct,
    date: longer(left.date, right.date),
    estimated: (left.date || "").length >= (right.date || "").length ? left.estimated : right.estimated,
    phase: longer(left.phase, right.phase),
    sponsor: left.ticker ? left.sponsor : longer(left.sponsor, right.sponsor),
    ticker: left.ticker || right.ticker || "",
    title: longer(left.title, right.title),
    conditions: longer(left.conditions, right.conditions),
    status: left.status || right.status || "",
    enrollment: left.enrollment || right.enrollment || "",
    drugSlugs: left.drugSlugs || [],
  };
}

function addTrial(map, trial) {
  const prev = map.get(trial.nct);
  map.set(trial.nct, prev ? mergeTrial(prev, trial) : trial);
}

function walkHtml(dir, onFile) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "index.html");
    if (fs.existsSync(file)) onFile(entry.name, file);
  }
}

function loadCompanies() {
  const index = read(path.join(calendar, "company", "index.html"));
  const companies = [];
  for (const match of index.matchAll(/<a href="([A-Z0-9.]+)\/">/g)) {
    const ticker = match[1];
    const file = path.join(calendar, "company", ticker, "index.html");
    if (!fs.existsSync(file)) continue;
    const html = read(file);
    const title = html.match(/<title>([^<]*)<\/title>/);
    const named = title ? title[1].match(/^[^(]+\((.*)\) catalysts:/) : null;
    const name = named ? named[1].trim() : ticker;
    companies.push({ ticker, name, ncts: new Set(html.match(/NCT\d+/g) || []) });
  }
  return companies;
}

function loadDrugs() {
  const drugs = [];
  walkHtml(path.join(calendar, "drug"), (slug, file) => {
    const html = read(file);
    const heading = html.match(/<h1>([\s\S]*?)<\/h1>/);
    if (!heading) return;
    const name = heading[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().replace(/:\s*trial readouts.*$/i, "").trim();
    drugs.push({
      slug,
      name,
      junk: isJunkDrugName(name),
      ncts: [...new Set(html.match(/NCT\d+/g) || [])],
    });
  });
  return drugs;
}

function loadTrials(drugNcts) {
  const map = new Map();
  const fda = [];
  const sources = [
    ...fs.readdirSync(path.join(calendar, "month")).filter((name) => /^\d{4}-\d{2}$/.test(name)).map((name) => path.join(calendar, "month", name, "index.html")),
    path.join(calendar, "index.html"),
  ];
  walkHtml(path.join(calendar, "company"), (_ticker, file) => sources.push(file));
  walkHtml(path.join(calendar, "drug"), (_slug, file) => sources.push(file));
  for (const file of sources) {
    if (!fs.existsSync(file)) continue;
    const { trials, fda: events } = extractSections(read(file));
    for (const trial of trials) addTrial(map, trial);
    fda.push(...events);
  }
  const trials = [...map.values()];
  assignTrialAreas(trials, compileAreas());
  for (const [slug, ncts] of drugNcts) {
    for (const nct of ncts) {
      const trial = map.get(nct);
      if (!trial) continue;
      if (!trial.drugSlugs.includes(slug)) trial.drugSlugs.push(slug);
    }
  }
  const seenFda = new Set();
  const uniqueFda = [];
  for (const event of fda) {
    const key = `${event.date}|${event.kind}|${event.company}|${event.drugSlug}|${event.url}`;
    if (seenFda.has(key)) continue;
    seenFda.add(key);
    uniqueFda.push(event);
  }
  return { trials, fda: uniqueFda };
}

function patchPages(plan) {
  let patched = 0;
  walkHtml(path.join(calendar, "company"), (ticker, file) => {
    const html = read(file);
    const next = insertEntityLinks(html, companyLinkParagraph(plan.companyLinks.get(ticker)));
    if (next !== html) {
      write(file, next);
      patched += 1;
    }
  });
  walkHtml(path.join(calendar, "drug"), (slug, file) => {
    const html = read(file);
    const info = plan.drugLinks.get(slug);
    const next = insertEntityLinks(html, info ? drugLinkParagraph({ ...info, slug }) : "");
    if (next !== html) {
      write(file, next);
      patched += 1;
    }
  });
  walkHtml(path.join(calendar, "condition"), (slug, file) => {
    const html = read(file);
    const next = insertEntityLinks(html, conditionLinkParagraph(plan.conditionLinks.get(slug)));
    if (next !== html) {
      write(file, next);
      patched += 1;
    }
  });
  return patched;
}

function patchIndexes() {
  const depth1 = ["company", "drug", "condition", "month", "fda"];
  for (const name of depth1) {
    const file = path.join(calendar, name, "index.html");
    if (!fs.existsSync(file)) continue;
    write(file, indexNav(read(file)));
  }
  const sentences = {
    company: 'Sponsors that do not already have these trials on a company page: <a href="../sponsor/">sponsor pages</a>.',
    drug: '<a href="../modality/">Modality pages</a> and <a href="../alternative/">alternatives to a drug</a> are built from these drug names and disease areas.',
    condition: '<a href="../sponsor/">Sponsor pages</a> and <a href="../modality/">modality pages</a> link to a disease area when the dataset has matching trials.',
  };
  for (const [name, sentence] of Object.entries(sentences)) {
    const file = path.join(calendar, name, "index.html");
    write(file, insertEntityLinks(read(file), `<p class="entity-links">${sentence}</p>`));
  }
  const hub = path.join(calendar, "index.html");
  write(hub, calendarHubLinks(read(hub)));
}

function resetOutput() {
  for (const name of ["sponsor", "modality", "alternative"]) {
    fs.rmSync(path.join(calendar, name), { recursive: true, force: true });
  }
}

export function buildEntitySite() {
  const calendarJson = JSON.parse(read(path.join(calendar, "calendar.json")));
  const generatedAt = calendarJson.generated_at || "";
  const today = (calendarJson.window && calendarJson.window[0]) || generatedAt.slice(0, 10);
  const companies = loadCompanies();
  const drugs = loadDrugs();
  const drugNcts = new Map(drugs.map((drug) => [drug.slug, drug.ncts]));
  const { trials, fda } = loadTrials(drugNcts);
  const areaNames = new Map(compileAreas().map((area) => [area.slug, area.name]));
  const plan = planEntities({ today, generatedAt, companies, drugs, trials, fda, areaNames });
  resetOutput();
  for (const [rel, html] of renderEntityPages(plan, generatedAt, today)) {
    write(path.join(calendar, rel), html);
  }
  const patched = patchPages(plan);
  patchIndexes();
  const urls = sitemapLocs(plan);
  const lastmod = generatedAt.slice(0, 10);
  for (const file of [path.join(calendar, "sitemap.xml"), path.join(repo, "sitemap.xml")]) {
    write(file, addSitemapUrls(read(file), urls, lastmod));
  }
  return {
    generatedAt,
    today,
    sponsors: plan.sponsors.length,
    modalities: plan.modalities.map((item) => ({ slug: item.slug, drugs: item.drugs.length })),
    alternatives: plan.alternatives.length,
    patched,
    urls: urls.length,
    trials: trials.length,
    drugs: drugs.length,
    companyLinked: plan.sponsors.filter((page) => page.company).map((page) => `${page.name} -> ${page.company.ticker} (${page.trials.length})`),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) console.log(JSON.stringify(buildEntitySite(), null, 2));
