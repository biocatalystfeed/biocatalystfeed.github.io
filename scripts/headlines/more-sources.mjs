import fs from "node:fs";
import path from "node:path";
import {
  arxivCopy,
  companyName,
  edgarIndexUrl,
  grantCopy,
  isoFromRfc822,
  modelCopy,
  OUTCOME_CLAIM,
  offTopicText,
  paperRecords,
  personName,
  preferHttps,
  preprintCopy,
  pressCopy,
  pressProduct,
  rssEntries,
  safeItems,
  secCopy,
  usd,
} from "./copy.mjs";
import { SEC_USER_AGENT } from "./http.mjs";
import { addDays, titleCaseCaps } from "./text.mjs";

const WORKER = "https://biocatalystfeed-api.biocatalystfeed.workers.dev";
const REPORTER = "https://api.reporter.nih.gov/v2/projects/search";
const FDA_PRESS = "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml";
const NIH_FEEDS = [
  "https://www.nih.gov/news-events/news-releases/rss.xml",
  "https://www.nih.gov/news-events/news-releases/rss",
];
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const DRUGISH = /\b(drug|biologic|approv|clinical|therap|vaccine|gene|cancer|oncolog|antibod|inhibitor|immunotherap|neurolog|rare disease|orphan|cell and gene)\b/i;
const FOODISH = /\b(food|infant formula|tobacco|cosmetic|restaurant|animal feed)\b/i;
const AI_TITLE = /\b(machine learning|deep learning|artificial intelligence|neural network|protein language|foundation model|transformer|generative|alphafold|large language)\b/i;
const BIO_CATS = /^(bioinformatics|genomics|synthetic biology|systems biology|pharmacology and toxicology|bioengineering)$/i;
const MED_CATS = /pharmacolog|genetic|genomic|oncolog|immunolog|infectious|endocrin|cardiovascular|hematolog|neurolog|gastroenterolog|nephrolog|dermatolog|respiratory|ophthalmolog|transplant|rheumatolog/;
const MED_TITLE = /\b(trial|phase|drug|therap|vaccine|antibod|gene|inhibitor|biologic|dose|patient|randomi[sz]ed)\b/i;
const GRANT_QUERIES = ["gene therapy", "cell therapy", "monoclonal antibody", "CRISPR", "drug discovery"];

function secGet(polite, url) {
  return polite.getBuffer(url, { userAgent: SEC_USER_AGENT, timeout: 60000 });
}

export function pressItems(entries, today, { scout, sourceName, rule, feed, sourceType }) {
  const from = addDays(today, -45);
  const rows = [];
  for (const entry of entries) {
    const published = isoFromRfc822(entry.date);
    if (!published || published < from || published > today) continue;
    const title = String(entry.title || "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    if (scout === "fda-press" && (!DRUGISH.test(`${title} ${entry.description || ""}`) || (FOODISH.test(title) && !DRUGISH.test(title)))) continue;
    const id = `${scout}:${entry.link || title}`;
    const copy = pressCopy(id, {
      title,
      product: pressProduct(entry.description || ""),
      description: entry.description || "",
      published,
      feed,
    });
    if (!copy) continue;
    rows.push({
      id,
      headline: copy.headline,
      blurb: copy.blurb,
      source_url: preferHttps(entry.link),
      source_type: sourceType,
      source_name: sourceName,
      published_at: published,
      scout_source: scout,
      rule,
      dedupe_key: `${scout}:${title.toLowerCase()}`,
    });
  }
  return safeItems(rows);
}

export function grantItems(records) {
  const rows = [];
  const seen = new Set();
  for (const record of records) {
    const idNum = record.appl_id;
    if (!idNum || seen.has(idNum)) continue;
    seen.add(idNum);
    const published = String(record.project_start_date || "").slice(0, 10);
    const title = String(record.project_title || "").replace(/\s+/g, " ").trim();
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(published)) continue;
    const org = titleCaseCaps((record.organization || {}).org_name || "");
    const agency = record.agency_ic_admin || {};
    const institute = agency.name ? `${agency.name}${agency.abbreviation ? ` (${agency.abbreviation})` : ""}` : "";
    const id = `nih-reporter:${idNum}`;
    const copy = grantCopy(id, {
      title,
      org,
      amount: usd(record.award_amount),
      activity: record.activity_code || "",
      institute,
      pi: personName(record.contact_pi_name || ""),
      projectNum: record.project_num || "",
      published,
    });
    if (!copy) continue;
    rows.push({
      id,
      headline: copy.headline,
      blurb: copy.blurb,
      source_url: `https://reporter.nih.gov/project-details/${idNum}`,
      source_type: "grant",
      source_name: "NIH RePORTER",
      published_at: published,
      scout_source: "nih-reporter",
      rule: "nih-grant",
      dedupe_key: `grant:${idNum}`,
    });
  }
  return safeItems(rows);
}

const ROUTINE_ITEMS = new Set(["2.02", "5.02", "5.03", "5.07", "9.01"]);

export function secItems(rows) {
  const built = [];
  for (const row of rows) {
    const id = `sec-edgar:${row.accession}`;
    const copy = secCopy(id, row);
    if (!copy) continue;
    const codes = row.itemCodes || [];
    const substantive = codes.filter((code) => code !== "9.01");
    const routine = substantive.length > 0 && substantive.every((code) => ROUTINE_ITEMS.has(code) || (code === "7.01" && substantive.includes("2.02")));
    const adjustments = routine ? ["routine-filing"] : [];
    built.push({
      id,
      headline: copy.headline,
      blurb: copy.blurb,
      source_url: row.url,
      source_type: "filing",
      source_name: "SEC EDGAR",
      published_at: row.date,
      scout_source: "sec-edgar-8k",
      rule: "sec-8k",
      adjustments,
      dedupe_key: `sec:${row.accession}`,
    });
  }
  return safeItems(built);
}

export function preprintItems(records, server) {
  const rows = [];
  for (const record of records) {
    const doi = String(record.doi || "");
    const title = String(record.title || "").replace(/\s+/g, " ").trim();
    const date = String(record.date || "").slice(0, 10);
    if (!doi || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (/withdrawn|retract/i.test(`${title} ${record.type || ""}`)) continue;
    if (offTopicText(title)) continue;
    if (OUTCOME_CLAIM.test(title)) continue;
    const category = String(record.category || "").replace(/\s+/g, " ").trim();
    const ai = AI_TITLE.test(title);
    const med = server === "medrxiv";
    if (med) {
      if (!ai && !(MED_CATS.test(category) && MED_TITLE.test(title))) continue;
    } else if (!ai && !BIO_CATS.test(category)) continue;
    const id = `${server}:${doi}`;
    const copy = preprintCopy(id, {
      title,
      server,
      date,
      category,
      version: record.version,
      license: record.license || "",
      institution: record.author_corresponding_institution || "",
      abstract: record.abstract || "",
    });
    if (!copy) continue;
    const host = med ? "www.medrxiv.org" : "www.biorxiv.org";
    rows.push({
      id,
      headline: copy.headline,
      blurb: copy.blurb,
      source_url: `https://${host}/content/${doi}`,
      source_type: "paper",
      source_name: med ? "medRxiv" : "bioRxiv",
      published_at: date,
      scout_source: server,
      rule: ai ? "paper-ai" : med ? "paper-medrxiv" : "paper-preprint",
      dedupe_key: `paper:${doi}`,
    });
  }
  return safeItems(rows);
}

export function aiDiscoveryItems(records, today) {
  const from = addDays(today, -45);
  const rows = [];
  const seen = new Set();
  for (const record of records || []) {
    const key = String(record.id || record.title || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const published = String(record.published || record.verified_as_of || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(published) || published < from || published > today) continue;
    const title = String(record.title || record.name || "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const urls = record.urls || {};
    const url = urls.paper || urls.blog || urls.weights || urls.page || urls.code || "";
    const curated = record.provenance === "curated-seed" || record.source_tier === "model_release";
    const tags = Array.isArray(record.tags) ? record.tags.join(", ") : "";
    if (!curated && !AI_TITLE.test(title) && !/q-bio|chem-ph|mtrl-sci|protein|genom|molecul|drug|enzyme|antibody|chemist/i.test(`${title} ${tags}`)) continue;
    const id = `bcf-ai:${key}`;
    const copy = curated
      ? modelCopy(id, {
        title,
        org: record.org || "the listed organization",
        license: record.license || "",
        base: record.base_model || "",
        params: record.params || "",
        verified: String(record.verified_as_of || "").slice(0, 10),
        disclaimer: record.disclaimer_class || "",
        summary: record.summary || "",
      })
      : arxivCopy(id, {
        title,
        authors: record.org || "",
        tags,
        date: published,
        disclaimer: record.disclaimer_class || "",
        summary: record.summary || "",
      });
    if (!copy) continue;
    rows.push({
      id,
      headline: copy.headline,
      blurb: copy.blurb,
      source_url: url,
      source_type: curated ? "model" : "paper",
      source_name: "BioCatalystFeed AI discovery",
      published_at: published,
      scout_source: "bcf-ai-discovery",
      rule: curated ? "ai-model" : "ai-preprint",
      dedupe_key: curated ? `model:${key}` : `paper:${url || key}`,
    });
  }
  return safeItems(rows);
}

async function fetchPress(ctx) {
  const buf = await ctx.polite.getBuffer(FDA_PRESS, { timeout: 60000 });
  if (!buf) throw new Error("FDA press release feed was not available");
  const items = pressItems(rssEntries(buf.toString("utf8")), ctx.today, {
    scout: "fda-press",
    sourceName: "FDA press releases",
    rule: "fda-press",
    feed: "FDA press release feed",
    sourceType: "news",
  });
  return {
    items,
    note: "FDA press-release RSS. U.S. government work, published for syndication. Items are kept when the title or description names a drug, biologic, vaccine, trial, or related topic. The headline is the agency's title. The blurb adds the publication date and, when the description names a product before an outcome clause, that product text.",
  };
}

async function fetchNihNews(ctx) {
  let last = "no NIH news feed responded";
  for (const url of NIH_FEEDS) {
    try {
      const buf = await ctx.polite.getBuffer(url, { timeout: 45000 });
      if (!buf) {
        last = `${url} returned 404`;
        continue;
      }
      const text = buf.toString("utf8");
      if (!/<rss|<feed|<item|<entry/i.test(text)) {
        last = `${url} did not return a feed`;
        continue;
      }
      const items = pressItems(rssEntries(text), ctx.today, {
        scout: "nih-news",
        sourceName: "NIH news releases",
        rule: "nih-news",
        feed: "NIH news release feed",
        sourceType: "news",
      });
      return {
        items,
        note: `NIH news-release RSS (${url}). NIH news releases are U.S. government works. Headlines are the release titles.`,
      };
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(last);
}

async function fetchGrants(ctx) {
  const from = addDays(ctx.today, -75);
  const merged = [];
  for (const search_text of GRANT_QUERIES) {
    const payload = await ctx.polite.postJson(REPORTER, {
      criteria: {
        project_start_date: { from_date: from, to_date: ctx.today },
        advanced_text_search: { operator: "and", search_field: "projecttitle", search_text },
      },
      include_fields: ["ApplId", "ProjectTitle", "Organization", "AwardAmount", "ActivityCode", "ProjectStartDate", "ContactPiName", "AgencyIcAdmin", "ProjectNum"],
      limit: 8,
      sort_field: "project_start_date",
      sort_order: "desc",
    });
    merged.push(...(payload?.results || []));
  }
  return {
    items: grantItems(merged),
    note: `NIH RePORTER project search for titles matching ${GRANT_QUERIES.join(", ")} with a project start from ${from} to ${ctx.today}. Award amounts and activity codes are the API fields. Abstracts are not copied. The API is the public RePORTER service; project pages are linked.`,
  };
}

function calendarTickers(root) {
  const file = path.join(root, "calendar", "calendar.json");
  const calendar = JSON.parse(fs.readFileSync(file, "utf8"));
  const tickers = new Set();
  for (const event of calendar.events || []) {
    const ticker = String(event.ticker || "").trim().toUpperCase();
    if (/^[A-Z][A-Z0-9.\-]{0,7}$/.test(ticker)) tickers.add(ticker);
  }
  return tickers;
}

function indexDays(today, count) {
  const out = [];
  for (let offset = 0; offset < count; offset++) {
    const iso = addDays(today, -offset);
    const [year, month, day] = iso.split("-");
    const quarter = Math.floor((Number(month) - 1) / 3) + 1;
    out.push({
      iso,
      url: `https://www.sec.gov/Archives/edgar/daily-index/${year}/QTR${quarter}/master.${year}${month}${day}.idx`,
    });
  }
  return out;
}

function parseMaster(text, wanted, tickerByCik) {
  const hits = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line || line.startsWith("CIK|") || line.startsWith("Description:") || line.startsWith("-")) continue;
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const form = parts[parts.length - 3];
    if (form !== "8-K" && form !== "8-K/A") continue;
    const cik = Number(parts[0]);
    if (!wanted.has(cik)) continue;
    const filename = parts[parts.length - 1];
    const filed = parts[parts.length - 2];
    const date = `${filed.slice(0, 4)}-${filed.slice(4, 6)}-${filed.slice(6, 8)}`;
    const company = companyName(parts.slice(1, parts.length - 3).join("|"));
    const accession = filename.split("/").pop().replace(/\.txt$/i, "");
    hits.push({
      company,
      ticker: tickerByCik.get(cik) || "",
      amended: form === "8-K/A",
      date,
      cik: String(cik),
      accession,
      url: edgarIndexUrl(cik, filename),
    });
  }
  return hits;
}

async function fetchSec(ctx) {
  const tickers = calendarTickers(ctx.root);
  const buf = await secGet(ctx.polite, TICKERS_URL);
  if (!buf) throw new Error("SEC company tickers file was not available");
  const table = JSON.parse(buf.toString("utf8"));
  const wanted = new Set();
  const tickerByCik = new Map();
  const rows = Array.isArray(table) ? table : Object.values(table || {});
  for (const row of rows) {
    const ticker = String(row.ticker || "").toUpperCase();
    if (!tickers.has(ticker)) continue;
    const cik = Number(row.cik_str);
    if (!cik) continue;
    wanted.add(cik);
    tickerByCik.set(cik, ticker);
  }
  const hits = [];
  let missingDays = 0;
  for (const day of indexDays(ctx.today, 16)) {
    let body = null;
    try {
      body = await secGet(ctx.polite, day.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A day that is not posted yet, a weekend, or a holiday comes back 403 or 404.
      if (/\b(403|404)\b/.test(message)) {
        missingDays += 1;
        continue;
      }
      throw error;
    }
    if (!body) {
      missingDays += 1;
      continue;
    }
    hits.push(...parseMaster(body.toString("utf8"), wanted, tickerByCik));
  }
  const from = addDays(ctx.today, -12);
  const recent = hits.filter((row) => row.date >= from && row.date <= ctx.today && row.url);
  await attachSecItems(ctx.polite, recent);
  return {
    items: secItems(recent),
    note: `SEC EDGAR daily index Form 8-K rows for ${wanted.size} tickers already listed in calendar/calendar.json. ${missingDays} index days were not posted (403 or 404), which is how SEC answers for a weekend, a holiday, or a file that is not up yet. Requests use BioCatalystFeed contact@biocat.ai, per the SEC fair-access User-Agent rule, and stay on /files and /Archives (not /cgi-bin, which robots.txt disallows). Item codes come from the data.sec.gov submissions index for the companies that already matched. Routine items such as earnings, officer changes, and exhibits-only filings are ranked lower. The filing text itself is not copied.`,
  };
}

async function attachSecItems(polite, rows) {
  const byCik = new Map();
  for (const row of rows) {
    const list = byCik.get(row.cik) || [];
    list.push(row);
    byCik.set(row.cik, list);
  }
  const ciks = [...byCik.keys()].slice(0, 20);
  for (const cik of ciks) {
    const padded = String(cik).padStart(10, "0");
    try {
      const buf = await secGet(polite, `https://data.sec.gov/submissions/CIK${padded}.json`);
      if (!buf) continue;
      const data = JSON.parse(buf.toString("utf8"));
      const recent = data.filings?.recent || {};
      const forms = recent.form || [];
      const accessions = recent.accessionNumber || [];
      const items = recent.items || [];
      const index = new Map();
      for (let i = 0; i < forms.length; i++) {
        if (forms[i] === "8-K" || forms[i] === "8-K/A") index.set(accessions[i], String(items[i] || ""));
      }
      for (const row of byCik.get(cik) || []) {
        row.itemCodes = (index.get(row.accession) || "").split(",").map((code) => code.trim()).filter(Boolean);
      }
    } catch {
      /* One company's submissions file should not fail the SEC source. */
    }
  }
}

async function fetchPreprint(ctx, server) {
  const from = addDays(ctx.today, -6);
  const kept = [];
  let cursor = 0;
  let scanned = 0;
  for (let page = 0; page < 4 && kept.length < 16; page++) {
    const url = `https://api.biorxiv.org/details/${server}/${from}/${ctx.today}/${cursor}`;
    const payload = await ctx.polite.getJson(url);
    const batch = payload?.collection || [];
    if (!batch.length) break;
    scanned += batch.length;
    kept.push(...preprintItems(batch, server));
    const count = Number(payload?.messages?.[0]?.count || batch.length);
    cursor += count || batch.length;
    if (batch.length < 5) break;
  }
  return {
    items: kept,
    note: `${server} details API, ${from} to ${ctx.today}, ${scanned} metadata rows scanned. Titles are linked to the preprint page. A blurb uses one results sentence of at most 25 words when the abstract is present, and otherwise says the server and that the item is a preprint, not peer-reviewed. The abstract is not copied. Category filter is bioinformatics, genomics, synthetic biology, systems biology, pharmacology, or bioengineering for bioRxiv, and clinical categories with a therapy or trial word for medRxiv, plus AI-method titles.`,
  };
}

async function fetchBiorxiv(ctx) {
  return fetchPreprint(ctx, "biorxiv");
}

async function fetchMedrxiv(ctx) {
  return fetchPreprint(ctx, "medrxiv");
}

async function fetchWorkerPapers(ctx) {
  const from = addDays(ctx.today, -21);
  const query = `FIRST_PDATE:[${from} TO ${ctx.today}] AND (TITLE:"protein language" OR TITLE:"machine learning" OR TITLE:CRISPR OR TITLE:"single-cell")`;
  const payload = await ctx.polite.getJson(`${WORKER}/papers?q=${encodeURIComponent(query)}`);
  return {
    items: paperRecords(payload?.resultList?.result || [], {
      mode: "ai",
      scout: "bcf-papers",
      sourceName: "Europe PMC via BioCatalystFeed papers API",
      rule: "paper-ai",
      label: "Europe PMC",
      from,
      today: ctx.today,
    }),
    note: "BioCatalystFeed Worker /papers, which proxies the Europe PMC search API. Same metadata terms as a direct Europe PMC call. Titles that assert efficacy are skipped. Duplicate DOIs collapse with the direct Europe PMC source.",
  };
}

async function fetchAiDiscovery(ctx) {
  const plain = await ctx.polite.getJson(`${WORKER}/ai-discovery`);
  const searched = await ctx.polite.getJson(`${WORKER}/ai-discovery?q=${encodeURIComponent("protein")}`);
  const records = [...(plain?.items || []), ...(searched?.items || [])];
  return {
    items: aiDiscoveryItems(records, ctx.today),
    note: "BioCatalystFeed Worker /ai-discovery. Curated model cards are included only when verified_as_of or published falls in the last 45 days. arXiv rows come from the worker's allowlisted category query and are labeled as preprints. Summaries are not copied. No X client is called.",
  };
}

import { labFeedSources } from "./lab-feeds.mjs";

export const MORE_SOURCES = [
  { id: "biorxiv", enabled: true, fetch: fetchBiorxiv },
  { id: "medrxiv", enabled: true, fetch: fetchMedrxiv },
  { id: "bcf-papers", enabled: true, fetch: fetchWorkerPapers },
  { id: "bcf-ai-discovery", enabled: true, fetch: fetchAiDiscovery },
  { id: "nih-reporter", enabled: true, fetch: fetchGrants },
  { id: "sec-edgar-8k", enabled: true, fetch: fetchSec },
  { id: "fda-press", enabled: true, fetch: fetchPress },
  { id: "nih-news", enabled: true, fetch: fetchNihNews },
  ...labFeedSources(),
];
