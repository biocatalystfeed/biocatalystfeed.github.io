# BioCatalystFeed API Worker

The `RATE_LIMIT` Workers KV namespace id is filled in `wrangler.toml` (`f9bed88fead64f18a7aa90c7953e5d01`). `API_BASE` in `../app.js` is `https://biocatalystfeed-api.biocatalystfeed.workers.dev` (no trailing slash; the site appends `/trials`, `/papers`, `/grants`, and `/ai-discovery`).

Cloudflare Worker that proxies the demo searches: `/trials`, `/papers` and `/grants` (NIH RePORTER has no browser CORS, so this is required for grants). It caches responses at the edge for 15 minutes and enforces a per-IP burst limit (Workers Rate Limiting binding `BURST`, 20 req/min; the Worker fails closed with 429 if it is missing) and, optionally (`KV_DAILY="1"`, paid plan recommended because each uncached request is a KV write), a per-IP daily cap in KV.

`/ai-discovery` serves the curated seed in `data/ai-discovery.json`. With no `q`, or with `q` shorter than 2 characters, the response is that seed only and is not rate limited. With `q` of at least 2 characters it also queries `export.arxiv.org` using categories from `data/ai-discovery-allowlist.json` (cs.CL only when the query looks science-relevant). bioRxiv and chemRxiv are not fetched. Gavin's verified X handles (28 accounts in `data/x_allowlist_v1.csv`, mirrored on the allowlist) are config only: the worker does not call the X API and does not auto-publish hashtags. The arXiv lookup uses the same rate limit as the other routes and fails closed when `BURST` is missing. With `API_BASE` set, a search of at least 2 characters also calls this route. Shorter queries, and a failed call, still read `/data/ai-discovery.json` directly.

Deploy (free plan is enough; the `RATE_LIMIT` namespace id is already in `wrangler.toml`):
```
npm i -g wrangler && wrangler login
wrangler deploy
```
`API_BASE` in `../app.js` points at `https://biocatalystfeed-api.biocatalystfeed.workers.dev`.
