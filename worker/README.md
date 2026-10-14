# BioCatalystFeed API Worker (not deployed yet)

Cloudflare Worker that proxies the demo searches: `/trials`, `/papers` and `/grants` (NIH RePORTER has no browser CORS, so this is required for grants). It caches responses at the edge for 15 minutes and enforces a per-IP daily limit stored in KV (default 200 per day).

Deploy once a Cloudflare account exists (the free plan is enough):
```
npm i -g wrangler && wrangler login
wrangler kv namespace create RATE_LIMIT   # paste id into wrangler.toml
wrangler deploy
```
Then set `API_BASE` in `../app.js` to the Worker URL.
