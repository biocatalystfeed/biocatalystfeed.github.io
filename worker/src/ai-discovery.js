// AI discovery lane. Serves the curated seed and, when a search is present,
// an optional arXiv API query limited to Gavin's category allowlist.
// No web crawler. No X/Twitter client. Verified X handles in the allowlist are
// config only (fetch_in_v1 is false, hashtags are not auto-published).
// bioRxiv and chemRxiv stay config-only.
import catalog from "../../data/ai-discovery.json" with { type: "json" };
import allowlist from "../../data/ai-discovery-allowlist.json" with { type: "json" };
import {
  arxivEntriesToItems,
  buildArxivUrl,
  filterItems,
  parseArxivAtom,
} from "../../data/ai-discovery-score.js";

const UA = "BioCatalystFeed/1.0 (+https://biocat.ai; contact@biocat.ai)";

export function curatedCatalog() {
  return catalog;
}

export function scoutAllowlist() {
  return allowlist;
}

export async function buildLane({ q = "", fetchImpl, wantArxiv = false, catalog: cat = catalog, allowlist: list = allowlist } = {}) {
  const query = String(q || "").trim().slice(0, 200);
  const curated = filterItems(cat.items, query);
  const arxiv = { queried: false, categories: [], error: null };
  let arxivItems = [];
  if (wantArxiv && query.length >= 2) {
    const built = buildArxivUrl(query, list);
    arxiv.categories = built.categories;
    if (!built.url) {
      arxiv.error = "query has no safe tokens";
    } else if (typeof fetchImpl !== "function") {
      arxiv.error = "arxiv fetch unavailable";
    } else {
      arxiv.queried = true;
      try {
        const res = await fetchImpl(built.url, { headers: { "User-Agent": UA, Accept: "application/atom+xml" } });
        if (!res.ok) arxiv.error = `arxiv HTTP ${res.status}`;
        else arxivItems = arxivEntriesToItems(parseArxivAtom(await res.text()), built.categories);
      } catch {
        arxiv.error = "arxiv unreachable";
      }
    }
  }
  const items = [...curated, ...arxivItems];
  return {
    lane: "ai-discovery",
    disclaimer: cat.disclaimer,
    disclaimer_required: true,
    query,
    count: items.length,
    items,
    sources: { curated: curated.length, arxiv: arxivItems.length },
    arxiv,
    crawl: false,
    x_firehose: false,
  };
}
