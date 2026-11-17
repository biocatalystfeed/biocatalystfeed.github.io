// Each image source records the robots.txt and terms check that decided
// whether this run may call it. A source with allowed: false is not requested.

export const IMAGE_SOURCES = {
  commons: {
    id: "commons",
    allowed: true,
    endpoint: "https://commons.wikimedia.org/w/api.php",
    robots: "commons.wikimedia.org/robots.txt disallows /w/ for a generic crawler. The Wikimedia Foundation API Usage Guidelines allow identified use of /w/api.php.",
    terms: "Calls use BioCatHeadlinesBot/1.0 (https://biocat.ai/; contact@biocat.ai), one at a time, maxlag=5, and at most 20 calls a run. Files are kept only for CC0, public domain, CC BY, or CC BY-SA, with an author credit.",
  },
  openverse: {
    id: "openverse",
    allowed: true,
    endpoint: "https://api.openverse.org/v1/images/",
    robots: "api.openverse.org/robots.txt has User-agent: * / Disallow: /v1/images/. That stops a crawler from treating the API as pages. The API itself answers anonymous clients and sends X-RateLimit-Limit-Anon-Burst (20/min) and X-RateLimit-Limit-Anon-Sustained (200/day).",
    terms: "This client is the documented API, not a site crawl. It requests license=cc0 and license=by only, stays under five calls a run, and stops if the remaining rate-limit header hits zero. CC BY-SA and any NC or ND result is dropped even if the API returns it.",
  },
  nasa: {
    id: "nasa",
    allowed: true,
    endpoint: "https://images-api.nasa.gov/search",
    robots: "images-api.nasa.gov/robots.txt returns 404, so there is no disallow rule. api.nasa.gov/robots.txt is also 404.",
    terms: "NASA images are U.S. government works unless the record says otherwise. Logos, insignia, and images of identifiable people are skipped, as is anything credited as a courtesy or under a third-party copyright.",
  },
  "flickr-niaid": {
    id: "flickr-niaid",
    allowed: false,
    endpoint: "https://www.flickr.com/photos/niaid/",
    robots: "www.flickr.com/robots.txt and api.flickr.com/robots.txt both say User-agent: * / Disallow: /.",
    terms: "Automated access is disallowed, so NIAID Flickr is not queried and no photo licence field is read from it.",
  },
  "nci-visuals": {
    id: "nci-visuals",
    allowed: false,
    endpoint: "https://visualsonline.cancer.gov/",
    robots: "visualsonline.cancer.gov did not resolve on 2026-11-17, so robots.txt and the terms page could not be read.",
    terms: "No replacement NCI Visuals API with a per-image rights field was found. The source is not queried. Copyrighted NCI items would have been skipped anyway.",
  },
  "cdc-phil": {
    id: "cdc-phil",
    allowed: false,
    endpoint: "https://wwwn.cdc.gov/phil/",
    robots: "wwwn.cdc.gov/phil/robots.txt returns 404. www.cdc.gov/robots.txt does not disallow /phil/.",
    terms: "PHIL search is an ASP.NET postback, not a stable API. A detail page repeats a site-wide copyright notice and does not mark that individual image as public domain, so the required per-image rights check cannot pass. The source is not queried.",
  },
};

export function sourceAllowed(id) {
  return IMAGE_SOURCES[id]?.allowed === true;
}
