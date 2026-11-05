import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildLane } from "../src/ai-discovery.js";
import worker from "../src/index.js";
import {
  LANE_DISCLAIMER,
  SOURCE_TIERS,
  arxivCategoriesForQuery,
  blockedByPolicy,
  buildArxivUrl,
  filterItems,
  normalizeItem,
  renderItem,
} from "../../data/ai-discovery-score.js";

const root = new URL("../../", import.meta.url);
const catalog = JSON.parse(readFileSync(new URL("data/ai-discovery.json", root), "utf8"));
const allowlist = JSON.parse(readFileSync(new URL("data/ai-discovery-allowlist.json", root), "utf8"));
const html = readFileSync(new URL("index.html", root), "utf8");
const app = readFileSync(new URL("app.js", root), "utf8");
const css = readFileSync(new URL("style.css", root), "utf8");
const workerSrc = readFileSync(new URL("../src/index.js", import.meta.url), "utf8")
  + readFileSync(new URL("../src/ai-discovery.js", import.meta.url), "utf8");

const REQUIRED_ARXIV = ["cs.LG", "cs.AI", "stat.ML", "q-bio.BM", "q-bio.QM", "physics.chem-ph", "cond-mat.mtrl-sci", "physics.comp-ph"];

function mockCaches() {
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        return store.get(req.url);
      },
      async put(req, res) {
        store.set(req.url, res.clone());
      },
    },
  };
  return store;
}

test("Hydrogen-1.0 is the launch seed with the verified links and scoring fields", () => {
  const items = filterItems(catalog.items, "");
  assert.equal(items[0].id, "hydrogen-1.0");
  assert.equal(items[0].launch, true);
  assert.equal(items[0].org, "Deep Principle");
  assert.equal(items[0].base_model, "GLM-5.3");
  assert.equal(items[0].base_org, "Z.AI");
  assert.equal(items[0].license, "MIT");
  assert.equal(items[0].params, "~753B");
  assert.equal(items[0].context_length, "1M tokens");
  assert.equal(items[0].urls.weights, "https://huggingface.co/deep-principle/Hydrogen-1.0");
  assert.equal(items[0].urls.blog, "https://blog.deepprinciple.com/introducing-hydrogen-1.0/");
  assert.equal(items[0].source_tier, "model_release");
  assert.equal(items[0].confidence, 0.35);
  assert.equal(items[0].disclaimer_required, true);
  assert.ok(items.length >= 2, "curated seeds beyond the launch item");
  for (const item of items) {
    assert.equal(item.disclaimer_required, true);
    assert.ok(SOURCE_TIERS.includes(item.source_tier));
    assert.ok(item.confidence > 0 && item.confidence <= 0.35);
    assert.equal(blockedByPolicy(`${item.title} ${item.summary}`), false);
    assert.ok(Object.values(item.urls).every((url) => url.startsWith("https://")));
  }
});

test("normalizer forces the disclaimer flag and drops unsafe urls", () => {
  const item = normalizeItem({
    id: "x",
    title: "Example",
    source_tier: "blog",
    disclaimer_required: false,
    confidence: 9,
    urls: { blog: "javascript:alert(1)", paper: "https://example.org/paper" },
  });
  assert.equal(item.disclaimer_required, true);
  assert.equal(item.confidence, 0.22);
  assert.equal(item.urls.blog, undefined);
  assert.equal(item.urls.paper, "https://example.org/paper");
  assert.equal(renderItem({ title: "<script>alert(1)</script>", urls: { blog: "https://example.org" } }).includes("<script>"), false);
  const hydrogenHtml = renderItem(catalog.items[0]);
  assert.match(hydrogenHtml, /huggingface\.co\/deep-principle\/Hydrogen-1\.0/);
  assert.match(hydrogenHtml, /blog\.deepprinciple\.com\/introducing-hydrogen-1\.0/);
  assert.match(hydrogenHtml, />Weights</);
  assert.match(hydrogenHtml, />Blog</);
  assert.match(renderItem(catalog.items[0]), /Not a peer-reviewed experimental finding/);
  assert.match(renderItem(catalog.items[0]), /Does not predict replication/);
});

test("search filters the curated seed and keeps Hydrogen first when it matches", () => {
  assert.deepEqual(filterItems(catalog.items, "hydrogen").map((item) => item.id), ["hydrogen-1.0"]);
  assert.deepEqual(filterItems(catalog.items, "GLM-5.3").map((item) => item.id), ["hydrogen-1.0"]);
  assert.deepEqual(filterItems(catalog.items, "protein").map((item) => item.id), ["esm3"]);
  assert.deepEqual(filterItems(catalog.items, "no-such-model"), []);
  const blocked = filterItems([{
    id: "hype",
    title: "A token launch that cures cancer",
    summary: "self-reported benchmark",
    source_tier: "news",
    urls: { page: "https://example.org" },
  }], "");
  assert.equal(blocked.length, 0);
});

function parseXCsv(text) {
  return text.trim().split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
    const parts = [];
    let rest = line;
    for (let i = 0; i < 6; i++) {
      const idx = rest.indexOf(",");
      parts.push(rest.slice(0, idx));
      rest = rest.slice(idx + 1);
    }
    parts.push(rest);
    const [handle, display_name, type, affiliation, , verified_on] = parts;
    return { handle, display_name, type, affiliation, verified_on };
  });
}

test("Gavin's allowlist encodes arXiv, labs, Hugging Face, and the verified X handles", () => {
  assert.deepEqual(allowlist.arxiv.categories, REQUIRED_ARXIV);
  assert.deepEqual(allowlist.arxiv.conditional, [{ category: "cs.CL", when: "science-relevant" }]);
  assert.equal(allowlist.preprint_servers.every((server) => server.fetch_in_v1 === false), true);
  assert.ok(allowlist.preprint_servers.some((server) => server.id === "biorxiv"));
  assert.ok(allowlist.preprint_servers.some((server) => server.id === "chemrxiv"));
  assert.equal(allowlist.labs.length, 15);
  assert.equal(allowlist.labs.find((lab) => lab.id === "deep-principle").seed_scope, "Hydrogen-1.0 only");
  assert.equal(allowlist.labs.find((lab) => lab.id === "genesis").name, "Genesis Molecular AI");
  assert.equal(allowlist.labs.find((lab) => lab.id === "orbital").name, "Orbital Industries");
  assert.match(allowlist.huggingface.rule, /Verified organization accounts only/);
  assert.equal(allowlist.x.fetch_in_v1, false);
  assert.equal(allowlist.x.auto_publish_hashtags, false);
  assert.deepEqual(allowlist.x.hashtag_lead_finder_only, ["#AIforScience"]);
  const csvRows = parseXCsv(readFileSync(new URL("data/x_allowlist_v1.csv", root), "utf8"));
  const configRows = [
    ...allowlist.x.org_accounts.map((account) => ({ ...account, type: "org" })),
    ...allowlist.x.researcher_handles.map((account) => ({ ...account, type: "researcher" })),
  ];
  assert.equal(csvRows.length, 28);
  assert.equal(configRows.length, 28);
  assert.deepEqual(configRows.map((row) => row.handle), csvRows.map((row) => row.handle));
  assert.deepEqual(configRows.map((row) => row.display_name), csvRows.map((row) => row.display_name));
  assert.deepEqual(configRows.map((row) => row.type), csvRows.map((row) => row.type));
  assert.equal(allowlist.x.org_accounts.length, 18);
  assert.equal(allowlist.x.researcher_handles.length, 10);
  const handles = new Set(configRows.map((row) => row.handle));
  for (const rejected of ["MetaAI", "InsilicoMed"]) assert.equal(handles.has(rejected), false);
  assert.deepEqual(allowlist.x.rejected_lookalikes.map((row) => row.handle), ["MetaAI", "InsilicoMed"]);
  assert.deepEqual(allowlist.x.handles_not_found.map((row) => row.person), ["David Baker", "John Jumper", "Regina Barzilay"]);
  assert.equal(allowlist.labs.every((lab) => handles.has(lab.x_handle)), true);
  assert.equal(allowlist.x.org_accounts.every((account) => account.profile_url === `https://x.com/${account.handle}`), true);
  assert.match(allowlist.x._comment, /does not auto-publish/);
  assert.ok(allowlist.hard_nos.some((rule) => /beats/i.test(rule)));
});

test("arXiv query stays inside the allowlist and omits cs.CL unless the query is science-relevant", () => {
  const plain = buildArxivUrl("optimizer sgd", allowlist);
  assert.equal(plain.categories.includes("cs.CL"), false);
  assert.equal(plain.categories.includes("cs.LG"), true);
  assert.match(plain.url, /^https:\/\/export\.arxiv\.org\/api\/query\?/);
  assert.doesNotMatch(plain.search_query, /biorxiv|chemrxiv|twitter|cat:cs\.CL/);
  const science = arxivCategoriesForQuery("protein language model", allowlist);
  assert.ok(science.includes("cs.CL"));
  assert.equal(buildArxivUrl("???", allowlist).url, "");
  const injected = buildArxivUrl("cat:cs.CR OR all:secret", allowlist);
  assert.doesNotMatch(injected.search_query, /cat:cs\.CR|OR all:secret/);
});

test("allowlisted arXiv hits are scored as preprints and policy-blocked claims are dropped", async () => {
  const calls = [];
  const atom = `<?xml version="1.0"?><feed>
    <entry>
      <id>http://arxiv.org/abs/2401.00001v1</id>
      <title>A protein language  model</title>
      <summary>Methods preprint.</summary>
      <published>2024-01-02T00:00:00Z</published>
      <author><name>A. Scientist</name></author>
      <category term="q-bio.BM" scheme="http://arxiv.org/schemas/atom"/>
    </entry>
    <entry>
      <id>http://arxiv.org/abs/2401.00002v1</id>
      <title>This cures cancer better than doctors</title>
      <summary>clinical cure</summary>
      <published>2024-01-03T00:00:00Z</published>
      <author><name>Hype</name></author>
      <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    </entry>
    <entry>
      <id>http://arxiv.org/abs/2401.00003v1</id>
      <title>Unrelated economics</title>
      <summary>Out of allowlist.</summary>
      <author><name>Econ</name></author>
      <category term="econ.GN" scheme="http://arxiv.org/schemas/atom"/>
    </entry>
  </feed>`;
  const payload = await buildLane({
    q: "protein",
    wantArxiv: true,
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(atom, { status: 200 });
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/export\.arxiv\.org\/api\/query\?/);
  assert.equal(payload.crawl, false);
  assert.equal(payload.x_firehose, false);
  assert.equal(payload.disclaimer, LANE_DISCLAIMER);
  assert.equal(payload.disclaimer_required, true);
  assert.equal(payload.sources.arxiv, 1);
  assert.equal(payload.items[0].id, "esm3");
  const preprint = payload.items.find((item) => item.provenance === "arxiv-allowlist");
  assert.equal(preprint.source_tier, "preprint");
  assert.equal(preprint.disclaimer_required, true);
  assert.equal(preprint.confidence, 0.3);
  assert.equal(preprint.urls.paper, "https://arxiv.org/abs/2401.00001v1");
  assert.equal(payload.items.some((item) => /cures cancer/.test(item.title)), false);
});

test("worker /ai-discovery serves the seed without calling upstream", async () => {
  mockCaches();
  const jobs = [];
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    fetches += 1;
    return original(...args);
  };
  try {
    const res = await worker.fetch(new Request("https://api.example/ai-discovery"), {
      ALLOWED_ORIGINS: "https://biocat.ai",
      REQUIRE_RATE_LIMIT: "0",
    }, { waitUntil(job) { jobs.push(job); } });
    assert.equal(fetches, 0);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.lane, "ai-discovery");
    assert.equal(body.crawl, false);
    assert.equal(body.items[0].id, "hydrogen-1.0");
    assert.equal(body.items.every((item) => item.disclaimer_required === true), true);
    assert.equal(body.arxiv.queried, false);
    await Promise.all(jobs);
  } finally {
    globalThis.fetch = original;
  }
});

test("worker arXiv lookups fail closed when the rate limiter is not configured", async () => {
  mockCaches();
  const res = await worker.fetch(new Request("https://api.example/ai-discovery?q=protein"), {
    ALLOWED_ORIGINS: "https://biocat.ai",
  }, { waitUntil() {} });
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.lane, "ai-discovery");
});

test("health lists the lane and the homepage checkbox carries the loud disclaimer", async () => {
  mockCaches();
  const health = await worker.fetch(new Request("https://api.example/health"), {
    ALLOWED_ORIGINS: "https://biocat.ai",
  }, { waitUntil() {} });
  const healthBody = await health.json();
  assert.deepEqual(healthBody.routes, ["/trials", "/papers", "/grants", "/ai-discovery"]);
  assert.match(workerSrc, /\/ai-discovery/);
  assert.doesNotMatch(workerSrc, /api\.twitter\.com|api\.x\.com|nitter|syndication\.twitter/);
  assert.doesNotMatch(app, /export\.arxiv\.org|api\.twitter\.com|api\.x\.com/);
  assert.match(app, /\/data\/ai-discovery\.json/);
  assert.match(html, /id="ai-discovery"/);
  assert.match(html, /AI discovery/);
  assert.match(html, new RegExp(LANE_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /Not peer-reviewed findings\./);
  assert.match(html, /do not predict replication/);
  assert.match(html, /type="module"/);
  assert.doesNotMatch(html, /arxiv\.org|twitter\.com|x\.com/);
  assert.match(css, /\.aid-disclaimer/);
  assert.match(css, /#ai-discovery:checked/);
  assert.equal(catalog.disclaimer, LANE_DISCLAIMER);
  assert.equal(catalog.crawl, false);
});
