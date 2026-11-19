const HEADLINES_URL = "https://biocat.ai/data/headlines.json";
const DISPATCH_URL = "https://api.github.com/repos/biocatalystfeed/biocatalystfeed.github.io/actions/workflows/headlines.yml/dispatches";
const FRESH_MS = 3 * 60 * 60 * 1000;

export function isFresh(generatedAt, now) {
  const generated = Date.parse(String(generatedAt || ""));
  const current = now instanceof Date ? now.getTime() : Date.parse(String(now || ""));
  if (!Number.isFinite(generated) || !Number.isFinite(current)) return false;
  return current - generated < FRESH_MS;
}

export function buildDispatchRequest(token) {
  return {
    url: DISPATCH_URL,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "biocat-headlines-timer",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  };
}

async function headlinesAreFresh() {
  const response = await fetch(`${HEADLINES_URL}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
  if (!response.ok) throw new Error(`headlines HTTP ${response.status}`);
  const data = await response.json();
  return isFresh(data?.generated_at, new Date());
}

export default {
  async scheduled(_event, env) {
    if (!env?.GH_DISPATCH_TOKEN) {
      console.log("GH_DISPATCH_TOKEN not set; skipping");
      return;
    }
    try {
      if (await headlinesAreFresh()) {
        console.log("fresh, skip");
        return;
      }
    } catch {
      // A failed read is not proof the edition is fresh, so dispatch anyway.
    }
    const request = buildDispatchRequest(env.GH_DISPATCH_TOKEN);
    const response = await fetch(request.url, request.init);
    if (response.status === 204) {
      console.log("dispatch 204");
      return;
    }
    const body = (await response.text()).slice(0, 300);
    console.log(`dispatch ${response.status} ${body}`);
  },

  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
