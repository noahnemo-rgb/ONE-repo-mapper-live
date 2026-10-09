import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRateLimit } from "./vendor/ai-buffer/proxy.js";
import { createLocalStorageStore, createOpenRouterKeyStore } from "./vendor/ai-buffer/index.js";
import {
  AI_RELAY_URL,
  PAGES_ORIGIN,
  VERCEL_ORIGIN,
  askMapper,
  createMapperKeyRing,
  mapperCallOrder,
  purgePersistedAiKeys,
  repoNotes,
  resolveAiRelayUrl,
} from "./ai-route.js";
import { ALLOWED_ORIGINS, createRepoAiProxy } from "./api/ai.js";

function sse(text) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\ndata: [DONE]\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("notes name the repo and a key file", () => {
  const notes = repoNotes({
    repo: { fullName: "noahnemo-rgb/ONE-repo-mapper-live", description: "Map", language: "JavaScript" },
    critical: [{ path: "app-static.js", snippet: "const GH_API" }],
  });
  assert.match(notes, /ONE-repo-mapper-live/);
  assert.match(notes, /app-static\.js/);
});

test("a saved key tries Space Bunny Alpha, then gpt-4o-mini", async () => {
  const models = [];
  const text = await askMapper({
    apiKey: "sk-test",
    question: "What is the entry file?",
    current: { repo: { fullName: "owner/repo" }, critical: [] },
    loadPuter: async () => {
      throw new Error("puter unavailable");
    },
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      models.push(payload.model);
      if (models.length === 1) return new Response("slow down", { status: 429 });
      return sse("app-static.js");
    },
  });
  assert.equal(text, "app-static.js");
  assert.deepEqual(models, ["stealth/space-bunny-alpha", "openai/gpt-4o-mini"]);
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => {
      values.set(key, String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

test("raw keys are removed from storage and a memory key returns a masked hint", async () => {
  const local = memoryStorage({
    repomapper_openrouter_key: "sk-or-old-secret-value",
    "ai-buffer.active_provider": "gemini",
    "ai-buffer.model.gemini": "gemini-3.8-flash",
    "ai-buffer.gemini_key": "AIzaStoredKey1234",
  });
  const session = memoryStorage({ "ai-buffer.openrouter_key": "sk-or-session-secret" });
  purgePersistedAiKeys(local, session);
  assert.equal(local.getItem("repomapper_openrouter_key"), null);
  assert.equal(local.getItem("ai-buffer.gemini_key"), null);
  assert.equal(session.getItem("ai-buffer.openrouter_key"), null);
  assert.equal(local.getItem("ai-buffer.active_provider"), "gemini");
  assert.equal(local.getItem("ai-buffer.model.gemini"), "gemini-3.8-flash");

  const ring = createMapperKeyRing();
  await ring.setKey("openrouter", "sk-or-v1-abcdefghij");
  assert.equal(local.getItem("ai-buffer.openrouter_key"), null);
  assert.equal(session.getItem("ai-buffer.openrouter_key"), null);
  assert.equal(await ring.hint("openrouter"), "••••ghij");
  assert.equal(await ring.hint("space-bunny"), "••••ghij");
  assert.equal(await ring.getKey("space-bunny"), "sk-or-v1-abcdefghij");
  assert.throws(() => createOpenRouterKeyStore(createLocalStorageStore(memoryStorage())));
});

test("Puter stays first, then the selected provider, and Pages uses the Vercel relay", () => {
  assert.deepEqual(mapperCallOrder(null), [
    "puter",
    "space-bunny",
    "openrouter",
    "vercel-gateway",
    "gemini",
    "nvidia",
    "llmapi",
  ]);
  assert.equal(mapperCallOrder({ provider: "gemini", model: "gemini-3.8-flash" })[0], "puter");
  assert.equal(mapperCallOrder({ provider: "gemini", model: "gemini-3.8-flash" })[1], "gemini");
  assert.deepEqual(ALLOWED_ORIGINS, [VERCEL_ORIGIN, PAGES_ORIGIN]);
  assert.equal(resolveAiRelayUrl(PAGES_ORIGIN), AI_RELAY_URL);
  assert.equal(resolveAiRelayUrl(VERCEL_ORIGIN), AI_RELAY_URL);
});

test("without a browser key the relay is tried after Puter and does not receive a key", async () => {
  const calls = [];
  const text = await askMapper({
    question: "What is the entry file?",
    current: { repo: { fullName: "owner/repo" }, critical: [] },
    selection: { provider: "gemini", model: "gemini-3.8-flash" },
    loadPuter: async () => {
      throw new Error("puter unavailable");
    },
    fetchImpl: async (input, init) => {
      const payload = JSON.parse(String(init?.body));
      calls.push({ url: String(input), payload, headers: init?.headers });
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ error: { code: "rate_limited", message: "Too many AI requests. Wait a few seconds and try again." } }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(`data: ${JSON.stringify({ text: "app-static.js" })}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  assert.equal(text, "app-static.js");
  assert.equal(calls[0].url, AI_RELAY_URL);
  assert.equal(calls[0].payload.provider, "gemini");
  assert.equal(calls[0].payload.model, "gemini-3.8-flash");
  assert.equal(calls[0].payload.byok, undefined);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[1].payload.provider, "space-bunny");
  assert.equal(calls[1].payload.model, "stealth/space-bunny-alpha");
});

test("a memory key calls NVIDIA NIM directly after the relay misses", async () => {
  const urls = [];
  const text = await askMapper({
    keys: { nvidia: "nvapi-test-key-12345678" },
    question: "What is the entry file?",
    current: { repo: { fullName: "owner/repo" }, critical: [] },
    loadPuter: async () => {
      throw new Error("puter unavailable");
    },
    fetchImpl: async (input, init) => {
      const url = String(input);
      urls.push(url);
      const payload = JSON.parse(String(init?.body));
      if (url.startsWith(AI_RELAY_URL)) {
        return new Response(JSON.stringify({ error: { code: "missing_key", message: "API key is not configured on the server." } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      assert.equal(payload.model, "nvidia/nemotron-3-nano-30b-a3b");
      assert.match(init.headers.Authorization, /^Bearer nvapi-/);
      return sse("nemotron");
    },
  });
  assert.equal(text, "nemotron");
  assert.equal(urls.filter((url) => url.startsWith(AI_RELAY_URL)).length, 4);
  assert.match(urls.at(-1), /integrate\.api\.nvidia\.com/);
});

async function callRelay(handler, { method = "POST", origin, body, headers = {} }) {
  const req = {
    method,
    url: "/api/ai",
    headers: {
      host: "repo-mapper-live-8trm.vercel.app",
      origin,
      "content-type": "application/json",
      ...headers,
    },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    },
  };
  const headerMap = {};
  const chunks = [];
  const res = {
    statusCode: 0,
    setHeader(name, value) {
      headerMap[name.toLowerCase()] = value;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
    },
    end() {},
  };
  await handler(req, res);
  return { status: res.statusCode, headers: headerMap, text: Buffer.concat(chunks).toString("utf8") };
}

test("the relay checks origin, the model allowlist, and the rate-limit hook", async () => {
  let fetched = 0;
  const handler = createRepoAiProxy({
    env: {},
    fetchImpl: async () => {
      fetched += 1;
      throw new Error("provider fetch");
    },
    rateLimit: createMemoryRateLimit({ limit: 1, windowMs: 60_000 }),
  });
  const foreign = await callRelay(handler, {
    origin: "https://evil.example",
    body: { provider: "openrouter", model: "openai/gpt-4o-mini", message: "hi" },
  });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers["access-control-allow-origin"], undefined);

  const preflight = await callRelay(handler, { method: "OPTIONS", origin: PAGES_ORIGIN });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], PAGES_ORIGIN);

  const model = await callRelay(handler, {
    origin: VERCEL_ORIGIN,
    body: { provider: "openrouter", model: "openai/gpt-4o", message: "hi" },
  });
  assert.equal(model.status, 400);
  assert.match(model.text, /Model is not allowed/);

  const first = await callRelay(handler, {
    origin: VERCEL_ORIGIN,
    body: { provider: "gemini", model: "gemini-3.8-flash", message: "hi" },
  });
  assert.equal(first.status, 400);
  assert.match(first.text, /missing_key|not configured/);
  const second = await callRelay(handler, {
    origin: VERCEL_ORIGIN,
    body: { provider: "gemini", model: "gemini-3.8-flash", message: "hi" },
  });
  assert.equal(second.status, 429);
  assert.equal(fetched, 0);
});

test("the relay uses the owner key, keeps a user key out of the response, and does not put a Gemini key in the URL", async () => {
  const owner = "sk-or-owner-secretvalue";
  const byok = "sk-or-user-byokvalue12";
  const geminiKey = "AIzaSyTestKeyValue123456";
  let openrouterCall;
  const openrouter = createRepoAiProxy({
    env: { OPENROUTER_API_KEY: owner },
    fetchImpl: async (url, init) => {
      openrouterCall = { url: String(url), headers: init.headers, body: String(init.body) };
      return sse("mapped");
    },
  });
  const relayed = await callRelay(openrouter, {
    origin: PAGES_ORIGIN,
    body: { provider: "openrouter", model: "openai/gpt-4o-mini", message: "hi", byok },
  });
  assert.equal(relayed.status, 200);
  assert.equal(relayed.headers["access-control-allow-origin"], PAGES_ORIGIN);
  assert.match(relayed.text, /mapped/);
  assert.equal(relayed.text.includes(owner), false);
  assert.equal(relayed.text.includes(byok), false);
  assert.equal(openrouterCall.headers.Authorization, `Bearer ${byok}`);
  assert.equal(openrouterCall.body.includes(byok), false);

  let geminiCall;
  const gemini = createRepoAiProxy({
    env: { GEMINI_API_KEY: geminiKey },
    fetchImpl: async (url, init) => {
      geminiCall = { url: String(url), headers: init.headers };
      const payload = { candidates: [{ content: { parts: [{ text: "gemini-ok" }] } }] };
      return new Response(`data: ${JSON.stringify(payload)}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const geminiResponse = await callRelay(gemini, {
    origin: VERCEL_ORIGIN,
    body: { provider: "gemini", model: "gemini-3.8-flash", message: "hi" },
  });
  assert.equal(geminiResponse.status, 200);
  assert.match(geminiResponse.text, /gemini-ok/);
  assert.equal(geminiResponse.text.includes(geminiKey), false);
  assert.equal(geminiCall.url.includes(geminiKey), false);
  assert.equal(geminiCall.url.includes("key="), false);
  assert.equal(geminiCall.headers["x-goog-api-key"], geminiKey);
});
