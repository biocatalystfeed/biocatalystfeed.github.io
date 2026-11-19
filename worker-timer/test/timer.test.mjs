import assert from "node:assert/strict";
import test from "node:test";
import worker, { buildDispatchRequest, isFresh } from "../src/index.js";

const TOKEN = "timer-secret-do-not-log";

test("isFresh is true only when generated_at is under 3 hours old", () => {
  const now = new Date("2026-11-19T04:00:00Z");
  assert.equal(isFresh("2026-11-19T01:01:00Z", now), true);
  assert.equal(isFresh("2026-11-19T01:00:00Z", now), false);
  assert.equal(isFresh("2026-11-18T21:31:00Z", now), false);
  assert.equal(isFresh("", now), false);
  assert.equal(isFresh("not-a-date", now), false);
});

test("a missing token skips without calling fetch or logging the token", async () => {
  const logs = [];
  const calls = [];
  const restore = mockIo(logs, calls, async () => {
    throw new Error("fetch should not run");
  });
  try {
    await worker.scheduled({}, {}, {});
    assert.deepEqual(logs, ["GH_DISPATCH_TOKEN not set; skipping"]);
    assert.equal(calls.length, 0);
    assert.equal(logs.join("\n").includes(TOKEN), false);
  } finally {
    restore();
  }
});

test("buildDispatchRequest posts to the headlines workflow and does not log the token", async () => {
  const request = buildDispatchRequest(TOKEN);
  assert.equal(request.url, "https://api.github.com/repos/biocatalystfeed/biocatalystfeed.github.io/actions/workflows/headlines.yml/dispatches");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(request.init.headers.Accept, "application/vnd.github+json");
  assert.equal(request.init.headers["X-GitHub-Api-Version"], "2022-11-28");
  assert.equal(request.init.headers["User-Agent"], "biocat-headlines-timer");
  assert.deepEqual(JSON.parse(request.init.body), { ref: "main" });

  const logs = [];
  const calls = [];
  const restore = mockIo(logs, calls, async (url) => {
    if (String(url).startsWith("https://biocat.ai/data/headlines.json")) {
      return jsonResponse({ generated_at: "2026-11-18T21:31:00Z" });
    }
    return new Response(null, { status: 204 });
  });
  try {
    await worker.scheduled({}, { GH_DISPATCH_TOKEN: TOKEN }, {});
    assert.equal(calls.length, 2);
    assert.match(String(calls[0].url), /^https:\/\/biocat\.ai\/data\/headlines\.json\?t=\d+$/);
    assert.equal(calls[0].init.cf.cacheTtl, 0);
    assert.equal(calls[1].url, request.url);
    assert.equal(calls[1].init.method, "POST");
    assert.equal(calls[1].init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(JSON.parse(calls[1].init.body), { ref: "main" });
    assert.deepEqual(logs, ["dispatch 204"]);
    assert.equal(logs.join("\n").includes(TOKEN), false);
    assert.equal(JSON.stringify(logs).includes("Authorization"), false);
  } finally {
    restore();
  }
});

test("a fresh edition does not dispatch", async () => {
  const logs = [];
  const calls = [];
  const restore = mockIo(logs, calls, async () => jsonResponse({ generated_at: new Date().toISOString() }));
  try {
    await worker.scheduled({}, { GH_DISPATCH_TOKEN: TOKEN }, {});
    assert.equal(calls.length, 1);
    assert.deepEqual(logs, ["fresh, skip"]);
    assert.equal(logs.join("\n").includes(TOKEN), false);
  } finally {
    restore();
  }
});

test("a failed headlines read still dispatches, and a non-204 body is truncated", async () => {
  const logs = [];
  const calls = [];
  const longBody = `${"x".repeat(400)}${TOKEN}`;
  let headlines = true;
  const restore = mockIo(logs, calls, async () => {
    if (headlines) {
      headlines = false;
      throw new Error("network down");
    }
    return new Response(longBody, { status: 500 });
  });
  try {
    await worker.scheduled({}, { GH_DISPATCH_TOKEN: TOKEN }, {});
    assert.equal(calls.length, 2);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^dispatch 500 /);
    assert.equal(logs[0].length <= "dispatch 500 ".length + 300, true);
    assert.equal(logs[0].includes(TOKEN), false);
  } finally {
    restore();
  }
});

test("fetch has no public route", async () => {
  const response = await worker.fetch(new Request("https://timer.example/"));
  assert.equal(response.status, 404);
});

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function mockIo(logs, calls, fetchImpl) {
  const originalLog = console.log;
  const originalFetch = globalThis.fetch;
  console.log = (...args) => logs.push(args.map(String).join(" "));
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  };
  return () => {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
  };
}
