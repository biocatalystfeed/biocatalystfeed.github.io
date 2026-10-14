# biocatalystfeed.github.io

Website for [BioCatalystFeed](https://github.com/biocatalystfeed/biocatalystfeed): a static site with no build step. GitHub Pages serves it from the root of `main`.

- The site files are in the repo root. The live demo calls ClinicalTrials.gov v2 and Europe PMC directly; both allow CORS.
- `worker/` holds the Cloudflare Worker API proxy, needed for NIH RePORTER grants. It isn't deployed yet.
- `CNAME` sets the custom domain biocat.ai (DNS at Porkbun). biocatalystfeed.github.io redirects there.
- `ops/pages-workflow.yml.example` is an optional Actions deploy. Pushing it needs a token with workflow scope.
