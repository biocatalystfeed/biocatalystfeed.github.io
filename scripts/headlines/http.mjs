import fs from "node:fs";
import path from "node:path";

export const USER_AGENT = "BioCatalystFeed-Headlines/0.1 (+https://biocat.ai/headlines/; contact@biocat.ai)";

const MIN_INTERVAL_MS = 1100;

export function parseRobots(text) {
  const groups = [];
  let current = null;
  const ensure = () => {
    if (!current) current = { agents: [], rules: [], crawlDelay: 0, hitRate: 0 };
    return current;
  };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) {
      if (current && (current.agents.length || current.rules.length)) groups.push(current);
      current = null;
      continue;
    }
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (!current || current.rules.length) {
        if (current && (current.agents.length || current.rules.length)) groups.push(current);
        current = { agents: [], rules: [], crawlDelay: 0, hitRate: 0 };
      }
      current.agents.push(value.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      ensure().rules.push({ allow: key === "allow", path: value });
    } else if (key === "crawl-delay" || key === "hit-rate") {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds < 0) continue;
      const group = ensure();
      if (key === "crawl-delay") group.crawlDelay = seconds * 1000;
      else group.hitRate = seconds * 1000;
    }
  }
  if (current && (current.agents.length || current.rules.length)) groups.push(current);
  return groups;
}

function escapeRegExp(value) {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function ruleMatches(rulePath, urlPath) {
  if (!rulePath) return false;
  let body = rulePath;
  let end = false;
  if (body.endsWith("$")) {
    end = true;
    body = body.slice(0, -1);
  }
  const pattern = `^${body.split("*").map(escapeRegExp).join(".*")}${end ? "$" : ""}`;
  return new RegExp(pattern).test(urlPath);
}

export function robotsDecision(groups, userAgent, urlPath) {
  const ua = String(userAgent || "").toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent === "*") {
        if (bestLen < 0) {
          best = group;
          bestLen = 0;
        }
      } else if (agent && ua.includes(agent) && agent.length > bestLen) {
        best = group;
        bestLen = agent.length;
      }
    }
  }
  if (!best) return { allowed: true, delayMs: 0 };
  let winner = null;
  for (const rule of best.rules) {
    if (!rule.path && !rule.allow) continue;
    if (!ruleMatches(rule.path, urlPath)) continue;
    if (!winner || rule.path.length > winner.path.length || (rule.path.length === winner.path.length && rule.allow && !winner.allow)) {
      winner = rule;
    }
  }
  return {
    allowed: winner ? winner.allow : true,
    delayMs: Math.max(best.crawlDelay || 0, best.hitRate || 0, 0),
  };
}

export class RobotsDenied extends Error {
  constructor(url) {
    super(`robots.txt disallows ${url}`);
    this.name = "RobotsDenied";
    this.code = "robots";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Polite {
  constructor({ cacheDir, userAgent = USER_AGENT, minInterval = MIN_INTERVAL_MS } = {}) {
    this.cacheDir = cacheDir;
    this.userAgent = userAgent;
    this.minInterval = minInterval;
    this.robots = new Map();
    this.nextAt = new Map();
  }

  async decisionFor(url) {
    const target = new URL(url);
    const origin = target.origin;
    if (!this.robots.has(origin)) {
      let text = "";
      try {
        const response = await this.#request(new URL("/robots.txt", origin), { checkRobots: false });
        text = response.status === 200 ? await response.text() : "";
      } catch {
        text = "";
      }
      const groups = parseRobots(text);
      this.robots.set(origin, groups);
      const delay = robotsDecision(groups, this.userAgent, "/").delayMs;
      this.nextAt.set(origin, Date.now() + Math.max(this.minInterval, delay));
    }
    return robotsDecision(this.robots.get(origin), this.userAgent, target.pathname);
  }

  async #request(url, { checkRobots = true, timeout = 45000, headers = {} } = {}) {
    const target = typeof url === "string" ? new URL(url) : url;
    if (checkRobots) {
      const decision = await this.decisionFor(target.href);
      if (!decision.allowed) throw new RobotsDenied(target.href);
      await this.#wait(target.origin, Math.max(this.minInterval, decision.delayMs));
    }
    const response = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
      headers: {
        "User-Agent": this.userAgent,
        Accept: "application/json, text/plain, text/csv, application/zip, */*",
        ...headers,
      },
    });
    return response;
  }

  async #wait(origin, delayMs) {
    const now = Date.now();
    const due = this.nextAt.get(origin) || 0;
    if (due > now) await sleep(due - now);
    this.nextAt.set(origin, Date.now() + delayMs);
  }

  async getBuffer(url, { timeout = 120000 } = {}) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.#request(url, { timeout });
      if (response.status === 404) return null;
      if (response.status === 429 || response.status >= 500) {
        const retry = Number(response.headers.get("retry-after"));
        const wait = Number.isFinite(retry) ? Math.min(retry * 1000, 60000) : 1500 * (attempt + 1);
        lastError = new Error(`${response.status} from ${url}`);
        if (attempt < 2) {
          await sleep(wait);
          continue;
        }
        throw lastError;
      }
      if (!response.ok) throw new Error(`${response.status} from ${url}`);
      return Buffer.from(await response.arrayBuffer());
    }
    throw lastError || new Error(`failed ${url}`);
  }

  async getJson(url) {
    const buf = await this.getBuffer(url, { timeout: 60000 });
    if (!buf) return null;
    return JSON.parse(buf.toString("utf8"));
  }

  readCache(file, url, maxAgeMs) {
    const metaPath = `${file}.meta.json`;
    if (!fs.existsSync(metaPath)) return undefined;
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
      return undefined;
    }
    if (meta.url !== url) return undefined;
    if (Date.now() - Date.parse(meta.fetched_at) > maxAgeMs) return undefined;
    if (meta.status === 404) return null;
    if (!fs.existsSync(file)) return undefined;
    return fs.readFileSync(file);
  }

  writeCache(file, url, body, status) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const meta = { url, fetched_at: new Date().toISOString(), status: status || 200 };
    if (body) fs.writeFileSync(file, body);
    fs.writeFileSync(`${file}.meta.json`, JSON.stringify(meta));
  }

  async cachedBuffer(url, filename, { maxAgeHours = 24, timeout = 180000 } = {}) {
    if (!this.cacheDir) return this.getBuffer(url, { timeout });
    const file = path.join(this.cacheDir, filename);
    const cached = this.readCache(file, url, maxAgeHours * 3600 * 1000);
    if (cached !== undefined) return cached;
    const body = await this.getBuffer(url, { timeout });
    this.writeCache(file, url, body, body ? 200 : 404);
    return body;
  }
}
