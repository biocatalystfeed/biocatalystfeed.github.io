import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadFeedback } from "../feedback.mjs";
import { parseRobots, robotsDecision } from "../http.mjs";
import { buildHeadlines, readLeadState, rewriteDatelineFallbacks } from "../populate.mjs";
import { BREAKING_FULL_HOURS, BREAKING_MAX_BOOST, BREAKING_ZERO_HOURS, LEAD_EVENT_WINDOW_HOURS, LEAD_MAX_ITEM_HOURS, LEAD_WORTHY_FLOOR, RULES, assignLead, breakingBoost, capXAccounts, leadScore, sameXEvent, scoreItem, selectHeadlines, tierFor } from "../ranking.mjs";
import { echoesHeadline, fdaApprovalCopy, hashId, HEADLINE_WORD_MAX, humanDate, indicationPhrase, metaDescription, natureNewsTrial, OUTCOME_CLAIM, paperCopy, paperRecords, pressCopy, pressLead, pressProduct, shortenHeadline, shortenPaperHeadline, trialCopy, wordCount } from "../copy.mjs";
import { commonsImage, imageResponseOk, licenceOk, pageImage, placeImages, uploadThumb } from "../images.mjs";
import { explainMatch, imageEntities, imageType, relevanceScore } from "../image-score.mjs";
import { nasaImage } from "../image-sources/nasa.mjs";
import { openverseImage } from "../image-sources/openverse.mjs";
import { IMAGE_SOURCES } from "../image-sources/terms.mjs";
import { canonUrl, dedupeByCanonUrl, hostAllowed, xAccountHandle, xPickItems } from "../x-picks.mjs";
import { xStatusUrl, tweetAuthor, tweetFallbackText, TWEET_RENDER_MS, formatDay, formatLocalDay, formatStamp, formatUpdatedTime, keepLastToken } from "../../../headlines/render.js";
import { SEARCH_ROUTES, searchStatusNote, searchUrls } from "../../../headlines/search.js";
import { accountsFromAllowlist, applyTrackedAccountFilter, bindTrackedDisclosure, markTrackedOpen, matchTrackedAccounts, rememberTrackedToggle, setTrackedSummary, trackedSearchRows, trackedSummaryText } from "../../../headlines/tracked-accounts.js";
import { REGULATOR_SOURCES } from "../ranking.mjs";
import { SOURCES, adcomItems, crlItems, drugsfdaItems, emaItems, europePmcItems, orangeBookLoe, purpleBookItems } from "../sources.mjs";
import { assertFactual, factualViolation } from "../text.mjs";

const root = path.resolve(import.meta.dirname, "../../..");

test("homepage links to headlines from the nav", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.match(html, /<a href="\/headlines\/">Headlines<\/a>/);
  assert.match(css, /a\[href="\/headlines\/"\]\{display:inline-flex/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /a\[href="\/headlines\/"\]:focus-visible/);
  assert.match(css, /:not\(\[href="\/headlines\/"\]\)/);
});

test("swissmedic and pmda stay disabled, with no fetcher", () => {
  for (const id of ["swissmedic", "pmda"]) {
    const source = SOURCES.find((row) => row.id === id);
    assert.equal(source.enabled, false);
    assert.equal(source.fetch, undefined);
    assert.match(source.reason, /2026-11-17/);
    assert.match(source.reason, /not been granted/);
  }
});

test("clinicaltrials api stays disabled because robots.txt disallows it", () => {
  const source = SOURCES.find((row) => row.id === "clinicaltrials-api");
  assert.equal(source.enabled, false);
  assert.match(source.reason, /Disallow: \/api\//);
  const robots = parseRobots("User-agent: *\nDisallow: /api/\nAllow: /api/int/\nAllow: /api/seo/\nCrawl-delay: 1\n");
  assert.equal(robotsDecision(robots, "BioCatalystFeed-Headlines/0.1", "/api/v2/studies").allowed, false);
  assert.equal(robotsDecision(robots, "BioCatalystFeed-Headlines/0.1", "/api/int/studies").allowed, true);
  assert.equal(robotsDecision(robots, "BioCatalystFeed-Headlines/0.1", "/study/NCT0").allowed, true);
});

test("tiers and a Type 1 approval outrank a generic", () => {
  assert.equal(tierFor(88), 5);
  assert.equal(tierFor(87), 4);
  assert.equal(tierFor(75), 4);
  assert.equal(tierFor(74), 3);
  assert.equal(tierFor(60), 3);
  assert.equal(tierFor(59), 2);
  assert.equal(tierFor(40), 2);
  assert.equal(tierFor(39), 1);
  const today = "2026-11-17";
  const nme = scoreItem({ id: "n", rule: "fda-nme", adjustments: ["priority-review"], published_at: "2026-09-23" }, today, new Map());
  const anda = scoreItem({ id: "a", rule: "fda-anda", adjustments: [], published_at: "2026-11-10" }, today, new Map());
  assert.ok(nme.significance > anda.significance);
  assert.equal(nme.tier, 5);
  assert.equal(anda.tier, 1);
  assert.match(nme.significance_rationale, /Type 1/);
});

test("dropped feedback removes an item and bigger raises the score", () => {
  const today = "2026-11-17";
  const base = scoreItem({ id: "x", rule: "fda-efficacy", adjustments: [], published_at: today }, today, new Map());
  const bigger = scoreItem({ id: "x", rule: "fda-efficacy", adjustments: [], published_at: today }, today, new Map([["x", { vote: "up", size: "bigger" }]]));
  assert.equal(bigger.significance, Math.min(100, base.significance + RULES.feedback.up + RULES.feedback.bigger));
  const dropped = scoreItem({ id: "x", rule: "fda-efficacy", adjustments: [], published_at: today }, today, new Map([["x", { size: "dropped" }]]));
  assert.equal(dropped.drop, true);
  const selected = selectHeadlines([
    { ...base, id: "keep", scout_source: "openfda-drugsfda", rule: "fda-efficacy", drop: false },
    { id: "gone", scout_source: "openfda-drugsfda", rule: "fda-efficacy", significance: 90, drop: true, published_at: today },
  ]);
  assert.deepEqual(selected.map((item) => item.id), ["keep"]);
  const mixed = [];
  for (let i = 0; i < 8; i++) mixed.push({ id: `h${i}`, scout_source: "openfda-drugsfda", rule: "fda-nme", significance: 90, drop: false, published_at: "2026-11-01" });
  mixed.push({ id: "low", scout_source: "openfda-drugsfda", rule: "fda-anda", significance: 34, drop: false, published_at: "2026-11-16" });
  assert.ok(selectHeadlines(mixed).some((item) => item.id === "low"));
});

test("newest feedback file wins and sample files are ignored", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-fb-"));
  fs.writeFileSync(path.join(dir, "sample.json"), JSON.stringify({ sample: true, exported_at: "2026-11-17T00:00:00Z", items: [{ id: "a", vote: "down", size: "dropped" }] }));
  fs.writeFileSync(path.join(dir, "old.json"), JSON.stringify({ exported_at: "2026-11-01T00:00:00Z", items: [{ id: "a", vote: "down", size: "smaller" }] }));
  fs.writeFileSync(path.join(dir, "new.json"), JSON.stringify({ exported_at: "2026-11-16T00:00:00Z", items: [{ id: "a", vote: "up", size: "bigger", note: "lead" }] }));
  const map = loadFeedback(dir);
  assert.equal(map.get("a").vote, "up");
  assert.equal(map.get("a").size, "bigger");
  assert.equal(map.get("a").note, "lead");
});

test("factual check blocks hype and allows an FDA class name", () => {
  assert.ok(factualViolation("This cure is a breakthrough"));
  assert.equal(factualViolation("FDA submission class: Type 1 - New Molecular Entity"), "");
  assert.throws(() => assertFactual("a game-changing approval", "headline"));
});

test("drugsfda items keep the application page and skip labeling supplements", () => {
  const items = drugsfdaItems([{
    application_number: "NDA220425",
    sponsor_name: "ELEVAR",
    products: [{ brand_name: "LYRFIGTU", active_ingredients: [{ name: "EXAMPLE" }] }],
    submissions: [
      { submission_type: "ORIG", submission_number: "1", submission_status: "AP", submission_status_date: "20260923", submission_class_code: "TYPE 1", submission_class_code_description: "Type 1 - New Molecular Entity", review_priority: "PRIORITY" },
      { submission_type: "SUPPL", submission_number: "2", submission_status: "AP", submission_status_date: "20261101", submission_class_code: "LABELING", submission_class_code_description: "Labeling", review_priority: "STANDARD" },
    ],
  }], "2026-11-17");
  assert.equal(items.length, 1);
  assert.equal(items[0].rule, "fda-nme");
  assert.equal(items[0].source_url, "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=220425");
  assert.match(items[0].headline, /Lyrfigtu/);
  assert.equal(items[0].blurb.includes("cure"), false);
  assert.ok(items[0].blurb.length > 20);
  const unnamed = drugsfdaItems([{
    application_number: "NDA221291",
    sponsor_name: "BAYER HEALTHCARE",
    submissions: [{ submission_type: "ORIG", submission_number: "1", submission_status: "AP", submission_status_date: "20261109", submission_class_code: "TYPE 1", submission_class_code_description: "Type 1 - New Molecular Entity", review_priority: "PRIORITY" }],
  }], "2026-11-17");
  assert.doesNotMatch(unnamed[0].headline, /NDA|BLA|records original approval/i);
  assert.match(unnamed[0].blurb, /NDA 221291/);
  assert.doesNotMatch(unnamed[0].headline, /Bayer/);
  assert.match(unnamed[0].blurb, /Bayer|Type 1|priority|2026-11-09/);
  assert.notEqual(unnamed[0].blurb, unnamed[0].headline);
  const indicated = drugsfdaItems([{
    application_number: "NDA220425",
    sponsor_name: "ELEVAR",
    products: [{ brand_name: "LYRFIGTU", active_ingredients: [{ name: "EXAMPLE" }], dosage_form: "CAPSULE", route: "ORAL" }],
    submissions: [{ submission_type: "ORIG", submission_number: "1", submission_status: "AP", submission_status_date: "20260923", submission_class_code: "TYPE 1", submission_class_code_description: "Type 1 - New Molecular Entity", review_priority: "PRIORITY" }],
  }], "2026-11-17", new Map([["NDA220425", { indication: "the treatment of adults with example disease", area: "Kinase inhibitor" }]]));
  assert.match(indicated[0].headline, /Lyrfigtu/);
  assert.match(indicated[0].headline, /example disease/);
  assert.match(indicated[0].blurb, /Elevar|Type 1|2026-09-23|capsule|oral|priority/);
  assert.equal(indicated[0].blurb.includes(indicated[0].headline), false);
});

test("complete response letters drop personal fields", () => {
  const items = crlItems([{
    letter_date: "08/07/2026",
    file_name: "CRL_NDA218705_20260807.pdf",
    approval_status: "Unapproved",
    company_name: "ITM Solucin GmbH",
    company_rep: "Ada Lovelace",
    company_address: "5 Vaughn Drive, Suite 390",
    approver_name: "Grace Hopper",
    application_number: ["NDA 218705"],
    letter_type: "COMPLETE RESPONSE",
    text: "NDA 218705\nFACILITY INSPECTION\nThe facility was not named here.\n",
  }], "2026-11-17");
  assert.equal(items.length, 1);
  const packed = JSON.stringify(items[0]);
  assert.equal(packed.includes("Ada Lovelace"), false);
  assert.equal(packed.includes("Vaughn"), false);
  assert.equal(packed.includes("Grace Hopper"), false);
  assert.equal(packed.includes("company_rep"), false);
  assert.match(items[0].source_url, /^https:\/\/download\.open\.fda\.gov\/crl\/CRL_NDA218705_20260807\.pdf$/);
  assert.match(items[0].blurb, /facility/);
});

test("orange book loss of exclusivity uses the last unexpired protection", () => {
  const items = orangeBookLoe({
    products: [
      { Appl_Type: "N", Appl_No: "020610", Trade_Name: "COLAZAL", Ingredient: "BALSALAZIDE", Applicant_Full_Name: "EXAMPLE SPONSOR" },
      { Appl_Type: "A", Appl_No: "090001", Trade_Name: "GENERIC", Ingredient: "BALSALAZIDE", Applicant: "ANDA HOLDER" },
    ],
    exclusivity: [
      { Appl_Type: "N", Appl_No: "020610", Exclusivity_Code: "ODE", Exclusivity_Date: "Dec 1, 2026" },
    ],
    patent: [
      { Appl_Type: "N", Appl_No: "020610", Patent_No: "999", Patent_Expire_Date_Text: "Jan 1, 2030", Delist_Flag: "N" },
      { Appl_Type: "N", Appl_No: "020610", Patent_No: "111", Patent_Expire_Date_Text: "Nov 20, 2026", Delist_Flag: "Y" },
    ],
  }, "2026-11-17");
  assert.equal(items.length, 0, "a 2030 patent is the last protection, so a December exclusivity is not the loss-of-exclusivity date");

  const soon = orangeBookLoe({
    products: [{ Appl_Type: "N", Appl_No: "020610", Trade_Name: "COLAZAL", Ingredient: "BALSALAZIDE", Applicant_Full_Name: "EXAMPLE SPONSOR" }],
    exclusivity: [{ Appl_Type: "N", Appl_No: "020610", Exclusivity_Code: "ODE", Exclusivity_Date: "Dec 1, 2026" }],
    patent: [{ Appl_Type: "N", Appl_No: "020610", Patent_No: "111", Patent_Expire_Date_Text: "Nov 20, 2026", Delist_Flag: "Y" }],
  }, "2026-11-17");
  assert.equal(soon.length, 1);
  assert.equal(soon[0].rule, "orange-loe-exclusivity");
  assert.match(soon[0].headline, /Colazal/);
  assert.match(soon[0].source_url, /Appl_No=020610/);
});

test("purple book changes become one item per event", () => {
  const csv = [
    "Purple Book Monthly Historical Data Changes Report - October 2026",
    "N/R/U,Applicant,BLA Number,Proprietary Name,Proper Name,License Type,Approval Date,Inter. Approval Date,Ref. Product Proprietary Name,Licensure,Center,Submission Type",
    'N,Example Bio,125845,Fayuvi,Examplegene,351(a),"September 17, 2026",,,Licensed,CBER,Original',
    'U,Formycon AG,761378,Ahzantive,Aflibercept-mrbb,351(k) Interchangeable,"June 28, 2024","October 22, 2026",Eylea,Licensed,CDER,Original',
    'U,Old Co,020378,Gonal-f,Follitropin alfa,351(a),"February 28, 2001",,,Voluntarily Revoked,CDER,Supplement',
    "N/R/U,Applicant,BLA Number,Proprietary Name",
    ",Merck,101062,Old product",
  ].join("\n");
  const items = purpleBookItems(csv, "https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/2026/purplebook-search-October-data-download.csv");
  const ids = items.map((row) => row.rule).sort();
  assert.deepEqual(ids, ["purple-351a", "purple-interchangeable", "purple-revoked"]);
  const fayuvi = items.find((row) => row.rule === "purple-351a");
  assert.match(fayuvi.source_url, /purplebook-search-October/);
  const ahz = items.find((row) => row.rule === "purple-interchangeable");
  assert.match(ahz.source_url, /ApplNo=761378/);
  assert.match(ahz.headline, /Eylea/);
});

test("ema items use authorisation and opinion dates, not variation decisions", () => {
  const items = emaItems([
    { category: "Human", generic: "No", name_of_medicine: "Aumseqa", international_non_proprietary_name_common_name: "aumolertinib", ema_product_number: "EMEA/H/C/1", medicine_status: "Opinion", opinion_status: "Positive", opinion_adopted_date: "12/11/2026", medicine_url: "https://www.ema.europa.eu/en/medicines/human/EPAR/aumseqa", biosimilar: "No", conditional_approval: "No", orphan_medicine: "No", therapeutic_indication: "Treatment of non-small cell lung cancer in adults.", therapeutic_area_mesh: "Carcinoma, Non-Small-Cell Lung", pharmacotherapeutic_group_human: "Epidermal growth factor receptor (EGFR) tyrosine kinase inhibitors", marketing_authorisation_developer_applicant_holder: "SFL Pharmaceuticals Deutschland GmbH" },
    { category: "Human", generic: "No", name_of_medicine: "Soliris", international_non_proprietary_name_common_name: "eculizumab", ema_product_number: "EMEA/H/C/2", medicine_status: "Authorised", opinion_status: "", marketing_authorisation_date: "20/06/2007", european_commission_decision_date: "16/11/2026", medicine_url: "https://www.ema.europa.eu/en/medicines/human/EPAR/soliris", biosimilar: "No", conditional_approval: "No", orphan_medicine: "Yes" },
    { category: "Human", generic: "Yes", name_of_medicine: "Generic", ema_product_number: "EMEA/H/C/3", medicine_status: "Authorised", marketing_authorisation_date: "12/11/2026", medicine_url: "https://www.ema.europa.eu/en/medicines/human/EPAR/generic" },
  ], "2026-11-17");
  assert.equal(items.length, 1);
  assert.equal(items[0].rule, "ema-opinion");
  const packed = `${items[0].headline} ${items[0].blurb}`;
  assert.match(packed, /Aumseqa/);
  assert.match(packed, /non-small cell lung cancer|Carcinoma, Non-Small-Cell Lung/i);
  assert.match(packed, /SFL Pharmaceuticals|tyrosine kinase|EMEA\/H\/C\/1/);
  assert.ok(items[0].blurb.length > 20);
  assert.equal(items[0].blurb.includes(items[0].headline), false);
});

test("paper titles that assert efficacy are skipped", () => {
  const items = europePmcItems([
    { id: "1", source: "MED", doi: "10.1000/example", title: "Azetukalner in adults: the X-TOLE2 phase 3 randomized clinical trial", firstPublicationDate: "2026-11-09" },
    { id: "2", source: "MED", doi: "10.1000/claim", title: "Filgotinib effective across the axSpA spectrum in phase III trial", firstPublicationDate: "2026-11-01" },
  ]);
  assert.equal(items.length, 1);
  assert.match(items[0].source_url, /^https:\/\/doi\.org\/10\.1000\/example$/);
  assert.match(items[0].blurb, /2026-11-09/);
  assert.match(items[0].blurb, /Europe PMC|MED/);
  assert.equal(items[0].blurb.includes(items[0].headline), false);
});

test("adcom keeps meeting notices and drops nominations", () => {
  const items = adcomItems([
    { title: "Microbiology Devices Panel of the Medical Devices Advisory Committee; Notice of Meeting", document_number: "2026-1", publication_date: "2026-09-16", dates: "The meeting will be held on November 19, 2026.", html_url: "https://www.federalregister.gov/documents/2026/09/16/2026-1/meeting" },
    { title: "Request for Nominations for Voting Members on a Public Advisory Committee; Tobacco Products Scientific Advisory Committee", document_number: "2026-2", publication_date: "2026-10-15", dates: "Nominations received on or before December 14, 2026.", html_url: "https://www.federalregister.gov/documents/2026/10/15/2026-2/nominations" },
  ], "2026-11-17");
  assert.equal(items.length, 1);
  assert.match(items[0].headline, /Nov 19|November 19, 2026|2026-11-19/);
  assert.match(items[0].headline, /Microbiology/);
});

test("built file keeps the contract fields and applies feedback", () => {
  const feedback = new Map([["openfda-drugsfda:NDA1:2026-11-01:ORIG:1", { size: "dropped" }]]);
  const payload = buildHeadlines({
    today: "2026-11-17",
    feedback,
    sources: [{ id: "swissmedic", enabled: false, status: "disabled", note: "no" }],
    candidates: [
      { id: "openfda-drugsfda:NDA1:2026-11-01:ORIG:1", headline: "Dropped", blurb: "", source_url: "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=1", source_type: "regulator", source_name: "FDA", published_at: "2026-11-01", scout_source: "openfda-drugsfda", rule: "fda-nme", adjustments: [], dedupe_key: "a" },
      { id: "ema:1", headline: "Kept opinion", blurb: "One sentence.", source_url: "https://www.ema.europa.eu/en/medicines/human/EPAR/example", source_type: "regulator", source_name: "European Medicines Agency", published_at: "2026-11-12", scout_source: "ema", rule: "ema-opinion", adjustments: [], dedupe_key: "b" },
    ],
  });
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, "ema:1");
  for (const key of ["id", "headline", "blurb", "source_url", "source_type", "source_name", "published_at", "significance", "significance_rationale", "scout_source"]) {
    assert.ok(key in payload.items[0], key);
  }
  assert.equal("drop" in payload.items[0], false);
});

test("wording is chosen from the item id and an indication leads", () => {
  assert.equal(hashId("same"), hashId("same"));
  assert.notEqual(hashId("same"), hashId("other"));
  const facts = {
    rule: "fda-nme",
    brand: "Lyrfigtu",
    ingredient: "Example",
    sponsor: "Elevar",
    app: "NDA 220425",
    desc: "Type 1 - New Molecular Entity",
    priority: true,
    reviewPriority: "PRIORITY",
    published: "2026-09-23",
    indication: "the treatment of adults with example disease",
    area: "",
    route: "ORAL",
    dosage: "CAPSULE",
  };
  const headlines = new Set();
  for (let i = 0; i < 12; i++) {
    const copy = fdaApprovalCopy(`openfda:${i}`, facts);
    assert.equal(copy.headline, fdaApprovalCopy(`openfda:${i}`, facts).headline);
    assert.match(copy.headline, /Lyrfigtu/);
    assert.match(copy.headline, /example disease/);
    assert.ok(copy.blurb);
    assert.equal(copy.blurb.includes(copy.headline), false);
    headlines.add(copy.headline);
  }
  assert.ok(headlines.size >= 2);
  assert.equal(indicationPhrase("1 INDICATIONS AND USAGE Example is indicated for the treatment of adults with atopic dermatitis."), "the treatment of adults with atopic dermatitis");
  assert.equal(indicationPhrase("HIBSAGO is indicated in combination with other therapy for treatment of chronic hepatitis B virus (HBV) infection in adult patients without cirrhosis: who have been on therapy."), "treatment of chronic hepatitis B virus (HBV) infection in adult patients without cirrhosis");
  assert.equal(pressProduct("FDA today approved Sunharbo (asundexian) 50 mg tablets, the first factor XIa inhibitor to reduce the risk of stroke."), "Sunharbo (asundexian) 50 mg tablets");
});

test("adjacent items change source and regulators stay at or under half", () => {
  const items = [];
  for (const source of REGULATOR_SOURCES) {
    for (let i = 0; i < 6; i++) {
      items.push({ id: `${source}-${i}`, scout_source: source, rule: "fda-nme", significance: 90 - i, drop: false, published_at: "2026-11-01" });
    }
  }
  for (let i = 0; i < 4; i++) {
    items.push({ id: `europepmc-${i}`, scout_source: "europepmc", rule: "paper-phase3", significance: 70, drop: false, published_at: "2026-11-10" });
  }
  const selected = selectHeadlines(items);
  const regs = selected.filter((item) => REGULATOR_SOURCES.has(item.scout_source)).length;
  assert.ok(selected.length >= 2);
  assert.ok(regs <= selected.length - regs);
  for (let i = 1; i < selected.length; i++) {
    const alternativeLeft = selected.slice(i).some((item) => item.scout_source !== selected[i - 1].scout_source);
    if (alternativeLeft) assert.notEqual(selected[i].scout_source, selected[i - 1].scout_source);
  }
});

test("headlines stay within 14 words by trimming clauses", () => {
  const hibsago = "Hibsago (Bepirovirsen) indicated for treatment of chronic hepatitis B virus (HBV) infection in adult patients without cirrhosis";
  const cut = shortenHeadline(hibsago);
  assert.ok(wordCount(cut.headline) <= HEADLINE_WORD_MAX, cut.headline);
  assert.ok(wordCount(cut.headline) <= 12, cut.headline);
  assert.match(cut.headline, /Hibsago/);
  assert.match(cut.headline, /hepatitis B/);
  assert.match(cut.extra, /adult patients without cirrhosis/);
  const press = shortenHeadline("FDA Approves First Factor Xla Inhibitor to Help Prevent Stroke in Certain Adults at High Risk");
  assert.ok(wordCount(press.headline) <= HEADLINE_WORD_MAX);
  assert.match(press.headline, /FDA Approves/);
  assert.match(press.headline, /Stroke/);
  assert.match(press.extra, /Certain Adults/);
  const compared = "Generative AI Versus Primary Care Physicians from Plan Initiation to Long-Term Maintenance of Chronic Disease Self-Management: A Vignette-Based Validation Study";
  assert.ok(wordCount(compared) > 14);
  const paperCut = shortenPaperHeadline(compared);
  assert.ok(wordCount(paperCut.headline) >= 6, paperCut.headline);
  assert.ok(wordCount(paperCut.headline) <= HEADLINE_WORD_MAX, paperCut.headline);
  assert.match(paperCut.headline, /Versus Primary Care Physicians from Plan/);
  const intact = "JAMA: Tale of Two Estimands: Distinguishing What Is Observed From What Is Inferred";
  assert.ok(wordCount(intact) <= 14);
  assert.equal(shortenPaperHeadline(intact).headline, intact);
  const trials = [
    trialCopy("t1", { phase3: true, title: "A Study on the Immune Response and Safety of a Combined Vaccine", condition: "Diphtheria-Tetanus-acellular Pertussis Vaccines", sponsor: "Example", status: "recruiting", when: "estimated", date: "2026-11-23" }),
    trialCopy("t2", { phase3: true, title: "Avelumab Program Rollover Study", condition: "", sponsor: "Example", status: "active", when: "estimated", date: "2026-11-24" }),
    trialCopy("t3", { phase3: false, title: "A very long study title that would crowd out the completion date if it were pasted in full here", condition: "Solid Tumors", sponsor: "Example", status: "recruiting", when: "listed", date: "2026-12-01" }),
  ];
  for (const item of trials) {
    assert.doesNotMatch(item.headline, /\d{4}-\d{2}-\d{2}/, item.headline);
    assert.match(item.headline, /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/, item.headline);
    assert.match(item.blurb, /Example/);
    assert.equal(echoesHeadline(item.headline, item.blurb), false, item.blurb);
    const dated = item.headline.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/);
    if (dated) assert.equal(item.blurb.includes(dated[0]), false, item.blurb);
    assert.ok(wordCount(item.headline) <= HEADLINE_WORD_MAX, item.headline);
    assert.doesNotMatch(item.headline, /^[a-z]/);
    assert.doesNotMatch(item.headline, /\b(in|for|to|with|of|and|or|a|an|the)$/i);
  }
  const file = JSON.parse(fs.readFileSync(path.join(root, "data", "headlines.json"), "utf8"));
  for (const item of file.items) {
    assert.ok(wordCount(item.headline) <= HEADLINE_WORD_MAX, item.headline);
    assert.ok(item.blurb.trim());
    assert.match(item.source_url, /^https?:\/\//);
    assert.doesNotMatch(item.headline, /\d{4}-\d{2}-\d{2}/, item.headline);
    if (item.source_type === "trial") assert.match(item.headline, /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b|\bin (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/, item.headline);
    assert.doesNotMatch(item.headline, /records original approval/i);
    assert.doesNotMatch(item.headline, /^(NDA|BLA)\b/);
    assert.doesNotMatch(item.headline, /^[a-z]/, item.headline);
    assert.doesNotMatch(item.headline, /\b(in|for|to|with|of|and|or|a|an|the|through|from|by|on|at|into|via)$/i, item.headline);
    assert.doesNotMatch(item.headline, /^(?:JAMA|Int J Oncol|bioRxiv|medRxiv|Cytotechnology)\s*:/i, item.headline);
    assert.doesNotMatch(item.blurb, /^(?:Accession|CIK\b|Authors listed|Card fields|Europe PMC|item dated|Section headings include)/i, item.blurb);
    assert.doesNotMatch(item.blurb, /^(?:The .+ post reports|The paper reports|This preprint\b.*\breports|The FDA press release feed reports|The grant supports)\b/i, item.blurb);
    assert.equal(echoesHeadline(item.headline, item.blurb.replace(/https?:\/\/\S+/g, " ")), false, `${item.headline} :: ${item.blurb}`);
    assert.doesNotMatch(item.blurb, /once-Weekly|alphaGenome|in Adolescents|mHRA|nVIDIA|fDA |cRISPR|aI Is/, item.blurb);
    if (item.source_type === "trial") {
      const dated = item.headline.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/);
      if (dated) assert.equal(item.blurb.includes(dated[0]), false, item.blurb);
    }
  }
  const blurbOpenings = {};
  for (const item of file.items) {
    const key = item.blurb.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
    blurbOpenings[key] = (blurbOpenings[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(blurbOpenings)) {
    assert.ok(count / file.items.length <= 0.2, `blurb ${key} is ${count}/${file.items.length}`);
  }
  const openings = {};
  for (const item of file.items) {
    const key = item.headline.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
    openings[key] = (openings[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(openings)) {
    assert.ok(count / file.items.length <= 0.2, `${key} is ${count}/${file.items.length}`);
  }
});

test("regulator share stays near a quarter and no source exceeds 15 percent of a full page", () => {
  const items = [];
  for (const source of REGULATOR_SOURCES) {
    for (let i = 0; i < 6; i++) {
      items.push({ id: `${source}-${i}`, scout_source: source, rule: "fda-nme", significance: 96 - i, drop: false, published_at: "2026-11-12" });
    }
  }
  const nons = ["europepmc", "biorxiv", "medrxiv", "fda-press", "deepmind", "openai-news", "bcf-papers", "nih-reporter"];
  for (const source of nons) {
    for (let i = 0; i < 8; i++) {
      items.push({ id: `${source}-${i}`, scout_source: source, rule: "paper-ai", significance: 70, drop: false, published_at: "2026-11-10" });
    }
  }
  const selected = selectHeadlines(items);
  const regs = selected.filter((item) => REGULATOR_SOURCES.has(item.scout_source)).length;
  assert.ok(selected.length >= 8);
  assert.ok(regs / selected.length <= RULES.regulatorShare + 0.02, `${regs}/${selected.length}`);
  const counts = {};
  for (const item of selected) counts[item.scout_source] = (counts[item.scout_source] || 0) + 1;
  const maxSrc = Math.max(1, Math.floor(RULES.globalCap * RULES.sourceShare));
  for (const [source, count] of Object.entries(counts)) {
    assert.ok(count <= maxSrc, `${source} ${count}`);
    assert.ok(count / selected.length <= RULES.sourceShare + 0.02, `${source} ${count}/${selected.length}`);
  }
});

test("blurbs state the point without repeating the headline", () => {
  assert.equal(echoesHeadline("Phase 3 KarXT study in Alzheimer's psychosis reaches primary completion Nov 24", "Phase 3 KarXT study in Alzheimer's psychosis reaches primary completion Nov 24."), true);
  const press = pressCopy("press-1", {
    title: "FDA Grants Accelerated Approval to a New Treatment for Head and Neck Squamous Cell Carcinoma",
    description: "The agency granted accelerated approval to a treatment for adults with a form of head and neck cancer.",
    feed: "FDA press release feed",
    published: "2026-11-05",
  });
  assert.doesNotMatch(press.blurb, /^The FDA press release feed reports/i);
  assert.equal(echoesHeadline(press.headline, press.blurb), false, press.blurb);
  assert.ok(wordCount(press.blurb) <= 25, press.blurb);
  const paper = paperCopy("paper-1", {
    title: "Once-Weekly Ribupatide for Weight Loss in Adults",
    journal: "JAMA",
    date: "2026-11-15",
    abstract: "We found that weekly ribupatide produced greater weight loss than placebo among adults with obesity.",
  });
  assert.doesNotMatch(paper.blurb, /^The paper reports/i);
  assert.doesNotMatch(paper.blurb, /once-Weekly/);
  assert.match(paper.blurb, /placebo/i);
  assert.equal(echoesHeadline(paper.headline, paper.blurb), false, paper.blurb);
  const bare = paperCopy("paper-2", {
    title: "Azetukalner in adults: the X-TOLE2 phase 3 randomized clinical trial",
    date: "2026-11-09",
    recordId: "MED 1",
  });
  assert.match(bare.blurb, /2026-11-09/);
  assert.match(bare.blurb, /Europe PMC|MED/);
  assert.doesNotMatch(bare.blurb, /^The paper reports/i);
});

test("Nature news trial stories keep the pivotal-readout boost and the page description", () => {
  const description = "A closely watched study found no cognitive benefit from a brain-stimulating headset designed to treat Alzheimer's disease.";
  const html = `<html><head><meta name="description" content="${description}"></head></html>`;
  assert.equal(metaDescription(html), description);
  const title = "'Light and sound' therapy for Alzheimer's flops in long-anticipated trial";
  const doi = "10.1038/d41586-026-03770-0";
  assert.equal(natureNewsTrial(doi, title), true);
  assert.equal(OUTCOME_CLAIM.test("no cognitive benefit in a pivotal Alzheimer's trial"), true);
  const record = {
    title,
    journalTitle: "Nature",
    firstPublicationDate: "2026-11-17",
    doi,
    source: "MED",
    id: "43045786",
    abstractText: "",
  };
  const kept = paperRecords([record], {
    mode: "journal",
    from: "2026-11-01",
    today: "2026-11-18",
    rule: "paper-journal",
    pageDescriptions: { [doi]: description },
  });
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].adjustments, ["pivotal-readout"]);
  assert.match(kept[0].blurb, /no cognitive benefit/);
  assert.doesNotMatch(kept[0].blurb, /cure|breakthrough|miracle|promising/i);
  const scored = scoreItem(kept[0], "2026-11-18", new Map());
  assert.equal(scored.significance, 80);
  assert.equal(scored.tier, 4);
  const claimed = paperRecords([{
    ...record,
    title: "Headset shows no cognitive benefit in a pivotal Alzheimer's trial",
  }], { mode: "journal", from: "2026-11-01", today: "2026-11-18", rule: "paper-journal" });
  assert.equal(claimed.length, 1);
  const dropped = paperRecords([{
    ...record,
    doi: "10.1038/s41586-026-00000-0",
    title: "Headset shows no cognitive benefit in a pivotal Alzheimer's trial",
  }], { mode: "journal", from: "2026-11-01", today: "2026-11-18", rule: "paper-journal" });
  assert.equal(dropped.length, 0);
  const other = paperRecords([{
    ...record,
    doi: "10.1038/d41586-026-03279-6",
    title: "The origins of scrotal asymmetry",
  }], { mode: "journal", from: "2026-11-01", today: "2026-11-18", rule: "paper-journal" });
  assert.equal(other.length, 1);
  assert.deepEqual(other[0].adjustments, []);
});

test("leads stay grammatical and off-topic posts stay out", () => {
  const stroke = pressLead("FDA Approves First Factor Xla Inhibitor to Help Prevent Stroke in Certain Adults at High Risk");
  assert.match(stroke, /stroke/i);
  assert.ok(wordCount(stroke) <= HEADLINE_WORD_MAX, stroke);
  assert.doesNotMatch(stroke, /^[a-z]/);
  assert.doesNotMatch(stroke, /\b(in|for|to|with|of|and|or|a|an|the)$/i);
  const neck = pressLead("FDA Grants Accelerated Approval to a New Treatment for Head and Neck Squamous Cell Carcinoma");
  assert.match(neck, /head and neck cancer/i);
  assert.doesNotMatch(neck, /\bfor$/i);
  const file = JSON.parse(fs.readFileSync(path.join(root, "data", "headlines.json"), "utf8"));
  const blob = file.items.map((item) => `${item.headline}\n${item.blurb}`).join("\n");
  assert.doesNotMatch(blob, /Microsoft outage/i);
  assert.doesNotMatch(blob, /Our new blog for science/i);
  assert.doesNotMatch(blob, /CUDA at 20/i);
  assert.doesNotMatch(blob, /Tale of Two Estimands/i);
  assert.doesNotMatch(blob, /scientific computing/i);
});

test("pubmed eutils and x stay disabled", () => {
  const pubmed = SOURCES.find((row) => row.id === "pubmed-eutils");
  assert.equal(pubmed.enabled, false);
  assert.equal(pubmed.fetch, undefined);
  assert.match(pubmed.reason, /Disallow: \//);
  const x = SOURCES.find((row) => row.id === "x");
  assert.equal(x.enabled, false);
  assert.equal(x.fetch, undefined);
  assert.match(x.reason, /credential/i);
  for (const id of ["biorxiv", "medrxiv", "bcf-papers", "bcf-ai-discovery", "nih-reporter", "sec-edgar-8k", "fda-press", "nih-news"]) {
    const source = SOURCES.find((row) => row.id === id);
    assert.equal(source.enabled, true, id);
    assert.equal(typeof source.fetch, "function", id);
  }
  const robots = parseRobots("User-agent: *\nDisallow: /cgi-bin\nAllow: /Archives/edgar/data\n");
  assert.equal(robotsDecision(robots, "BioCatalystFeed contact@biocat.ai", "/cgi-bin/browse-edgar").allowed, false);
  assert.equal(robotsDecision(robots, "BioCatalystFeed contact@biocat.ai", "/Archives/edgar/daily-index/2026/QTR4/master.idx").allowed, true);
});

test("the public headlines page drops test wording and shows a dated source line", () => {
  const html = fs.readFileSync(path.join(root, "headlines", "index.html"), "utf8");
  const review = fs.readFileSync(path.join(root, "headlines", "review", "index.html"), "utf8");
  const pageJs = fs.readFileSync(path.join(root, "headlines", "headlines.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "headlines", "headlines.css"), "utf8");
  assert.equal(html.includes("Test version"), false);
  assert.equal(html.includes("Review this test page"), false);
  assert.equal(html.includes("/headlines/review/"), false);
  assert.match(html, /BioCat Headlines — biotech news ranked by significance/);
  assert.match(html, /name="description"/);
  assert.match(html, /href="\/assets\/brand\/favicon\.ico"/);
  assert.match(html, /Not medical or investment advice\./);
  assert.match(html, /href="\/">biocat\.ai/);
  assert.match(html, /id="updated"/);
  assert.match(html, /Try again/);
  assert.match(html, /float: right|class="finder"/);
  assert.match(css, /\.finder \{[\s\S]*float: right/);
  assert.match(css, /text-wrap: pretty/);
  assert.match(pageJs, /showUnavailable\("Headlines could not be loaded\."\)/);
  assert.match(pageJs, /showUnavailable\("No headlines in this edition\."\)/);
  assert.match(pageJs, /href: "\/headlines\/", text: "Try again"/);
  assert.match(pageJs, /href: "\/", text: "biocat\.ai"/);
  assert.equal(formatDay("2026-11-09"), "Mon, Nov 9, 2026");
  assert.equal(formatLocalDay("2026-11-18T21:31:00Z", "Asia/Tokyo"), "Thu, Nov 19, 2026");
  assert.equal(formatUpdatedTime("2026-11-18T21:31:00Z", "Asia/Tokyo"), "6:31 AM");
  assert.equal(formatLocalDay("2026-11-18T21:31:00Z", "America/New_York"), "Wed, Nov 18, 2026");
  assert.equal(formatUpdatedTime("2026-11-18T21:31:00Z", "America/New_York"), "4:31 PM");
  const stamped = "2026-11-18T21:31:34.662Z";
  const page = [
    "<p class=\"home-dateline\" id=\"home-dateline\">OLD DATE</p>",
    "<p id=\"keep-me\">Do not touch</p>",
    "<h1 id=\"home-dateline-title\">Title</h1>",
    "<p class=\"dek\" id=\"updated-local\">OLD TIME</p>",
    "<p class=\"dek\" id=\"home-updated\">OLD TIME</p>",
    "<p class=\"dateline\" id=\"dateline\">OLD DATE</p>",
  ].join("");
  const home = rewriteDatelineFallbacks(page, stamped, ["home-dateline", "home-updated"]);
  const homeAgain = rewriteDatelineFallbacks(home, stamped, ["home-dateline", "home-updated"]);
  assert.equal(homeAgain, home);
  assert.match(home, /id="home-dateline">Wed, Nov 18, 2026</);
  assert.match(home, /id="home-updated">Updated 9:31 PM UTC</);
  assert.match(home, /id="dateline">OLD DATE</);
  assert.match(home, /id="updated-local">OLD TIME</);
  assert.match(home, /id="keep-me">Do not touch</);
  assert.match(home, /id="home-dateline-title">Title</);
  const headlines = rewriteDatelineFallbacks(page, stamped, ["dateline", "updated-local"]);
  assert.equal(rewriteDatelineFallbacks(headlines, stamped, ["dateline", "updated-local"]), headlines);
  assert.match(headlines, /id="dateline">Wed, Nov 18, 2026</);
  assert.match(headlines, /id="updated-local">Updated 9:31 PM UTC</);
  assert.match(headlines, /id="home-dateline">OLD DATE</);
  const blank = (html) => html.replace(/(id="(?:home-dateline|home-updated|dateline|updated-local)">)[\s\S]*?(<\/)/g, "$1$2");
  assert.equal(blank(home), blank(page));
  assert.equal(blank(headlines), blank(page));
  assert.equal(formatStamp("2026-11-18T08:40:00.000Z", "Asia/Tokyo"), "Wed, Nov 18, 2026, 5:40 PM GMT+9");
  assert.match(formatStamp("2026-11-18T08:40:00.000Z", "Not/AZone"), /8:40 AM UTC/);
  assert.match(pageJs, /datetime: data\.generated_at/);
  assert.match(pageJs, /formatStamp\(data\.generated_at\)/);
  assert.equal(keepLastToken("Application NDA 221291."), "Application NDA\u00a0221291.");
  assert.match(review, /content="noindex"/);
  assert.match(review, /Back to headlines/);
  assert.equal(review.includes("test headlines"), false);
});

test("headlines search hits every worker route and the review page stays noindex", () => {
  const html = fs.readFileSync(path.join(root, "headlines", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "headlines", "headlines.css"), "utf8");
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "headlines.yml"), "utf8");
  const picks = JSON.parse(fs.readFileSync(path.join(root, "data", "x_picks.json"), "utf8"));
  assert.doesNotMatch(html, /name="robots" content="noindex"/);
  assert.match(html, /rel="canonical" href="https:\/\/biocat\.ai\/headlines\/"/);
  const review = fs.readFileSync(path.join(root, "headlines", "review", "index.html"), "utf8");
  assert.match(review, /content="noindex"/);
  assert.match(html, /id="hl-q"/);
  assert.match(html, /href="\/#demo"/);
  assert.match(html, /biocatalystfeed-api\.biocatalystfeed\.workers\.dev/);
  assert.match(css, /\.finder/);
  assert.equal(picks.schema, "biocat-x-picks/1");
  assert.equal(typeof picks.enabled, "boolean");
  assert.ok(Array.isArray(picks.picks));
  for (const pick of picks.picks) {
    assert.equal(xPickItems({ enabled: true, picks: [pick] }).length, 1);
  }
  assert.match(workflow, /cron: "20 1,7,13,19 \* \* \*"/);
  assert.match(workflow, /cron: "0 2,8,14,20 \* \* \*"/);
  assert.match(workflow, /group: headlines-update/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /age < 3/);
  assert.match(workflow, /git diff --cached --quiet/);
  const urls = searchUrls("GLP-1");
  assert.equal(urls.length, SEARCH_ROUTES.length);
  for (const route of SEARCH_ROUTES) assert.ok(urls.some((url) => url === `https://biocatalystfeed-api.biocatalystfeed.workers.dev/${route}?q=GLP-1`), route);
  const stock = `<p>Open Government Licence</p><img src="https://assets.publishing.service.gov.uk/media/x/iStock-1.png" alt="pills">`;
  assert.equal(pageImage(stock, "https://www.gov.uk/government/news/example", "ogl"), null);
  const filler = `<p>Open Government Licence</p><img src="https://assets.publishing.service.gov.uk/media/x/placeholder.jpg" alt="placeholder">`;
  assert.equal(pageImage(filler, "https://www.gov.uk/government/news/example", "ogl"), null);
  const owned = `<p>Open Government Licence v3.0</p><img src="https://assets.publishing.service.gov.uk/media/x/lab-bench.jpg" alt="A laboratory bench at an MHRA site" width="640" height="360">`;
  const image = pageImage(owned, "https://www.gov.uk/government/news/example", "ogl");
  assert.equal(image.licence, "Open Government Licence v3.0");
  assert.match(image.basisUrl, /open-government-licence/);
  assert.equal(licenceOk("CC BY-SA 4.0"), true);
  assert.equal(licenceOk("CC BY-NC 4.0"), false);
  assert.equal(licenceOk("CC BY-ND 4.0"), false);
});

test("headline images stay within four and carry a reuse basis", () => {
  const file = JSON.parse(fs.readFileSync(path.join(root, "data", "headlines.json"), "utf8"));
  const images = file.items.flatMap((item, index) => item.image ? [{ image: item.image, index }] : []);
  assert.ok(images.length <= 4, String(images.length));
  assert.ok(images.every((row) => row.index < 5));
  assert.ok(images.filter((row) => row.image.type === "diagram").length <= 1);
  for (let i = 1; i < images.length; i += 1) {
    assert.notEqual(images[i].image.type, images[i - 1].image.type);
  }
  for (const row of images) {
    for (const key of ["src", "sourcePage", "credit", "licence", "basisUrl", "alt"]) {
      assert.ok(row.image[key], key);
    }
    assert.match(row.image.basisUrl, /^https:\/\//);
    assert.equal(licenceOk(row.image.licence) || row.image.licence === "Open Government Licence v3.0", true, row.image.licence);
  }
});

test("image placement rejects a weak or non-allowlisted match and varies the type", () => {
  assert.equal(licenceOk("CC BY-NC 4.0"), false);
  assert.equal(licenceOk("CC BY-ND 4.0"), false);
  assert.equal(licenceOk("All rights reserved"), false);
  assert.equal(licenceOk("CC0"), true);
  assert.equal(licenceOk("CC BY 4.0"), true);
  assert.equal(licenceOk("CC BY-SA 4.0"), true);
  assert.equal(licenceOk("Public domain"), true);
  const base = {
    src: "https://upload.wikimedia.org/example.jpg",
    credit: "Ada Lovelace",
    alt: "A laboratory bench",
    licence: "CC BY 4.0",
    basisUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    type: "photo",
    relevance: 3,
  };
  const placed = placeImages([
    { index: 0, candidates: [base, { ...base, src: "https://upload.wikimedia.org/diagram.png", type: "diagram", alt: "Chemical structure of asundexian", relevance: 3 }] },
    { index: 1, candidates: [{ ...base, src: "https://upload.wikimedia.org/second.jpg", type: "photo", relevance: 3 }, { ...base, src: "https://upload.wikimedia.org/scope.jpg", type: "micrograph", alt: "Micrograph of lung tissue", relevance: 3 }] },
    { index: 2, candidates: [{ ...base, src: "https://upload.wikimedia.org/weak.jpg", relevance: 1, alt: "A vague picture" }] },
    { index: 3, candidates: [{ ...base, src: "https://upload.wikimedia.org/nc.jpg", licence: "CC BY-NC 4.0", relevance: 4 }] },
    { index: 4, candidates: [{ ...base, src: "https://upload.wikimedia.org/child.jpg", alt: "A child in a hospital", relevance: 4, type: "illustration" }] },
  ]);
  assert.deepEqual(placed.map((row) => row.image.type), ["photo", "micrograph"]);
  assert.equal(placed.filter((row) => row.image.type === "diagram").length, 0);
  const onlyDiagrams = placeImages([
    { index: 0, candidates: [{ ...base, src: "https://upload.wikimedia.org/a.svg", type: "diagram", relevance: 3 }] },
    { index: 1, candidates: [{ ...base, src: "https://upload.wikimedia.org/b.svg", type: "diagram", relevance: 3 }] },
  ]);
  assert.equal(onlyDiagrams.length, 1);
  const entities = imageEntities({ headline: "FDA approves Bayer's Sunharbo (asundexian), a new molecular entity", image_entity: { kind: "inn", name: "asundexian" } });
  assert.equal(relevanceScore(entities, "Skeletal formula of asundexian"), 3);
  assert.equal(relevanceScore(entities, "A random hospital corridor"), 0);
  assert.equal(relevanceScore(entities, "The Bayer pattern on a Mars camera"), 0);
  const pressure = imageEntities({ headline: "Europe recommends AstraZeneca's Baxfendy for high blood pressure in adults" });
  const cuff = explainMatch(pressure, "A clinician measuring blood pressure with a cuff", "photo");
  assert.equal(cuff.score, 3);
  assert.match(cuff.reason, /blood pressure/);
  assert.equal(explainMatch(pressure, "Cell Phones & Blood Pressure, after Adriaen Brouwer", "illustration").score, 0);
  const tumor = imageEntities({ headline: "Phase 3 Avelumab study in solid tumors reaches its primary completion Nov 24" });
  assert.equal(imageType("Engineered polymeric microneedle cellular delivery. A basic overview of a porous microneedle matrix."), "diagram");
  assert.equal(explainMatch(tumor, "porous microneedle matrix to load T-cells for delivery to solid tumors", "diagram").score, 0);
  assert.equal(relevanceScore([{ term: "solid", kind: "topic" }], "a solid block"), 0);
  const summit = imageEntities({ headline: "FDA sends Summit Therapeutics Inc. a complete response letter" });
  assert.deepEqual(summit.map((entry) => entry.term), ["Summit Therapeutics"]);
  assert.equal(explainMatch(summit, "2022 Auto-Tech and TalkRobot at Web Summit", "photo").score, 0);
  assert.equal(explainMatch([{ term: "Summit", kind: "org" }], "Photographed at Web Summit in Lisbon", "photo").score, 0);
  assert.equal(explainMatch([{ term: "Bayer", kind: "org" }], "A pano of the Bayer main factories in Leverkusen", "photo").score, 3);
  assert.equal(imageResponseOk(200, "image/jpeg"), true);
  assert.equal(imageResponseOk(200, "text/html"), false);
  assert.equal(imageResponseOk(404, "image/jpeg"), false);
  const open = openverseImage({
    license: "by-sa",
    license_version: "4.0",
    title: "Aspirin crystals",
    creator: "Someone",
    url: "https://live.staticflickr.com/1/a.jpg",
    foreign_landing_url: "https://www.flickr.com/photos/x/1",
    width: 800,
    height: 600,
  }, entities);
  assert.equal(open, null);
  const kept = openverseImage({
    license: "cc0",
    license_version: "1.0",
    license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
    title: "Bayer laboratory bench",
    creator: "A chemist",
    url: "https://live.staticflickr.com/1/bayer.jpg",
    foreign_landing_url: "https://www.flickr.com/photos/x/2",
    width: 800,
    height: 600,
    tags: [],
  }, entities);
  assert.equal(kept.licence.startsWith("CC0"), true);
  assert.equal(kept.credit, "A chemist");
  assert.ok(kept.alt);
  const logo = nasaImage({
    data: [{ media_type: "image", title: "NASA logo", description: "The NASA insignia", nasa_id: "logo1", photographer: "NASA" }],
    links: [{ href: "https://images-assets.nasa.gov/image/logo1/logo1~small.jpg", width: 100, height: 100 }],
  }, entities);
  assert.equal(logo, null);
  assert.equal(IMAGE_SOURCES["flickr-niaid"].allowed, false);
  assert.match(IMAGE_SOURCES["flickr-niaid"].robots, /Disallow/);
  assert.equal(IMAGE_SOURCES["nci-visuals"].allowed, false);
  assert.equal(IMAGE_SOURCES["cdc-phil"].allowed, false);
  assert.equal(IMAGE_SOURCES.openverse.allowed, false);
  assert.match(IMAGE_SOURCES.openverse.robots, /Disallow: \/v1\/images\//);
  assert.equal(IMAGE_SOURCES.nasa.allowed, true);
});

test("an X account keeps three headlines and yields a duplicate event to another account", () => {
  const stat = (n, score, extra = {}) => ({
    id: `stat-${n}`,
    headline: extra.headline || `Distinct statnews headline number ${n} today`,
    blurb: "A separate note.",
    source_url: `https://x.com/StatNews/status/${n}`,
    source_type: "news",
    source_name: "X",
    published_at: "2026-11-20",
    significance: score,
    tier: 3,
    scout_source: "x",
    x_handle: n % 2 ? "StatNews" : "statnews",
    linked_url: extra.linked_url || `https://www.statnews.com/story-${n}`,
    drop: false,
    ...extra,
  });
  const shared = "https://www.statnews.com/shared-story/?utm_source=x";
  const overflow = stat(4, 60, { linked_url: shared, headline: "Shared pancreatic cancer readout looks strong" });
  const dropped = stat(5, 50, { headline: "Only statnews covered this other readout" });
  const doiOverflow = stat(6, 40, { headline: "Unrelated wording about a methods paper", doi: "10.1126/sciimmunol.aej5412", linked_url: "https://www.statnews.com/doi-story" });
  const page = [stat(1, 90), stat(2, 80), stat(3, 70), overflow, dropped, doiOverflow];
  const byUrl = {
    id: "bio-url",
    headline: "A different desk headline",
    blurb: "Another note.",
    source_url: "https://x.com/biospace/status/90",
    source_type: "news",
    source_name: "X",
    published_at: "2026-11-20",
    significance: 58,
    tier: 2,
    scout_source: "x",
    x_handle: "BioSpace",
    linked_url: "https://statnews.com/shared-story",
    drop: false,
  };
  const byText = {
    id: "endpts-text",
    headline: "Shared pancreatic cancer readout looks strong today",
    blurb: "A third desk.",
    source_url: "https://x.com/endpts/status/91",
    source_type: "news",
    source_name: "X",
    published_at: "2026-11-19",
    significance: 20,
    tier: 1,
    scout_source: "x",
    x_handle: "endpts",
    linked_url: "https://endpoints.news/other-story",
    drop: false,
  };
  const byDoi = {
    id: "topol-doi",
    headline: "Chromatin maps in older mice",
    blurb: "A paper note.",
    source_url: "https://x.com/EricTopol/status/92",
    source_type: "news",
    source_name: "X",
    published_at: "2026-11-21",
    significance: 57,
    tier: 2,
    scout_source: "x",
    x_handle: "erictopol",
    linked_url: "https://www.science.org/doi/10.1126/sciimmunol.aej5412",
    doi: "10.1126/sciimmunol.aej5412",
    drop: false,
  };
  const full = {
    id: "biospace-full",
    headline: "Biospace already has three of its own",
    blurb: "Filled.",
    source_url: "https://x.com/biospace/status/70",
    significance: 95,
    scout_source: "x",
    x_handle: "biospace",
    linked_url: "https://www.biospace.com/one",
    drop: false,
  };
  const selected = capXAccounts(page, [...page, byUrl, byText, byDoi, full, { ...full, id: "biospace-2", source_url: "https://x.com/biospace/status/71", linked_url: "https://www.biospace.com/two" }, { ...full, id: "biospace-3", source_url: "https://x.com/biospace/status/72", linked_url: "https://www.biospace.com/three" }]);
  const counts = {};
  for (const item of selected) {
    const handle = xAccountHandle(item);
    counts[handle] = (counts[handle] || 0) + 1;
    assert.ok(counts[handle] <= 3, handle);
  }
  assert.equal(counts.statnews, 3);
  assert.ok(selected.some((item) => item.id === "bio-url"));
  assert.ok(selected.some((item) => item.id === "topol-doi"));
  assert.equal(selected.some((item) => item.id === "stat-4" || item.id === "stat-5" || item.id === "stat-6"), false);
  assert.equal(sameXEvent(overflow, byUrl), true);
  assert.ok(headlineJaccardSafe(overflow.headline, byText.headline) >= 0.6);
  const picks = xPickItems({
    enabled: true,
    picks: [1, 2, 3, 4].map((n) => ({
      handle: "statnews",
      postUrl: `https://x.com/statnews/status/${n}`,
      linkedUrl: n === 4 ? "https://www.statnews.com/shared/?utm_source=x" : `https://www.statnews.com/s/${n}`,
      postedAt: "2026-11-20",
      headline: n === 4 ? "Shared pancreatic cancer readout looks strong" : `Distinct statnews headline number ${n} today`,
      blurb: "A separate note about the study.",
      kind: "other",
      blurbSource: "page-description",
    })).concat({
      handle: "biospace",
      postUrl: "https://x.com/biospace/status/9",
      linkedUrl: "https://statnews.com/shared",
      postedAt: "2026-11-20",
      headline: "Shared pancreatic cancer readout looks strong",
      blurb: "Another desk notes the same study.",
      kind: "other",
      blurbSource: "page-description",
    }),
  });
  assert.equal(picks.length, 5);
  const built = buildHeadlines({ candidates: picks, today: "2026-11-22", feedback: new Map(), sources: [] });
  const builtCounts = {};
  for (const item of built.items) {
    const handle = xAccountHandle({ ...item, scout_source: "x" });
    builtCounts[handle] = (builtCounts[handle] || 0) + 1;
  }
  assert.deepEqual(builtCounts, { statnews: 3, biospace: 1 });
  assert.equal(built.items.some((item) => item.x_handle || item.doi), false);

  const bio = (n, score) => ({
    id: `bio-${n}`,
    headline: `Biospace exclusive story ${n}`,
    blurb: "A note.",
    source_url: `https://x.com/biospace/status/${n}`,
    linked_url: `https://www.biospace.com/story-${n}`,
    published_at: "2026-11-23",
    significance: score,
    scout_source: "x",
    rule: "x-pick",
    x_handle: "biospace",
    drop: false,
  });
  const refill = (n, score) => ({
    id: `refill-stat-${n}`,
    headline: `Statnews exclusive story ${n}`,
    blurb: "A note.",
    source_url: `https://x.com/statnews/status/10${n}`,
    linked_url: `https://www.statnews.com/exclusive-${n}`,
    published_at: "2026-11-22",
    significance: score,
    scout_source: "x",
    rule: "x-pick",
    x_handle: "statnews",
    drop: false,
  });
  const refilled = selectHeadlines([
    bio(1, 100), bio(2, 99), bio(3, 98), bio(4, 97), bio(5, 96), bio(6, 95), bio(7, 94),
    refill(1, 80), refill(2, 79), refill(3, 78), refill(4, 77),
  ]);
  const refillCounts = {};
  for (const item of refilled) {
    const handle = xAccountHandle(item);
    if (!handle) continue;
    refillCounts[handle] = (refillCounts[handle] || 0) + 1;
    assert.ok(refillCounts[handle] <= 3, handle);
  }
  assert.equal(refillCounts.biospace, 3);
  assert.equal(refillCounts.statnews, 3);
  assert.equal(refilled.filter((item) => item.scout_source === "x").length, 6);
});

function headlineJaccardSafe(left, right) {
  const tokens = (value) => new Set(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length >= 2));
  const a = tokens(left);
  const b = tokens(right);
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

test("canonical URL dedupe keeps the higher-scoring copy", () => {
  assert.equal(canonUrl("HTTPS://WWW.Doi.ORG/10.1038/ABC/?utm_source=x&utm_medium=social#frag"), "https://doi.org/10.1038/abc");
  assert.equal(canonUrl("https://dx.doi.org/10.1038/ABC/"), "https://doi.org/10.1038/abc");
  assert.equal(canonUrl("https://Example.com/Story/?id=1&utm_campaign=a"), "https://example.com/Story?id=1");
  const items = [
    { id: "paper", significance: 80, source_url: "https://doi.org/10.1038/ABC", scout_source: "europepmc" },
    { id: "x-lower", significance: 64, source_url: "https://x.com/EricTopol/status/1", linked_url: "https://www.doi.org/10.1038/abc?utm_source=x#a", scout_source: "x" },
    { id: "x-higher", significance: 90, source_url: "https://x.com/NIH/status/2", linked_url: "https://www.nih.gov/news/keep?utm_medium=social", scout_source: "x" },
    { id: "nih", significance: 60, source_url: "https://nih.gov/news/keep/", scout_source: "nih-news" },
    { id: "unique", significance: 50, source_url: "https://example.com/only", scout_source: "news" },
  ];
  assert.deepEqual(dedupeByCanonUrl(items).map((item) => item.id).sort(), ["paper", "unique", "x-higher"]);
});

test("disabled x picks add nothing and a valid pick is capped", () => {
  assert.deepEqual(xPickItems({ enabled: false, picks: [{ postUrl: "https://x.com/US_FDA/status/1", handle: "US_FDA", postedAt: "2026-11-01", linkedUrl: "https://www.fda.gov/news", linkedTitle: "Notice", kind: "approval", headline: "FDA note", blurb: "A notice." }] }), []);
  const badHost = xPickItems({ enabled: true, picks: [{ postUrl: "https://x.com/US_FDA/status/1", handle: "US_FDA", postedAt: "2026-11-01", linkedUrl: "https://example.com/story", kind: "other", headline: "Off site", blurb: "Not a primary source." }] });
  assert.equal(badHost.length, 0);
  const duplicate = xPickItems({
    enabled: true,
    picks: [{ postUrl: "https://x.com/NIH/status/9", handle: "NIH", org: "NIH", postedAt: "2026-11-02", linkedUrl: "https://www.nih.gov/news/example", linkedTitle: "Grant", kind: "other", headline: "NIH posts a study page", blurb: "The post points at the study." }],
  }, ["https://nih.gov/news/example"]);
  assert.equal(duplicate.length, 0);
  const kept = xPickItems({
    enabled: true,
    picks: [{ postUrl: "https://x.com/GoogleDeepMind/status/42", handle: "GoogleDeepMind", org: "Google DeepMind", postedAt: "2026-11-03", linkedUrl: "https://deepmind.google/blog/example", linkedTitle: "Model", kind: "model", headline: "DeepMind links a model card", blurb: "The post points at the model card." }],
  });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].source_url, "https://x.com/GoogleDeepMind/status/42");
  assert.match(kept[0].blurb, /https:\/\/deepmind\.google\/blog\/example/);
  assert.equal(kept[0].scout_source, "x");
  assert.equal(hostAllowed("https://ai.nejm.org/doi/full/10.1056/example"), true);
  assert.equal(hostAllowed("https://www.thelancet.com/journals/lancet/article/PIIS0140"), true);
  for (const host of ["endpoints.news", "endpts.com", "biospace.com", "statnews.com", "fiercebiotech.com", "biopharmadive.com", "spectrum.ieee.org", "alzforum.org", "brightfocus.org", "firstwordhealthtech.com"]) {
    assert.equal(hostAllowed(`https://${host}/story`), true, host);
    assert.equal(hostAllowed(`https://www.${host}/story`), true, `www.${host}`);
    assert.equal(hostAllowed(`https://news.${host}/story`), true, `news.${host}`);
  }
  assert.equal(hostAllowed("https://fwhealthtech.com/story"), false);
  assert.equal(hostAllowed("https://www.fwhealthtech.com/story"), false);
  const journal = xPickItems({
    enabled: true,
    picks: [{
      postUrl: "https://x.com/EricTopol/status/77",
      handle: "EricTopol",
      org: "Scripps",
      postedAt: "2026-11-04",
      linkedUrl: "https://ai.nejm.org/doi/full/10.1056/AIoa2500123",
      linkedTitle: "A NEJM AI paper",
      kind: "paper",
      doi: "10.1056/AIoa2500123",
      blurbSource: "abstract",
      headline: "NEJM AI posts a methods paper",
      blurb: "The note points at a methods paper in NEJM AI.",
    }],
  });
  assert.equal(journal.length, 1);
  assert.equal(journal[0].doi, "10.1056/AIoa2500123");
  assert.equal(journal[0].blurb_source, "abstract");
  const tooLong = "word ".repeat(31).trim();
  assert.equal(xPickItems({ enabled: true, picks: [{ postUrl: "https://x.com/NIH/status/3", handle: "NIH", postedAt: "2026-11-01", linkedUrl: "https://www.nih.gov/news/long", kind: "other", headline: "A short NIH note", blurb: tooLong }] }).length, 0);
  assert.equal(xPickItems({ enabled: true, picks: [{ postUrl: "https://x.com/NIH/status/4", handle: "NIH", postedAt: "2026-11-01", linkedUrl: "https://www.nih.gov/news/echo", kind: "other", headline: "NIH describes a new study design", blurb: "NIH describes a new study design today" }] }).length, 0);
  assert.equal(xPickItems({ enabled: true, picks: [{ postUrl: "https://x.com/NIH/status/5", handle: "NIH", postedAt: "2026-11-01", linkedUrl: "https://www.nih.gov/news/post", kind: "other", headline: "NIH links a page", blurb: "The note points at the study page.", postText: "The note points at the study page in full." }] }).length, 0);
  assert.equal(xPickItems({ enabled: true, picks: [{ postUrl: "https://x.com/NIH/status/6", handle: "NIH", postedAt: "2026-11-01", linkedUrl: "https://www.nih.gov/news/text", kind: "other", headline: "NIH links a page", blurb: "The note points at the study page.", text: "stored post" }] }).length, 0);
  assert.equal(xPickItems({ enabled: true, picks: [{ postUrl: "https://x.com/NIH/status/8", handle: "NIH", postedAt: "2026-11-01", linkedUrl: "https://www.thelancet.com/journals/lancet/article/x", kind: "paper", headline: "Lancet page", blurb: "Bad source label.", blurbSource: "tweet" }] }).length, 0);
  const items = [];
  for (let i = 0; i < 20; i++) items.push({ id: `x${i}`, scout_source: "x", rule: "x-pick", significance: 90, drop: false, published_at: "2026-11-12" });
  for (const source of ["europepmc", "biorxiv", "medrxiv", "bcf-papers", "nih-reporter", "sec-edgar-8k", "fda-press", "deepmind", "openai-news", "clinicaltrials-calendar", "bcf-ai-discovery", "nvidia-blog"]) {
    for (let i = 0; i < 6; i++) items.push({ id: `${source}-${i}`, scout_source: source, rule: "paper-journal", significance: 80, drop: false, published_at: "2026-11-10" });
  }
  const selected = selectHeadlines(items);
  const xCount = selected.filter((item) => item.scout_source === "x").length;
  assert.ok(xCount <= Math.max(1, Math.floor(RULES.globalCap * RULES.sourceShare)), String(xCount));
  const page = {
    title: "File:Asundexian.svg",
    categories: [{ title: "Category:Chemical structures" }],
    imageinfo: [{
      mime: "image/svg+xml",
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Asundexian.svg",
      width: 512,
      height: 256,
      thumbwidth: 400,
      thumbheight: 200,
      extmetadata: {
        LicenseShortName: { value: "CC0" },
        LicenseUrl: { value: "https://creativecommons.org/publicdomain/zero/1.0/" },
        Artist: { value: "<a href=\"https://commons.wikimedia.org/wiki/User:Example\">Example</a>" },
        ImageDescription: { value: "Skeletal formula of asundexian." },
      },
    }],
  };
  const built = commonsImage(page, "asundexian");
  assert.ok(built);
  assert.match(built.src, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\//);
  assert.equal(built.credit, "Example");
  assert.equal(licenceOk(built.licence), true);
  assert.equal(commonsImage({ ...page, categories: [{ title: "Category:Logos" }] }, "asundexian"), null);
  assert.equal(licenceOk("Non-free"), false);
  assert.equal(licenceOk("PD-US"), true);
  assert.match(uploadThumb(page.imageinfo[0].url), /400px-Asundexian\.svg\.png$/);
});

test("an X embed that does not render shows the stored text, author, and a View on X link", () => {
  const href = "https://x.com/EricTopol/status/2122801525672317145";
  assert.equal(tweetAuthor({ source_url: href }), "@EricTopol");
  assert.equal(tweetAuthor({ source_url: "https://twitter.com/IsomorphicLabs/status/99" }), "@IsomorphicLabs");
  assert.equal(tweetAuthor({ source_url: "https://www.fda.gov/news" }), "");
  assert.equal(tweetFallbackText({ blurb: "Stored note.", headline: "Title" }), "Stored note.");
  assert.equal(tweetFallbackText({ headline: "Title only" }), "Title only");
  assert.equal(tweetFallbackText({}), "");
  assert.ok(TWEET_RENDER_MS >= 6000 && TWEET_RENDER_MS <= 8000);
  const render = fs.readFileSync(path.join(root, "headlines", "render.js"), "utf8");
  assert.match(render, /class: "tweet-card"/);
  assert.match(render, /View on X/);
  assert.match(render, /script\.onerror/);
  assert.match(render, /twttr\.ready/);
  assert.match(render, /blockquote/);
  const css = fs.readFileSync(path.join(root, "headlines", "headlines.css"), "utf8");
  assert.match(css, /max-width:\s*100%/);
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(render, /og:image|link-preview/);
});

test("X posts load when scrolled near and the initial page has no third-party script", () => {
  const html = fs.readFileSync(path.join(root, "headlines", "index.html"), "utf8");
  const render = fs.readFileSync(path.join(root, "headlines", "render.js"), "utf8");
  const pageJs = fs.readFileSync(path.join(root, "headlines", "headlines.js"), "utf8");
  const populate = fs.readFileSync(path.join(root, "scripts", "headlines", "populate.mjs"), "utf8");
  assert.doesNotMatch(html, /content="noindex"/);
  assert.match(html, /rel="canonical" href="https:\/\/biocat\.ai\/headlines\/"/);
  const reviewHtml = fs.readFileSync(path.join(root, "headlines", "review", "index.html"), "utf8");
  assert.match(reviewHtml, /content="noindex"/);
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert.match(robots, /Disallow: \/headlines\/review\//);
  assert.doesNotMatch(robots, /Disallow: \/headlines\/\s/);
  assert.match(sitemap, /<loc>https:\/\/biocat\.ai\/headlines\/<\/loc>/);
  assert.doesNotMatch(sitemap, /headlines\/review/);
  assert.doesNotMatch(html, /widgets\.js/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(populate, /attachLinkPreviews|og:image|og-url-cache|link-preview/);
  assert.doesNotMatch(render, /link-preview|og:image/);
  assert.match(render, /new IntersectionObserver/);
  assert.match(render, /rootMargin:\s*"200px"/);
  assert.match(render, /twttr\.widgets\.load/);
  assert.match(pageJs, /watchTweetSlots\(main\)/);
  const fallback = render.slice(render.indexOf("IntersectionObserver"));
  assert.match(fallback, /Show post/);
  const picks = JSON.parse(fs.readFileSync(path.join(root, "data", "x_picks.json"), "utf8"));
  assert.equal(picks.schema, "biocat-x-picks/1");
  assert.equal(typeof picks.enabled, "boolean");
  assert.ok(Array.isArray(picks.picks));
  assert.ok(picks.picks.length >= 1);
  for (const pick of picks.picks) {
    assert.match(xStatusUrl({ source_url: pick.postUrl, scout_source: "x" }), /\/status\/\d+/);
  }
  assert.equal(xStatusUrl({ source_url: "https://www.fda.gov/news", scout_source: "fda-press" }), "");
});

test("tracked X account search matches names and handles", () => {
  const sample = accountsFromAllowlist({
    x: {
      org_accounts: [{ handle: "GoogleDeepMind", display_name: "Google DeepMind" }],
      researcher_handles: [
        { handle: "bryan_johnson", display_name: "Bryan Johnson" },
        { handle: "@_katetolo", display_name: "Kate Tolo" },
        { handle: "demishassabis", display_name: "Demis Hassabis" },
      ],
    },
  });
  assert.deepEqual(matchTrackedAccounts(sample, "bryan johnson").map((account) => account.handle), ["bryan_johnson"]);
  assert.deepEqual(matchTrackedAccounts(sample, "@Bryan_Johnson").map((account) => account.handle), ["bryan_johnson"]);
  assert.deepEqual(matchTrackedAccounts(sample, "_katetolo").map((account) => account.handle), ["_katetolo"]);
  assert.deepEqual(matchTrackedAccounts(sample, "demis hassabis").map((account) => account.handle), ["demishassabis"]);
  assert.deepEqual(matchTrackedAccounts(sample, "deep mind").map((account) => account.handle), ["GoogleDeepMind"]);
  assert.equal(matchTrackedAccounts(sample, "q").length, 0);
  const bryan = trackedSearchRows(sample, "bryan johnson")[0];
  assert.equal(bryan.type, "Tracked X account");
  assert.equal(bryan.title, "Bryan Johnson @bryan_johnson");
  assert.equal(bryan.href, "https://x.com/bryan_johnson");

  const html = fs.readFileSync(path.join(root, "headlines", "index.html"), "utf8");
  const pageJs = fs.readFileSync(path.join(root, "headlines", "headlines.js"), "utf8");
  assert.match(html, /id="tracked-accounts"/);
  assert.match(pageJs, /renderTrackedAccounts/);
  const live = accountsFromAllowlist(JSON.parse(fs.readFileSync(path.join(root, "data", "ai-discovery-allowlist.json"), "utf8")));
  for (const handle of ["bryan_johnson", "_katetolo", "demishassabis"]) {
    const account = live.find((row) => row.handle === handle);
    assert.ok(account, handle);
    assert.equal(account.href, `https://x.com/${handle}`);
    assert.equal(account.href.includes("pbs.twimg"), false);
  }
  assert.ok(matchTrackedAccounts(live, "bryan johnson").some((account) => account.handle === "bryan_johnson"));
  assert.ok(matchTrackedAccounts(live, "_katetolo").some((account) => account.handle === "_katetolo"));
  assert.ok(matchTrackedAccounts(live, "demis hassabis").some((account) => account.handle === "demishassabis"));
  const endpts = matchTrackedAccounts(live, "endpts");
  assert.deepEqual(endpts.map((account) => account.handle), ["endpts"]);
  assert.equal(endpts[0].href, "https://x.com/endpts");
  assert.match(trackedSearchRows(live, "endpts")[0].title, /@endpts/);
});

test("trial dates keep a day, or name the month and year", () => {
  assert.equal(humanDate("2026-11-26"), "Nov 26");
  assert.equal(humanDate("2026-11-01"), "Nov 1");
  assert.equal(humanDate("2026-11"), "in November 2026");
  assert.equal(humanDate("2026-02"), "in February 2026");
  assert.equal(humanDate("2026-13"), "");
  assert.equal(humanDate("2026-11-00"), "");
  assert.equal(humanDate("2026-11-32"), "");
  assert.equal(humanDate("soon"), "");
  assert.equal(humanDate(""), "");
  const facts = {
    phase3: true,
    title: "Study of MT1013 for the Treatment of Patients With Secondary Hyperparathyroidism",
    condition: "Secondary Hyperparathyroidism, Chronic Kidney Disease",
    sponsor: "Shaanxi Micot Pharmaceutical Technology Co., Ltd.",
  };
  const withDay = trialCopy("clinicaltrials-calendar:NCT07122401:2026-11-26", { ...facts, date: "2026-11-26" });
  assert.match(withDay.headline, /\bNov 26\b/);
  assert.doesNotMatch(withDay.headline, /November/);
  assert.ok(wordCount(withDay.headline) <= HEADLINE_WORD_MAX, withDay.headline);
  const monthOnly = trialCopy("month-only", { ...facts, date: "2026-11" });
  assert.match(monthOnly.headline, /\bin November 2026\b/);
  assert.doesNotMatch(monthOnly.headline, /\bNov \d/);
  assert.ok(wordCount(monthOnly.headline) <= HEADLINE_WORD_MAX, monthOnly.headline);
  const missing = trialCopy("missing-date", { ...facts, date: "soon" });
  assert.doesNotMatch(missing.headline, /reaches primary completion/);
  assert.doesNotMatch(missing.headline, /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
  assert.doesNotMatch(missing.headline, /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/);
  assert.ok(wordCount(missing.headline) <= HEADLINE_WORD_MAX, missing.headline);
});

test("tracked accounts stay inline and separators follow visible entries", () => {
  const css = fs.readFileSync(path.join(root, "headlines", "headlines.css"), "utf8");
  const listRule = css.slice(css.indexOf(".tracked-list {"), css.indexOf(".tracked-list li"));
  assert.match(listRule, /font-size:\s*14px/);
  assert.doesNotMatch(listRule, /display:\s*grid/);
  assert.match(css, /\.tracked-list li\s*\{[^}]*display:\s*inline-block[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.tracked-list li\[hidden\]\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.tracked-list li:not\(\[hidden\]\):has\(~ li:not\(\[hidden\]\)\)::after\s*\{[^}]*content:\s*"·"[^}]*margin:\s*0 0\.35em/s);
  assert.match(css, /\.tracked-list a\s*\{\s*font-weight:\s*400/);
  assert.doesNotMatch(css, /\.tracked-list a\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /\.tracked summary::before\s*\{[^}]*content:\s*"▸"/s);
  assert.match(css, /\.tracked details\[open\] > summary::before\s*\{[^}]*content:\s*"▾"/s);
  assert.match(css, /\.tracked summary\s*\{[^}]*min-height:\s*44px/s);
  const html = fs.readFileSync(path.join(root, "headlines", "index.html"), "utf8");
  assert.doesNotMatch(html, /<details open>/);
  assert.match(html, /<p class="tracked-jump"><a href="#tracked-accounts">Tracked X accounts ↓<\/a><\/p>/);
  assert.equal(trackedSummaryText(52), "Tracked X accounts (52)");
  assert.equal(trackedSummaryText(0), "Tracked X accounts");

  const accounts = [
    { handle: "GoogleDeepMind", display_name: "Google DeepMind", href: "https://x.com/GoogleDeepMind" },
    { handle: "MSFTResearch", display_name: "Microsoft Research", href: "https://x.com/MSFTResearch" },
    { handle: "AIatMeta", display_name: "AI at Meta", href: "https://x.com/AIatMeta" },
    { handle: "bryan_johnson", display_name: "Bryan Johnson", href: "https://x.com/bryan_johnson" },
    { handle: "OpenAI", display_name: "OpenAI", href: "https://x.com/OpenAI" },
  ];
  const items = accounts.map((account) => ({
    hidden: false,
    textContent: `${account.display_name} @${account.handle}`,
  }));
  const section = {
    querySelector(selector) {
      if (selector === ".tracked-list") return { querySelectorAll: () => items };
      return null;
    },
  };
  const shown = applyTrackedAccountFilter(section, accounts, "ai");
  assert.deepEqual(shown.map((account) => account.handle), ["AIatMeta", "OpenAI"]);
  assert.deepEqual(items.map((item) => item.hidden), [true, true, false, true, false]);
  assert.equal(items.some((item) => item.textContent.includes("·")), false);
  applyTrackedAccountFilter(section, accounts, "aspirin");
  assert.deepEqual(items.map((item) => item.hidden), [false, false, false, false, false]);
  applyTrackedAccountFilter(section, accounts, "q");
  assert.ok(items.every((item) => item.hidden === false));
  const source = fs.readFileSync(path.join(root, "headlines", "tracked-accounts.js"), "utf8");
  const render = source.slice(source.indexOf("export function renderTrackedAccounts"));
  assert.match(render, /link\.href = account\.href/);
  assert.doesNotMatch(render, /·/);
  assert.match(render, /setTrackedSummary/);
});

test("tracked accounts collapse until a jump, hash, or matching search opens them", () => {
  const summary = { textContent: "", addEventListener() {} };
  const details = { open: false, dataset: {} };
  const items = [
    { hidden: false, textContent: "Google DeepMind @GoogleDeepMind" },
    { hidden: false, textContent: "AI at Meta @AIatMeta" },
  ];
  const accounts = [
    { handle: "GoogleDeepMind", display_name: "Google DeepMind", href: "https://x.com/GoogleDeepMind" },
    { handle: "AIatMeta", display_name: "AI at Meta", href: "https://x.com/AIatMeta" },
  ];
  const section = {
    querySelector(selector) {
      if (selector === "summary") return summary;
      if (selector === "details") return details;
      if (selector === ".tracked-list") return { querySelectorAll: () => items };
      return null;
    },
  };
  assert.equal(setTrackedSummary(section, items.length), "Tracked X accounts (2)");
  assert.equal(summary.textContent, "Tracked X accounts (2)");
  const listeners = {};
  const win = {
    location: { hash: "" },
    addEventListener(type, fn) { listeners[type] = fn; },
  };
  bindTrackedDisclosure(section, win);
  assert.equal(details.dataset.userOpen, "false");
  assert.equal(details.open, false);
  win.location.hash = "#tracked-accounts";
  listeners.hashchange();
  assert.equal(details.open, true);
  assert.equal(details.dataset.userOpen, "true");
  details.open = false;
  rememberTrackedToggle(details);
  assert.equal(details.dataset.userOpen, "true");
  applyTrackedAccountFilter(section, accounts, "ai");
  assert.equal(details.open, true);
  assert.equal(details.dataset.userOpen, "true");
  applyTrackedAccountFilter(section, accounts, "");
  assert.equal(details.open, true);
  details.open = false;
  details.dataset.userOpen = "false";
  applyTrackedAccountFilter(section, accounts, "ai");
  assert.equal(details.open, true);
  assert.equal(details.dataset.userOpen, "false");
  applyTrackedAccountFilter(section, accounts, "");
  assert.equal(details.open, false);
  assert.equal(markTrackedOpen(section), true);
  assert.equal(details.open, true);
  assert.equal(details.dataset.userOpen, "true");
});

const LEAD_NOW = new Date("2026-11-24T12:00:00.000Z");

function leadHoursAgo(hours, now = LEAD_NOW) {
  return new Date(now.getTime() - hours * 36e5).toISOString();
}

function leadFixture(over = {}) {
  return {
    id: "lead-item",
    headline: "Regulator approves a distinct example medicine",
    blurb: "One sentence.",
    source_url: "https://example.com/lead-item",
    source_type: "regulator",
    source_name: "FDA",
    published_at: leadHoursAgo(1),
    significance: 99,
    tier: 5,
    scout_source: "openfda-drugsfda",
    doi: "10.1000/lead-item",
    ...over,
  };
}

test("lead constants match the tier-5 floor and the workflow commits lead state", () => {
  assert.equal(LEAD_WORTHY_FLOOR, RULES.tiers[0].min);
  assert.equal(LEAD_MAX_ITEM_HOURS, 12);
  assert.equal(LEAD_EVENT_WINDOW_HOURS, 24);
  assert.equal(BREAKING_MAX_BOOST, 0.35);
  assert.equal(BREAKING_FULL_HOURS, 2);
  assert.equal(BREAKING_ZERO_HOURS, 12);
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "headlines.yml"), "utf8");
  assert.match(workflow, /git add data\/headlines\.json data\/lead_state\.json index\.html headlines\/index\.html/);
  assert.deepEqual(readLeadState(path.join(os.tmpdir(), "missing-lead-state.json")), { schema: "biocat-lead-state/1", leads: [] });
});

test("a lead expires after 12 hours and the next item takes the slot", () => {
  const incumbent = leadFixture();
  const next = leadFixture({
    id: "next-item",
    headline: "Separate company starts a different late study",
    source_url: "https://example.com/next-item",
    doi: "10.1000/next-item",
    published_at: leadHoursAgo(8),
    significance: 92,
  });
  const first = assignLead([incumbent, next], {}, LEAD_NOW);
  assert.equal(first.items[0].id, "lead-item");
  assert.equal(first.state.leads[0].canonicalUrl, "https://example.com/lead-item");
  const still = assignLead(first.items, first.state, new Date(LEAD_NOW.getTime() + 11 * 36e5));
  assert.equal(still.items[0].id, "lead-item");
  assert.equal(still.state.leads.find((row) => row.itemId === "lead-item").firstLeadAt, first.state.leads[0].firstLeadAt);
  const expired = assignLead(first.items, first.state, new Date(LEAD_NOW.getTime() + 12 * 36e5));
  assert.equal(expired.items[0].id, "next-item");
  assert.equal(expired.items[1].id, "lead-item");
  assert.equal(expired.items[1].significance, 99);
  assert.equal(expired.items[1].tier, 5);
  assert.equal(expired.state.leads.some((row) => row.itemId === "lead-item" && row.firstLeadAt === first.state.leads[0].firstLeadAt), true);
});

test("a newer lead-worthy item replaces the same event inside 24 hours", () => {
  const incumbent = leadFixture({ published_at: leadHoursAgo(6) });
  const other = leadFixture({
    id: "other-event",
    headline: "Unrelated advisory meeting is scheduled",
    source_url: "https://example.com/other-event",
    doi: "10.1000/other-event",
    published_at: leadHoursAgo(7),
    significance: 90,
  });
  const first = assignLead([incumbent, other], {}, LEAD_NOW);
  assert.equal(first.items[0].id, "lead-item");
  const update = leadFixture({
    id: "update-item",
    headline: "Follow-up story on the same approval",
    source_url: "https://example.com/update-item",
    doi: "10.1000/lead-item",
    published_at: leadHoursAgo(1),
    significance: 90,
  });
  const replaced = assignLead([update, ...first.items], first.state, new Date(LEAD_NOW.getTime() + 36e5));
  assert.equal(replaced.items[0].id, "update-item");
  assert.equal(replaced.state.leads.find((row) => row.itemId === "update-item").eventKey, first.state.leads[0].eventKey);
  const record = replaced.state.leads.find((row) => row.itemId === "update-item");
  assert.equal(record.eventFirstLeadAt, first.state.leads[0].eventFirstLeadAt);
  assert.notEqual(record.firstLeadAt, first.state.leads[0].firstLeadAt);
  assert.ok(replaced.items.some((item) => item.id === "lead-item"));
});

test("a low-significance update does not replace the lead", () => {
  const incumbent = leadFixture();
  const first = assignLead([incumbent], {}, LEAD_NOW);
  const weak = leadFixture({
    id: "weak-update",
    headline: "Brief mention of the same approval",
    source_url: "https://example.com/weak-update",
    doi: "10.1000/lead-item",
    published_at: leadHoursAgo(0.2),
    significance: 70,
    tier: 3,
  });
  const kept = assignLead([weak, ...first.items], first.state, new Date(LEAD_NOW.getTime() + 36e5));
  assert.equal(kept.items[0].id, "lead-item");
  assert.equal(kept.items[0].significance, 99);
  assert.equal(kept.items[0].tier, 5);
  assert.equal(kept.state.leads.find((row) => row.itemId === "lead-item").firstLeadAt, first.state.leads[0].firstLeadAt);
  assert.equal(kept.state.leads.some((row) => row.itemId === "weak-update"), false);
});

test("an event cannot lead again after 24 hours", () => {
  const incumbent = leadFixture();
  const first = assignLead([incumbent], {}, LEAD_NOW);
  const lockedNow = new Date(LEAD_NOW.getTime() + 24 * 36e5);
  const late = leadFixture({
    id: "late-update",
    headline: "Overnight story on the same approval",
    source_url: "https://example.com/late-update",
    doi: "10.1000/lead-item",
    published_at: leadHoursAgo(1, lockedNow),
    significance: 100,
  });
  const outsider = leadFixture({
    id: "outside-event",
    headline: "Different agency clears a separate product",
    source_url: "https://example.com/outside-event",
    doi: "10.1000/outside-event",
    published_at: leadHoursAgo(4, lockedNow),
    significance: 89,
  });
  const locked = assignLead([late, outsider, incumbent], first.state, lockedNow);
  assert.equal(locked.items[0].id, "outside-event");
  assert.ok(locked.items.some((item) => item.id === "late-update"));
  assert.ok(locked.items.some((item) => item.id === "lead-item"));
  assert.equal(locked.state.leads.some((row) => row.itemId === "late-update" || (row.itemId === "lead-item" && row.firstLeadAt !== first.state.leads[0].firstLeadAt)), false);
});

test("breaking boost decays from 2 hours to 12 and skips unknown times", () => {
  assert.equal(breakingBoost(leadHoursAgo(0), LEAD_NOW), 0.35);
  assert.equal(breakingBoost(leadHoursAgo(2), LEAD_NOW), 0.35);
  assert.equal(breakingBoost(leadHoursAgo(7), LEAD_NOW), 0.175);
  assert.equal(breakingBoost(leadHoursAgo(12), LEAD_NOW), 0);
  assert.equal(breakingBoost(leadHoursAgo(20), LEAD_NOW), 0);
  assert.equal(breakingBoost("2026-11-24", LEAD_NOW), 0);
  assert.equal(breakingBoost("", LEAD_NOW), 0);
  const freshWorthy = leadFixture({ id: "fresh-worthy", published_at: leadHoursAgo(1), significance: 90, source_url: "https://example.com/fresh-worthy", doi: "10.1000/fresh-worthy", headline: "Fresh top-tier approval" });
  const older = leadFixture({ id: "older-strong", published_at: leadHoursAgo(20), significance: 96, source_url: "https://example.com/older-strong", doi: "10.1000/older-strong", headline: "Older strong approval" });
  assert.equal(leadScore(freshWorthy, LEAD_NOW), 90 * 1.35);
  assert.equal(leadScore(older, LEAD_NOW), 96);
  const ranked = assignLead([older, freshWorthy], {}, LEAD_NOW);
  assert.equal(ranked.items[0].id, "fresh-worthy");
  assert.equal(ranked.items[0].tier, 5);
  assert.equal(ranked.items[1].significance, 96);
});

test("a fresh low-significance item cannot outrank a much stronger older item", () => {
  const fresh = leadFixture({
    id: "fresh-low",
    headline: "Small conference aside",
    source_url: "https://example.com/fresh-low",
    doi: "10.1000/fresh-low",
    published_at: leadHoursAgo(0.5),
    significance: 70,
    tier: 3,
  });
  const strong = leadFixture({
    id: "strong-old",
    headline: "Major approval of a different medicine",
    source_url: "https://example.com/strong-old",
    doi: "10.1000/strong-old",
    published_at: leadHoursAgo(20),
    significance: 96,
    tier: 5,
  });
  assert.equal(leadScore(fresh, LEAD_NOW), 70);
  assert.ok(leadScore(strong, LEAD_NOW) > leadScore(fresh, LEAD_NOW));
  const placed = assignLead([fresh, strong], {}, LEAD_NOW);
  assert.equal(placed.items[0].id, "strong-old");
  assert.equal(placed.items[0].significance, 96);
  assert.equal(placed.items[0].tier, 5);
  assert.equal(placed.items[1].id, "fresh-low");
  assert.equal(placed.items[1].significance, 70);
  assert.equal(placed.items[1].tier, 3);
});

test("Searching stays hidden once a search result is shown", () => {
  assert.equal(searchStatusNote(0, { loading: true }), "Searching…");
  assert.equal(searchStatusNote(1, { loading: true }), "");
  assert.equal(searchStatusNote(2), "");
  assert.equal(searchStatusNote(0), "No results.");
  assert.equal(searchStatusNote(0, { failed: true }), "Search is unavailable.");
  assert.equal(searchStatusNote(1, { failed: true }), "");
});

