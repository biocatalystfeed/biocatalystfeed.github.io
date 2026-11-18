import assert from "node:assert/strict";
import test from "node:test";
import { cleanDrugNames, drugSlug, isPlaceholderDrug, tidyDrugLists } from "../drug-names.mjs";

test("placeholder arms and test drugs are dropped", () => {
  for (const name of [
    "Background Treatment",
    "Best Available Therapy",
    "matching dosage",
    "NA therapy",
    "standard treatment",
    "Supportive care measures",
    "Standard lymphodepletion",
    "Chemotherapy drug",
    "Silodosin Control",
    "Test Drug 1-1",
    "Test Drug 2-1 (GBP511",
    "Placebo",
    "Comparator",
    "Comparator Anvumetostat Test",
    "vehicle",
    "control",
  ]) {
    assert.deepEqual(cleanDrugNames(name), [], name);
  }
  assert.equal(isPlaceholderDrug("Test Drug 13"), true);
});

test("prefixes, suffixes, and stray brackets are cleaned", () => {
  assert.deepEqual(cleanDrugNames("Drug: Furmonertinib"), ["Furmonertinib"]);
  assert.deepEqual(cleanDrugNames("Drug:WD-890"), ["WD-890"]);
  assert.deepEqual(cleanDrugNames("Raloxifene - Study"), ["Raloxifene"]);
  assert.deepEqual(cleanDrugNames("Topotecan - study"), ["Topotecan"]);
  assert.deepEqual(cleanDrugNames("OMS906 study drug"), ["OMS906"]);
  assert.deepEqual(cleanDrugNames("LT3001 Drug Product"), ["LT3001"]);
  assert.deepEqual(cleanDrugNames("LT3001 Drug"), ["LT3001"]);
  assert.deepEqual(cleanDrugNames("nula-cel Drug Product"), ["nula-cel"]);
  assert.deepEqual(cleanDrugNames("[StroMed"), ["StroMed"]);
  assert.deepEqual(cleanDrugNames("CAS-1)"), ["CAS-1"]);
  assert.deepEqual(cleanDrugNames("MUC1)"), ["MUC1"]);
  assert.deepEqual(cleanDrugNames("platelet rich plasma ]"), ["platelet rich plasma"]);
});

test("packed drug lists split and ambiguous lists stay or drop", () => {
  assert.deepEqual(cleanDrugNames("carboplatin or cisplatin"), ["carboplatin", "cisplatin"]);
  assert.deepEqual(cleanDrugNames("Cisplatin or Carboplatin"), ["Cisplatin", "Carboplatin"]);
  assert.deepEqual(cleanDrugNames("AK112, Cadonilimab, nab-paclitaxel, gemcitabine"), ["AK112", "Cadonilimab", "nab-paclitaxel", "gemcitabine"]);
  assert.deepEqual(cleanDrugNames("SCIB1 or iSCIB1"), ["SCIB1", "iSCIB1"]);
  assert.deepEqual(cleanDrugNames("Fuzuloparib , Abiraterone acetate"), ["Fuzuloparib", "Abiraterone acetate"]);
  assert.deepEqual(cleanDrugNames("Platinum chemotherapy: carboplatin or cisplatin"), ["carboplatin", "cisplatin"]);
  assert.deepEqual(cleanDrugNames("Investigational Drug, MW-III"), ["MW-III"]);
  assert.deepEqual(cleanDrugNames("HB1801 (docetaxel, albumin-bound)"), ["HB1801 (docetaxel, albumin-bound)"]);
  assert.deepEqual(cleanDrugNames("Irinotecan OR Paclitaxel or Trifluridine/tipiracil（ FTD/TPI）"), ["Irinotecan", "Paclitaxel", "Trifluridine/tipiracil (FTD/TPI)"]);
  assert.deepEqual(cleanDrugNames("Background Chemotherapy"), []);
  assert.deepEqual(cleanDrugNames("Apraclonidine Ophthalmic , 0.125% Unit Preservative Free"), ["Apraclonidine Ophthalmic, 0.125% Unit Preservative Free"]);
  assert.deepEqual(drugSlug("Furmonertinib"), "furmonertinib");
  assert.deepEqual(drugSlug("WD-890"), "wd-890");
  assert.deepEqual(drugSlug("nab-paclitaxel"), "nab-paclitaxel");
});

test("drug-list cleanup leaves CSS selectors alone", () => {
  const css = "<style>.f input,.f select{padding:6px}</style>";
  assert.equal(tidyDrugLists(css), css);
  assert.equal(
    tidyDrugLists("<p>Drugs: <a href=\"a/\">A</a>, .</p>"),
    "<p>Drugs: <a href=\"a/\">A</a>.</p>",
  );
});
