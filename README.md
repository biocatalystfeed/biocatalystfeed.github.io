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

`node scripts/headlines/populate.mjs` rebuilds that file from public feeds. `.github/workflows/headlines.yml` runs it daily and commits `data/headlines.json` when it changes. Ranking weights live only in `scripts/headlines/ranking.mjs`. Headline and blurb wording is chosen in `scripts/headlines/copy.mjs` from several factual templates. The template is a hash of the item id, so a rerun with the same record produces the same sentences. Headlines are then trimmed at clause boundaries to about 12 words (never more than 14). The cut text is appended to the blurb. The trim does not rewrite words. Trial headlines always keep the completion date. A paper title of 14 words or fewer is left whole; a longer title is cut at a clause boundary that keeps at least 6 words of the finding. A blurb is one or two sentences and has to carry a fact that is not the headline. The script does not invent an indication: it uses one only when the source record has it (openFDA label `indications_and_usage` or an EPC class, EMA therapeutic indication or MeSH area, Health Canada therapeutic class, a trial condition on the calendar extract).

### Ranking

Each fetcher picks a `rule` key. `ranking.mjs` adds the base score, optional adjustments (priority review, conditional approval, biosimilar), and a recency bump from the event date. Feedback files under `data/feedback/` then add the vote and size deltas. `dropped` removes the item. Notes are not parsed.

Per-source caps keep any one feed from filling the page. The regulator caps (Drugs@FDA, complete response letters, Purple Book, Orange Book, advisory-committee notices, EMA, Health Canada) sum to half of the global cap. When the run also has non-regulator items, regulator rows are trimmed so they are at most half of the list. The displayed order starts from the score sort, then swaps so two adjacent items share a source only when nothing else is left.

### Sources

Live fetches, and why a headline plus a link is allowed:

- **openFDA Drugs@FDA and complete response letters.** U.S. government work. Labels are read only for the indication or pharmacologic class.
- **FDA Orange Book and Purple Book** monthly files, and **Federal Register** advisory-committee notices. U.S. government works. Orange Book patents stay described as applicant listings.
- **EMA medicines export.** EMA publishes this JSON for reuse. The blurb names the Agency through the product number, holder, or pharmacotherapeutic group on that record.
- **Health Canada Notice of Compliance.** Open Government Licence – Canada. The line says so.
- **ClinicalTrials.gov study pages** already extracted in `calendar/calendar.json`. The file is read and not written. The ClinicalTrials.gov API is not called: `robots.txt` disallows `/api/`.
- **Europe PMC.** The same public API the site demo uses. This is also how MEDLINE/PubMed records get in. Queries cover phase 3 titles, a fixed journal list (Nature, Science, Cell, NEJM, Lancet, JAMA, Nature Medicine, Nature Biotechnology, BMJ), and AI-in-biology titles. Titles that assert efficacy or effectiveness are skipped.
- **bioRxiv and medRxiv details API** (`api.biorxiv.org`). The API is the public metadata service. Items link to the preprint page. Abstracts are not copied. bioRxiv keeps bioinformatics, genomics, synthetic biology, systems biology, pharmacology, bioengineering, and AI-method titles. medRxiv keeps clinical categories whose titles name a therapy, trial, or similar term.
- **BioCatalystFeed Worker** `https://biocatalystfeed-api.biocatalystfeed.workers.dev/papers` and `/ai-discovery`. This is our API. `/papers` proxies Europe PMC. `/ai-discovery` returns the curated model cards and an allowlisted arXiv search. Model cards use the card's own license, base model, and parameter fields. arXiv rows are labeled as preprints. `/trials` is not called, because that path hits the disallowed ClinicalTrials.gov API.
- **NIH RePORTER** `api.reporter.nih.gov`. Public API for award records, which are U.S. government works. The blurb uses organization, activity code, award amount, and start date. Abstracts are not copied.
- **SEC EDGAR Form 8-K.** Public filings. Requests send `BioCatalystFeed contact@biocat.ai`, which is the contact form in the SEC fair-access policy, and stay under the published rate. The company set is the tickers already in `calendar/calendar.json`. Daily index files under `/Archives/edgar/daily-index/` and `company_tickers.json` are used. Item codes for those matched filings come from `data.sec.gov` submissions JSON (`recent.items`), not from the filing body. The blurb names the item, such as Item 8.01 Other Events or Item 7.01 Regulation FD. Earnings, officer changes, bylaw amendments, and exhibits-only filings are ranked lower. `/cgi-bin` is disallowed by `robots.txt` and is not requested.
- **FDA press releases** RSS. U.S. government work, published as a syndication feed. A title of 14 words or fewer is kept whole. A longer title is rewritten into a complete lead that names the condition when the title states one. The blurb says what the release is about.
- **Google DeepMind blog** `https://deepmind.google/blog/rss.xml`. Official RSS. `robots.txt` is `Allow: /`. Stored fields are title, link, date, and a short blurb. Posts are kept only when the title or description matches a biology, health, drug, genome, protein, or clinical term.
- **OpenAI News** `https://openai.com/news/rss.xml`. Official RSS. `robots.txt` allows `/`. The same biology, health, drug, genome, protein, or clinical filter applies. A general science announcement is dropped.
- **NVIDIA Blog** `https://blogs.nvidia.com/feed/`. Official RSS. The healthcare category feed returned 404, so the main feed uses the same biology and health filter. Generic computing posts are dropped. `robots.txt` allows `/feed/`.
- **UK MHRA** via the GOV.UK news atom feed for that organisation. GOV.UK content is under the Open Government Licence. `robots.txt` does not disallow this atom path. Operational notices, including outages, are dropped.

Disabled, with no fetch:

- **PubMed E-utilities.** `eutils.ncbi.nlm.nih.gov` robots.txt is `Disallow: /`. MEDLINE records are read through Europe PMC instead.
- **X.** `data/x_allowlist_v1.csv` lists handles, but the X API needs credentials and this repo does not store any. The GitHub Action has no X credentials. Scraping or an unofficial syndication feed would conflict with X's terms.
- **Swissmedic and PMDA.** Written consent was requested on 2026-11-17 and has not been granted. No separate English Japan news feed with clear reuse terms was added in their place.
- **ClinicalTrials.gov `/api/`.** robots.txt disallows it.
- **arXiv RSS on export.arxiv.org.** `robots.txt` is `Disallow: /`. arXiv items still come through the Worker `/ai-discovery` endpoint.
- **Anthropic, Meta AI, Arc Institute, Isomorphic Labs, EvolutionaryScale.** No official public RSS was confirmed (the usual feed URLs returned 404). Those sites are not scraped.
- **Nature News, Science news, MIT Technology Review, New Scientist.** RSS files exist, but their copyright terms do not clearly allow headline aggregation.
- **BBC health and science RSS.** The feeds exist and `robots.txt` allows the paths, but BBC limits RSS use to personal, non-commercial use.
- **Reuters.** The outbound news RSS URL returned 404. No official public RSS was confirmed. Third-party Reuters feeds are not used.
- **AP.** `apnews.com` did not return an official RSS document. Third-party AP feeds are not used.
- **STAT, Endpoints News, Fierce Biotech.** Terms do not clearly allow an aggregation product. Re-checked; still excluded.
- **China NMPA/CDE, India CDSCO, Korea MFDS, English-language Chinese biotech press.** No official feed with clear automated-reuse terms was confirmed. Those sites are not scraped.
- chemRxiv. The AI-discovery allowlist marks it `fetch_in_v1: false`.

Ranking keeps regulators near 25% of the selected items when other items exist, and no source is allowed more than about 15% of a full page (`globalCap`). A source-first, pivotal-readout, or AI-biology-release adjustment raises the score only when the source text supports it.

The script sends `BioCatalystFeed-Headlines/0.1 (+https://biocat.ai/headlines/; contact@biocat.ai)`, reads `robots.txt` before a fetch, and waits out crawl-delay. SEC requests use the separate contact User-Agent above.

### How feedback gets back into ranking

On `/headlines/review/`, each item can get a thumbs up or down, a bigger / smaller / dropped choice, and a note. Overall notes sit at the bottom. Download or copy the JSON and commit it under `data/feedback/`. The format is in `data/feedback/README.md`.

The next populator run applies that file. The newest `exported_at` wins for each item id. `dropped` removes the item. Votes and size choices add the deltas in `ranking.mjs`. Notes are not parsed; use them to edit that file by hand. A file with `"sample": true` is ignored.
