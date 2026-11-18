# X on the headlines page

Design only. Nothing here calls X, stores a key, or spends money. `data/x_picks.json` is an empty file with `"enabled": false`. `populate.mjs` ignores it until that flag is true, and even then it only copies picks that are already in the file. It does not fetch posts.

The public page is indexable. `/headlines/review/` stays noindex. A pick, if one is ever added, would be a headline, a one-line blurb in our words, and a link to the post. The post text itself would not be copied.

## What we would read

`data/x_allowlist_v1.csv` is the curated list of researcher and lab accounts. A useful pull is recent posts from those accounts, about four times a day, matching the headlines schedule. That is a small read, not a firehose.

## (a) Official X API key in GitHub Actions

The public pricing page is [docs.x.com/x-api/getting-started/pricing](https://docs.x.com/x-api/getting-started/pricing). On 17 November 2026 that URL returned 403 to this environment. The rates below are the ones that page publishes, as reproduced by the docs index at [x-preview.mintlify.app/x-api/getting-started/pricing](https://x-preview.mintlify.app/x-api/getting-started/pricing), which points back at `https://docs.x.com/llms.txt`. Prices can change. The Developer Console is the live rate card.

X no longer lists the old Free, Basic ($200 a month), or Pro ($5,000 a month) tiers on that page. The self-serve plan is pay-per-use credits: no subscription and no minimum spend. Post reads are capped at 3 million per monthly billing cycle. Above that, the page points to Enterprise.

Rates that matter here:

| Use | Price |
| --- | --- |
| Posts: Read | $0.005 per post returned |
| User: Read | $0.010 per user returned |
| Owned reads of your own account | $0.001 per resource |

The same post read again inside one UTC day is not charged again. That dedupe is described as a soft guarantee.

For about 30 allowlisted accounts, four times a day, a recent-search call that returns two new posts per account is about 60 post reads a day. At $0.005 that is about $0.30 a day, or about $9 a month, if the four daily runs see the same posts and dedupe works. If dedupe fails and each run is billed, multiply by four, still well under the old Basic tier and far under the 3 million post-read cap. A user lookup for each account adds 30 × $0.010 = $0.30 a day before dedupe. No higher tier is required for this volume.

The key would be a GitHub Actions secret, not a file in the repo. The workflow would still have to stay inside X's display rules if it showed the post itself. The archived display requirements (and the current embedded-post docs that cite them) say that a post shown on another site must keep the author's name, @handle, and avatar, must not change the post text, and must link the text to the post on X. The supported way to meet that is X's embed. See [developer.twitter.com display requirements](https://web.archive.org/web/20200322211807/developer.twitter.com/en/developer-terms/display-requirements.html) and the embedded-post notes that still point at those rules. Copying the post into our own headline would not meet them.

## (b) Curated `data/x_picks.json`

An agent with its own sanctioned X read access (not a key stored in this repo) writes a small JSON file and opens a pull request. Each pick is `postUrl`, `handle` (from `scripts/headlines/x-allowlist.json`), `org`, `postedAt`, `linkedUrl` (a primary-source host on that same allowlist), `linkedTitle`, `kind` (`paper`, `approval`, `model`, or `other`), `headline`, and `blurb`. The headline links to the post. The blurb includes `linkedUrl`. If that URL is already on the page, the pick is dropped. The X source is capped at 15 percent of a full page.

`populate.mjs` merges those rows only when `enabled` is true. The same ranking caps as the rest of the page should apply once this is turned on. The page links to the post. It does not store or reprint the post.

This needs no Actions secret and no X invoice. It also avoids the display rules, because we are not displaying the post. The cost is that a person or an agent has to choose the picks, and the file can go stale between edits.

## (c) Official embed, and what we will not do

X's embed widget can show a public post from its URL without an API key. It is the path that satisfies the display rules automatically. It also loads X's script, which this noindex page would have to allow in its content-security policy, and it shows X's wording rather than ours.

Scraping x.com, or using an unofficial syndication feed, conflicts with X's terms. Those stay out. The existing `x` source in `scripts/headlines/sources.mjs` stays disabled for that reason.

## Recommendation

Use (b). Keep `data/x_picks.json` disabled until someone with sanctioned read access has a few posts worth linking, and ship only our own sentence plus the link. Use the official API (a) later only if we decide to show the post itself, and then follow the display rules or embed it. Do not put an API key in the repo, and do not scrape.
