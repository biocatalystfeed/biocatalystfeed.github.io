# biocatalystfeed.github.io

Website for [BioCatalystFeed](https://github.com/biocatalystfeed/biocatalystfeed): a static site with no build step. GitHub Pages serves it from `main` /docs.

- `docs/` holds the site. The live demo calls ClinicalTrials.gov v2 and Europe PMC directly; both allow CORS.
- `worker/` holds the Cloudflare Worker API proxy, needed for NIH RePORTER grants. It isn't deployed yet.
- `CNAME` (biocatalystfeed.com) sits at the repo root on purpose, outside the published folder. That way https://biocatalystfeed.github.io keeps working until DNS is live. Once the Porkbun records resolve, run `git mv CNAME docs/CNAME` (or set the custom domain in Settings → Pages) and turn on Enforce HTTPS.
- `ops/pages-workflow.yml.example` is an optional Actions deploy. Pushing it needs a token with workflow scope.
