# biocatalystfeed.github.io

Website for [BioCatalystFeed](https://github.com/biocatalystfeed/biocatalystfeed): a static site with no build step. GitHub Pages serves it from the root of `main`.

- The site files are in the repo root. The live demo calls ClinicalTrials.gov v2 and Europe PMC directly; both allow CORS.
- The demo has an **AI discovery** checkbox. It loads the curated seed in `data/ai-discovery.json` (Hydrogen-1.0 first) and shows a disclaimer. It does not crawl the web or X. Allowlist: `data/ai-discovery-allowlist.json`. The X section is Gavin's 28 verified handles (`data/x_allowlist_v1.csv`); nothing is fetched from X and hashtags are not auto-published.
- `worker/` holds the Cloudflare Worker API proxy, needed for NIH RePORTER grants. It isn't deployed yet. `/ai-discovery` serves the same curated seed and, for a search of at least 2 characters, may query the arXiv API inside the allowlist.
- `CNAME` sets the custom domain biocat.ai (DNS at Porkbun). biocatalystfeed.github.io redirects there.
- `npm test` checks the AI discovery seed, allowlist, scoring, and worker route. No Cloudflare account required.
- `ops/pages-workflow.yml.example` is an optional Actions deploy. Pushing it needs a token with workflow scope.

## Headlines test page

`/headlines/` is a noindex, Drudge-style test page. It is not linked from the homepage. `/headlines/review/` is the review view, also noindex. Both read `data/headlines.json`.

`node scripts/headlines/populate.mjs` rebuilds that file from public feeds. `.github/workflows/headlines.yml` runs it daily and commits `data/headlines.json` when it changes. Ranking weights live only in `scripts/headlines/ranking.mjs`.

Swissmedic and PMDA are disabled: written consent was requested on 2026-11-17 and has not been granted. The ClinicalTrials.gov API is not called, because its robots.txt disallows `/api/`; the populator reads the existing `calendar/calendar.json` extract and does not modify it.

### How feedback gets back into ranking

On `/headlines/review/`, each item can get a thumbs up or down, a bigger / smaller / dropped choice, and a note. Overall notes sit at the bottom. Download or copy the JSON and commit it under `data/feedback/`. The format is in `data/feedback/README.md`.

The next populator run applies that file. The newest `exported_at` wins for each item id. `dropped` removes the item. Votes and size choices add the deltas in `ranking.mjs`. Notes are not parsed; use them to edit that file by hand. A file with `"sample": true` is ignored.
