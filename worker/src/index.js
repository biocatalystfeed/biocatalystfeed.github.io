// BioCatalystFeed API proxy: /trials, /papers, /grants?q=...
// Edge caching (Cache API) + per-IP daily rate limit (KV).
const UA = "BioCatalystFeed/1.0 (+https://biocatalystfeed.com; contact@biocatalystfeed.com)";

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

async function upstream(route, q) {
  const t = encodeURIComponent(q);
  if (route === "trials")
    return fetch(`https://clinicaltrials.gov/api/v2/studies?query.term=${t}&pageSize=10&sort=LastUpdatePostDate:desc&fields=NCTId,BriefTitle,OverallStatus,Phase,LeadSponsorName,LastUpdatePostDate`, { headers: { "User-Agent": UA } });
  if (route === "papers")
    return fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${t}&format=json&pageSize=10&sort=P_PDATE_D%20desc`, { headers: { "User-Agent": UA } });
  if (route === "grants")
    return fetch("https://api.reporter.nih.gov/v2/projects/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({
        criteria: { advanced_text_search: { operator: "and", search_field: "projecttitle,terms,abstracttext", search_text: q } },
        include_fields: ["ApplId", "ProjectTitle", "Organization", "FiscalYear", "AwardAmount", "ActivityCode"],
        limit: 10, sort_field: "project_start_date", sort_order: "desc",
      }),
    });
  return null;
}

async function rateLimit(ip, env) {
  if (!env.RATE_LIMIT) return { ok: true, remaining: -1 };
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${day}:${ip}`;
  const n = parseInt((await env.RATE_LIMIT.get(key)) || "0", 10);
  const limit = parseInt(env.DAILY_LIMIT || "200", 10);
  if (n >= limit) return { ok: false, remaining: 0, limit };
  await env.RATE_LIMIT.put(key, String(n + 1), { expirationTtl: 60 * 60 * 26 });
  return { ok: true, remaining: limit - n - 1, limit };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const h = cors(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405, h);

    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/+|\/+$/g, "");
    if (route === "" || route === "health") return json({ ok: true, routes: ["/trials", "/papers", "/grants"] }, 200, h);
    if (!["trials", "papers", "grants"].includes(route)) return json({ error: "not found" }, 404, h);
    const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
    if (q.length < 2) return json({ error: "query 'q' must be at least 2 characters" }, 400, h);

    // Cache first; cached hits don't count against the rate limit.
    const cache = caches.default;
    const cacheKey = new Request(`https://cache.bcf/${route}?q=${encodeURIComponent(q.toLowerCase())}`);
    const hit = await cache.match(cacheKey);
    if (hit) {
      const r = new Response(hit.body, hit);
      Object.entries(h).forEach(([k, v]) => r.headers.set(k, v));
      r.headers.set("X-Cache", "HIT");
      return r;
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await rateLimit(ip, env);
    if (!rl.ok) return json({ error: "daily rate limit reached", limit: rl.limit }, 429, { ...h, "Retry-After": "3600" });

    let res;
    try { res = await upstream(route, q); } catch (e) { return json({ error: "upstream unreachable" }, 502, h); }
    if (!res.ok) return json({ error: `upstream HTTP ${res.status}` }, 502, h);

    const body = await res.text();
    const ttl = parseInt(env.CACHE_TTL || "900", 10);
    const out = new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
    });
    ctx.waitUntil(cache.put(cacheKey, out.clone()));
    const r = new Response(body, out);
    Object.entries(h).forEach(([k, v]) => r.headers.set(k, v));
    r.headers.set("X-Cache", "MISS");
    r.headers.set("X-RateLimit-Remaining", String(rl.remaining));
    return r;
  },
};
