import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadFeedback } from "../feedback.mjs";
import { parseRobots, robotsDecision } from "../http.mjs";
import { buildHeadlines } from "../populate.mjs";
import { RULES, scoreItem, selectHeadlines, tierFor } from "../ranking.mjs";
import { SOURCES, adcomItems, crlItems, drugsfdaItems, emaItems, europePmcItems, orangeBookLoe, purpleBookItems } from "../sources.mjs";
import { assertFactual, factualViolation } from "../text.mjs";

const root = path.resolve(import.meta.dirname, "../../..");

test("homepage does not link to the headlines test", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.equal(html.includes("/headlines"), false);
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
  const unnamed = drugsfdaItems([{
    application_number: "NDA221291",
    sponsor_name: "BAYER HEALTHCARE",
    submissions: [{ submission_type: "ORIG", submission_number: "1", submission_status: "AP", submission_status_date: "20261109", submission_class_code: "TYPE 1", submission_class_code_description: "Type 1 - New Molecular Entity", review_priority: "PRIORITY" }],
  }], "2026-11-17");
  assert.equal(unnamed[0].headline, "FDA records original approval of NDA 221291");
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
    { category: "Human", generic: "No", name_of_medicine: "Aumseqa", international_non_proprietary_name_common_name: "aumolertinib", ema_product_number: "EMEA/H/C/1", medicine_status: "Opinion", opinion_status: "Positive", opinion_adopted_date: "12/11/2026", medicine_url: "https://www.ema.europa.eu/en/medicines/human/EPAR/aumseqa", biosimilar: "No", conditional_approval: "No", orphan_medicine: "No" },
    { category: "Human", generic: "No", name_of_medicine: "Soliris", international_non_proprietary_name_common_name: "eculizumab", ema_product_number: "EMEA/H/C/2", medicine_status: "Authorised", opinion_status: "", marketing_authorisation_date: "20/06/2007", european_commission_decision_date: "16/11/2026", medicine_url: "https://www.ema.europa.eu/en/medicines/human/EPAR/soliris", biosimilar: "No", conditional_approval: "No", orphan_medicine: "Yes" },
    { category: "Human", generic: "Yes", name_of_medicine: "Generic", ema_product_number: "EMEA/H/C/3", medicine_status: "Authorised", marketing_authorisation_date: "12/11/2026", medicine_url: "https://www.ema.europa.eu/en/medicines/human/EPAR/generic" },
  ], "2026-11-17");
  assert.equal(items.length, 1);
  assert.equal(items[0].rule, "ema-opinion");
  assert.match(items[0].blurb, /European Medicines Agency/);
});

test("paper titles that assert efficacy are skipped", () => {
  const items = europePmcItems([
    { id: "1", source: "MED", doi: "10.1000/example", title: "Azetukalner in adults: the X-TOLE2 phase 3 randomized clinical trial", firstPublicationDate: "2026-11-09" },
    { id: "2", source: "MED", doi: "10.1000/claim", title: "Filgotinib effective across the axSpA spectrum in phase III trial", firstPublicationDate: "2026-11-01" },
  ]);
  assert.equal(items.length, 1);
  assert.match(items[0].source_url, /^https:\/\/doi\.org\/10\.1000\/example$/);
  assert.equal(items[0].blurb, "");
});

test("adcom keeps meeting notices and drops nominations", () => {
  const items = adcomItems([
    { title: "Microbiology Devices Panel of the Medical Devices Advisory Committee; Notice of Meeting", document_number: "2026-1", publication_date: "2026-09-16", dates: "The meeting will be held on November 19, 2026.", html_url: "https://www.federalregister.gov/documents/2026/09/16/2026-1/meeting" },
    { title: "Request for Nominations for Voting Members on a Public Advisory Committee; Tobacco Products Scientific Advisory Committee", document_number: "2026-2", publication_date: "2026-10-15", dates: "Nominations received on or before December 14, 2026.", html_url: "https://www.federalregister.gov/documents/2026/10/15/2026-2/nominations" },
  ], "2026-11-17");
  assert.equal(items.length, 1);
  assert.match(items[0].headline, /November 19, 2026|2026-11-19/);
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
