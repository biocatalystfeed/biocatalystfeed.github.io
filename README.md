# biocatalystfeed.github.io

Website for [BioCatalystFeed](https://github.com/biocatalystfeed/biocatalystfeed): a static site with no build step. GitHub Pages serves it from the root of `main`.

- The site files are in the repo root. The live demo calls ClinicalTrials.gov v2 and Europe PMC directly; both allow CORS.
- The demo has an **AI discovery** checkbox. It loads the curated seed in `data/ai-discovery.json` (Hydrogen-1.0 first) and shows a disclaimer. It does not crawl the web or X. Allowlist: `data/ai-discovery-allowlist.json`. The X section is Gavin's 28 verified handles (`data/x_allowlist_v1.csv`); nothing is fetched from X and hashtags are not auto-published.
- `worker/` holds the Cloudflare Worker API proxy, needed for NIH RePORTER grants. It isn't deployed yet. `/ai-discovery` serves the same curated seed and, for a search of at least 2 characters, may query the arXiv API inside the allowlist.
- `CNAME` sets the custom domain biocat.ai (DNS at Porkbun). biocatalystfeed.github.io redirects there.
- `npm test` checks the AI discovery seed, allowlist, scoring, and worker route. No Cloudflare account required.
- `ops/pages-workflow.yml.example` is an optional Actions deploy. Pushing it needs a token with workflow scope.
