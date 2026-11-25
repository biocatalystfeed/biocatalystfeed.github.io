import assert from "node:assert/strict";
import test from "node:test";
import { compileAreas } from "../areas.mjs";
import {
  addSitemapUrls,
  calendarHubLinks,
  classifyModality,
  companyLinkParagraph,
  drugLinkParagraph,
  indexNav,
  insertEntityLinks,
  isJunkDrugName,
  isJunkSponsor,
  matchCompany,
  planEntities,
  renderAlternative,
  renderSponsor,
  THRESHOLDS,
} from "../entity-pages.mjs";

test("disease-area matchers compile and keep hypertension apart from PAH", () => {
  const areas = compileAreas();
  assert.equal(areas.length, 91);
  const slugs = (text) => areas.filter((area) => area._re.some((re) => re.test(text))).map((area) => area.slug);
  assert.deepEqual(slugs("pulmonary arterial hypertension"), ["pulmonary-arterial-hypertension"]);
  assert.ok(slugs("essential hypertension").includes("hypertension"));
  assert.ok(!slugs("essential hypertension").includes("pulmonary-arterial-hypertension"));
});

test("junk entities never become drugs or sponsors", () => {
  for (const name of [
    "Comparator",
    "Background chemotherapy",
    "Best available therapy",
    "Test drug 1-1",
    "Placebo",
    "CM336 group 2a",
    "arm 2",
    "cohort 3",
  ]) {
    assert.equal(isJunkDrugName(name) || isJunkSponsor(name), true, name);
  }
  assert.equal(isJunkSponsor("Hoffmann-La Roche"), false);
  assert.equal(isJunkSponsor("Chia Tai Tianqing Pharmaceutical Group Co., Ltd."), false);
  assert.equal(isJunkDrugName("Pembrolizumab"), false);
});

test("modality comes from the drug name only", () => {
  assert.equal(classifyModality("Pembrolizumab"), "mab");
  assert.equal(classifyModality("Trastuzumab deruxtecan"), "adc");
  assert.equal(classifyModality("Sacituzumab Govitecan-hziy"), "adc");
  assert.equal(classifyModality("Semaglutide"), "peptide");
  assert.equal(classifyModality("Inclisiran"), "rna");
  assert.equal(classifyModality("COVID-19 mRNA Vaccine"), "vaccine");
  assert.equal(classifyModality("68Ga-PSMA-11"), "radio");
  assert.equal(classifyModality("CHM-2101 CAR-T cells"), "cell");
  assert.equal(classifyModality("AAV9-hSyn1-miGRIK2"), "gene");
  assert.equal(classifyModality("Afimkibart"), "mab");
  assert.equal(classifyModality("Volrustomig"), "bispecific");
  assert.equal(classifyModality("Osimertinib"), null);
  assert.equal(classifyModality("small molecule XYZ"), "small");
  assert.equal(classifyModality("Comparator"), null);
  assert.equal(classifyModality("Background chemotherapy"), null);
});

test("a similar company name links instead of copying trials already on that page", () => {
  const companies = [
    { ticker: "MRNA", name: "Moderna, Inc.", ncts: [] },
    { ticker: "LLY", name: "Eli Lilly and Company", ncts: ["NCT1", "NCT2"] },
  ];
  assert.equal(matchCompany("ModernaTX, Inc.", companies).ticker, "MRNA");
  assert.equal(matchCompany("Eli Lilly and Company", companies).ticker, "LLY");
  assert.equal(matchCompany("Genzyme, a Sanofi Company", [{ ticker: "SNY", name: "Sanofi", ncts: [] }]).ticker, "SNY");
  assert.equal(matchCompany("Instituto Grifols, S.A.", [{ ticker: "GRFS", name: "Grifols Therapeutics LLC", ncts: [] }]).ticker, "GRFS");
  assert.equal(matchCompany("Jiangsu HengRui Medicine Co., Ltd.", [{ ticker: "JHPCY", name: "Jiangsu Hengrui Pharmaceuticals Co., Ltd.", ncts: [] }]).ticker, "JHPCY");
  assert.equal(matchCompany("Shanghai Hengrui Pharmaceutical Co., Ltd.", [{ ticker: "JHPCY", name: "Jiangsu Hengrui Pharmaceuticals Co., Ltd.", ncts: [] }]), null);
  assert.equal(matchCompany("Shanghai Pharmaceuticals Holding Co., Ltd", [{ ticker: "SBFM", name: "Sunshine Guojian Pharmaceutical (Shanghai) Co., Ltd.", ncts: [] }]), null);
  assert.equal(matchCompany("AB Science", [{ ticker: "SAEN", name: "Genenta Science", ncts: [] }]), null);
  assert.equal(matchCompany("BrightGene Bio-Medical Technology Co., Ltd.", [{ ticker: "CELZ", name: "Creative Medical Technology Holdings Inc", ncts: [] }]), null);
  assert.equal(matchCompany("Biomea Fusion Inc.", [{ ticker: "HTOO", name: "Fusion Pharmaceuticals Inc.", ncts: [] }]), null);
  assert.equal(matchCompany("The United Bio-Technology (Hengqin) Co., Ltd.", [{ ticker: "UTHR", name: "United Therapeutics", ncts: [] }]), null);
  assert.equal(matchCompany("Taiho Oncology, Inc.", [{ ticker: "CGON", name: "CG Oncology, Inc.", ncts: [] }]), null);
  assert.equal(matchCompany("Chongqing Precision Biotech Co., Ltd", [{ ticker: "DTIL", name: "Precision Biologics, Inc", ncts: [] }]), null);

  const base = { phase: "P3", conditions: "Atopic Dermatitis", status: "recruiting", enrollment: "10", estimated: true, drugSlugs: ["dupilumab"] };
  const plan = planEntities({
    today: "2026-11-25",
    companies,
    areaNames: new Map([["atopic-dermatitis", "Atopic dermatitis"]]),
    drugs: [{ slug: "dupilumab", name: "Dupilumab", ncts: ["NCT9", "NCT8"] }],
    trials: [
      { ...base, nct: "NCT9", date: "2026-12", sponsor: "ModernaTX, Inc.", ticker: "", title: "A", areas: ["atopic-dermatitis"] },
      { ...base, nct: "NCT8", date: "2026-10", sponsor: "ModernaTX, Inc.", ticker: "", title: "B", areas: ["atopic-dermatitis"] },
      { ...base, nct: "NCT1", date: "2026-12", sponsor: "Eli Lilly and Company", ticker: "", title: "C", areas: ["atopic-dermatitis"] },
      { ...base, nct: "NCT2", date: "2026-08", sponsor: "Eli Lilly and Company", ticker: "", title: "D", areas: ["atopic-dermatitis"] },
    ],
    fda: [],
  });
  assert.equal(plan.sponsors.length, 1);
  assert.equal(plan.sponsors[0].company.ticker, "MRNA");
  assert.deepEqual(plan.sponsors[0].trials.map((trial) => trial.nct), ["NCT9", "NCT8"]);
});

test("sponsor, modality, and alternative thresholds", () => {
  const trial = (nct, sponsor, drug, area, date = "2026-12") => ({
    nct, date, estimated: true, phase: "P3", sponsor, ticker: "", title: "Study", conditions: area,
    status: "recruiting", enrollment: "20", drugSlugs: [drug], areas: [area],
  });
  const drugs = ["a", "b", "c", "d"].map((slug) => ({ slug, name: `${slug}mab`, ncts: [`NCT${slug}`] }));
  const trials = [
    trial("NCTa", "One Trial Labs", "a", "nsclc"),
    trial("NCTb", "Roche Holdings", "a", "nsclc"),
    trial("NCTc", "Roche Holdings", "b", "nsclc"),
    trial("NCTd", "Roche Holdings", "c", "solid-tumors"),
  ];
  drugs[0].ncts = ["NCTb"];
  drugs[1].ncts = ["NCTc"];
  drugs[2].ncts = ["NCTd"];
  drugs[3].ncts = ["NCTa"];
  const plan = planEntities({
    today: "2026-11-25",
    companies: [],
    areaNames: new Map([["nsclc", "Non-small cell lung cancer"], ["solid-tumors", "Advanced solid tumors"]]),
    drugs,
    trials,
    fda: [{ date: "2026-06-01", kind: "FDA approval", status: "approved", company: "Roche Holdings", ticker: "", drugSlug: "a", drugName: "amab", url: "https://example.test/a", title: "Approved" }],
  });
  assert.equal(plan.sponsors.some((page) => page.name === "One Trial Labs"), false);
  const roche = plan.sponsors.find((page) => page.name === "Roche Holdings");
  assert.ok(roche);
  assert.equal(roche.trials.length, 3);
  assert.equal(plan.modalities.some((page) => page.id === "mab"), false);
  assert.equal(plan.alternatives.length, 0);
  assert.equal(THRESHOLDS.minModalityDrugs, 4);
  assert.equal(THRESHOLDS.minAlternativeOthers, 2);
  assert.equal(THRESHOLDS.minSponsorTrials, 2);
});

test("alternatives require two other drugs in the same area and modality", () => {
  const names = ["Pembrolizumab", "Nivolumab", "Cemiplimab", "Semaglutide"];
  const drugs = names.map((name, index) => ({ slug: name.toLowerCase(), name, ncts: [`NCT${index}`] }));
  const trials = names.map((name, index) => ({
    nct: `NCT${index}`,
    date: "2026-12",
    estimated: false,
    phase: "P3",
    sponsor: "Example",
    ticker: "EX",
    title: "Study",
    conditions: index === 3 ? "Obesity" : "non-small cell lung cancer",
    status: "recruiting",
    enrollment: "10",
    drugSlugs: [name.toLowerCase()],
    areas: index === 3 ? ["obesity"] : ["nsclc", "lung-cancer", "solid-tumors"],
  }));
  const plan = planEntities({
    today: "2026-11-25",
    companies: [{ ticker: "EX", name: "Example", ncts: trials.map((trial) => trial.nct) }],
    areaNames: new Map([
      ["nsclc", "Non-small cell lung cancer"],
      ["lung-cancer", "Lung cancer (all)"],
      ["solid-tumors", "Advanced solid tumors"],
      ["obesity", "Obesity"],
    ]),
    drugs,
    trials,
    fda: [],
  });
  const slugs = plan.alternatives.map((page) => page.slug).sort();
  assert.deepEqual(slugs, ["cemiplimab", "nivolumab", "pembrolizumab"]);
  const page = plan.alternatives.find((item) => item.slug === "pembrolizumab");
  assert.equal(page.sections.length, 1);
  assert.equal(page.sections[0].area, "nsclc");
  assert.equal(page.sections[0].others.length, 2);
  const html = renderAlternative(page, "2026-11-25T17:52:57Z");
  assert.match(html, /<link rel="canonical" href="https:\/\/biocat\.ai\/calendar\/alternative\/pembrolizumab\/">/);
  assert.match(html, /<title>Alternatives to Pembrolizumab - BioCatalystFeed<\/title>/);
  assert.doesNotMatch(html, /og:image/);
  assert.match(html, /class="disclaimer"/);
  const body = html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<p class="disclaimer">[\s\S]*?<\/p>/, "")
    .replace(/<p><small>[\s\S]*<\/small><\/p>/, "");
  assert.doesNotMatch(body, /\befficac/i);
  assert.doesNotMatch(body, /\bsafety\b/i);
  assert.doesNotMatch(body, /\brecommend/i);
  assert.doesNotMatch(body, /\bsuperior\b|\binferior\b|\bbetter\b|\bworse\b/i);
  assert.match(html, /Not medical advice/);
  assert.match(html, /Not investment advice/);
});

test("sponsor page wording stays factual and links a related company page", () => {
  const page = {
    slug: "modernatx-inc",
    name: "ModernaTX, Inc.",
    company: { ticker: "MRNA", name: "Moderna, Inc." },
    trials: [
      { nct: "NCT1", date: "2026-12", estimated: true, phase: "P3", sponsor: "ModernaTX, Inc.", title: "Study one", conditions: "Influenza", status: "recruiting", enrollment: "100", drugSlugs: [] },
      { nct: "NCT2", date: "2026-01", estimated: false, phase: "P2", sponsor: "ModernaTX, Inc.", title: "Study two", conditions: "Influenza", status: "completed", enrollment: "40", drugSlugs: [] },
    ],
    drugs: [{ slug: "mrna-vax", name: "mRNA vax", count: 2 }],
    areas: [{ slug: "rsv-influenza-covid", name: "Respiratory viruses (RSV, influenza, COVID-19)", count: 2 }],
    fda: [],
  };
  const html = renderSponsor(page, "2026-11-25T17:52:57Z", "2026-11-25");
  assert.match(html, /href="\.\.\/\.\.\/company\/MRNA\/"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /Not medical advice/);
  assert.doesNotMatch(html, /og:image/);
  const body = html.replace(/<p class="disclaimer">[\s\S]*?<\/p>/, "");
  assert.doesNotMatch(body, /\befficac|\bsafety\b|\brecommend/i);
});

test("link inserts and sitemap entries are idempotent", () => {
  const html = "<h1>Example</h1><p>Intro.</p><p>Rest.</p>";
  const once = insertEntityLinks(html, '<p class="entity-links">See <a href="../../sponsor/a/">A</a>.</p>');
  const twice = insertEntityLinks(once, '<p class="entity-links">See <a href="../../sponsor/a/">A</a>.</p>');
  assert.equal(once, twice);
  assert.equal(once.match(/entity-links/g).length, 1);
  assert.equal(insertEntityLinks(once, ""), html);
  const nav = indexNav('<p><a href="../month/">Months</a></p>');
  assert.match(nav, /href="\.\.\/sponsor\/"/);
  assert.equal(indexNav(nav), nav);
  const hub = calendarHubLinks('<a href="condition/">by disease area</a></small>');
  assert.match(hub, /href="sponsor\/"/);
  assert.equal(calendarHubLinks(hub), hub);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://biocat.ai/</loc></url></urlset>\n';
  const added = addSitemapUrls(xml, ["/calendar/sponsor/"], "2026-11-25");
  assert.match(added, /<loc>https:\/\/biocat\.ai\/calendar\/sponsor\/<\/loc><lastmod>2026-11-25<\/lastmod>/);
  assert.equal(addSitemapUrls(added, ["/calendar/sponsor/"], "2026-11-25"), added);
  assert.match(companyLinkParagraph({ areas: [{ slug: "asthma", name: "Asthma" }], modalities: [], sponsors: [] }), /condition\/asthma/);
  assert.match(drugLinkParagraph({ slug: "dupilumab", name: "Dupilumab", modality: { slug: "monoclonal-antibody", label: "Monoclonal antibody" }, alternative: true }), /Alternatives to Dupilumab/);
});
