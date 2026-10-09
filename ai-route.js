// Pinned to ai-buffer v0.4.0 (tag v0.4.0, commit b62ba5050643a7bf6e1e7da72b74f8bcbfc028a6).
import {
  AiBufferError,
  asAiError,
  createCallRouter,
  createMemoryStore,
  createProviderKeyStore,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_LLMAPI_MODEL,
  DEFAULT_MODEL,
  DEFAULT_NVIDIA_MODEL,
  DEFAULT_VERCEL_GATEWAY_MODEL,
  maskKeyHint,
  PROVIDER_KEY_NAMES,
  SPACE_BUNNY_MODEL,
} from "./vendor/ai-buffer/index.js";
import { AI_RELAY_ORIGINS, AI_RELAY_URL, PAGES_ORIGIN, VERCEL_ORIGIN } from "./ai-config.js";

export { AI_RELAY_ORIGINS, AI_RELAY_URL, PAGES_ORIGIN, VERCEL_ORIGIN };

const SITE = VERCEL_ORIGIN;

/** Puter first. The rest follow the ai-buffer catalog, Space Bunny Alpha before OpenRouter. */
export const MAPPER_CALL_ORDER = [
  "puter",
  "space-bunny",
  "openrouter",
  "vercel-gateway",
  "gemini",
  "nvidia",
  "llmapi",
];

const SERVER_PROVIDERS = MAPPER_CALL_ORDER.filter((id) => id !== "puter");

const FAILOVER_CODES = new Set([
  "missing_key",
  "signed_out",
  "rate_limited",
  "payment_required",
  "provider_error",
]);

const DEFAULT_MODELS = {
  puter: DEFAULT_MODEL,
  openrouter: DEFAULT_MODEL,
  "space-bunny": SPACE_BUNNY_MODEL,
  "vercel-gateway": DEFAULT_VERCEL_GATEWAY_MODEL,
  gemini: DEFAULT_GEMINI_MODEL,
  nvidia: DEFAULT_NVIDIA_MODEL,
  llmapi: DEFAULT_LLMAPI_MODEL,
};

/** Names that used to hold a raw provider key. Selection ids are not in this list. */
export const PERSISTED_AI_KEY_NAMES = [
  "repomapper_openrouter_key",
  ...new Set(Object.values(PROVIDER_KEY_NAMES)),
];

const SYSTEM_PROMPT =
  "You explain a GitHub repo to the person mapping it. Be concrete and short. Stay with the notes you were given.";

export function repoNotes(current) {
  const repo = current?.repo || {};
  const files = (current?.critical || [])
    .slice(0, 4)
    .map((file) => `${file.path}\n${String(file.snippet || "").slice(0, 500)}`)
    .join("\n\n");
  return [
    `Repo: ${repo.fullName || "unknown"}`,
    `Description: ${repo.description || ""}`,
    `Language: ${repo.language || ""}`,
    "",
    "Key files:",
    files,
  ].join("\n");
}

export function resolveAiRelayUrl(pageOrigin, explicit) {
  if (explicit) return explicit;
  if (pageOrigin === VERCEL_ORIGIN) return `${pageOrigin}/api/ai`;
  return AI_RELAY_URL;
}

export function mapperCallOrder(selection) {
  const chosen = selection?.provider;
  if (!chosen || chosen === "puter" || !SERVER_PROVIDERS.includes(chosen)) {
    return [...MAPPER_CALL_ORDER];
  }
  return ["puter", chosen, ...SERVER_PROVIDERS.filter((id) => id !== chosen)];
}

export function purgePersistedAiKeys(
  localStorage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage,
) {
  for (const bin of [localStorage, sessionStorage]) {
    if (!bin) continue;
    for (const name of PERSISTED_AI_KEY_NAMES) bin.removeItem(name);
  }
}

export function createMapperKeyRing(store = createMemoryStore()) {
  const stores = {};
  for (const id of SERVER_PROVIDERS) stores[id] = createProviderKeyStore(store, id);
  return {
    getKey: (id) => stores[id].getKey(),
    setKey: (id, value) => stores[id].setKey(value),
    clearKey: (id) => stores[id].clearKey(),
    async hint(id) {
      return maskKeyHint((await stores[id].getKey()) || "");
    },
    async keys() {
      const out = {};
      for (const id of SERVER_PROVIDERS) {
        const value = await stores[id].getKey();
        if (value) out[id] = value;
      }
      return out;
    },
    async probe() {
      const openrouter = (await stores.openrouter.getKey()) || "";
      const gateway = (await stores["vercel-gateway"].getKey()) || "";
      const gemini = (await stores.gemini.getKey()) || "";
      const nvidia = (await stores.nvidia.getKey()) || "";
      const llmapi = (await stores.llmapi.getKey()) || "";
      return {
        openrouterKey: Boolean(openrouter),
        gatewayKey: Boolean(gateway),
        geminiKey: Boolean(gemini),
        nvidiaKey: Boolean(nvidia),
        llmapiKey: Boolean(llmapi),
        keyHints: {
          openrouter,
          "space-bunny": openrouter,
          "vercel-gateway": gateway,
          gemini,
          nvidia,
          llmapi,
        },
      };
    },
  };
}

function normalizeKeys({ apiKey, keys }) {
  const out = {};
  if (keys) {
    for (const [id, value] of Object.entries(keys)) {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (trimmed && SERVER_PROVIDERS.includes(id)) out[id] = trimmed;
    }
  }
  const legacy = typeof apiKey === "string" ? apiKey.trim() : "";
  if (legacy) {
    if (!out.openrouter) out.openrouter = legacy;
    if (!out["space-bunny"]) out["space-bunny"] = legacy;
  } else if (out.openrouter && !out["space-bunny"]) {
    out["space-bunny"] = out.openrouter;
  } else if (out["space-bunny"] && !out.openrouter) {
    out.openrouter = out["space-bunny"];
  }
  return out;
}

function modelFor(id, selection) {
  if (id === "space-bunny") return SPACE_BUNNY_MODEL;
  if (selection?.provider === id && selection.model?.trim()) return selection.model.trim();
  return DEFAULT_MODELS[id];
}

function directOptions(id, key, { fetchImpl, loadPuter, timeoutMs, selection }) {
  const model = modelFor(id, selection);
  const shared = {
    getApiKey: () => key,
    appName: "Repo Mapper",
    siteUrl: SITE,
    fetchImpl,
    timeoutMs,
    model,
  };
  switch (id) {
    case "puter":
      return { puter: { model, loadPuter, timeoutMs } };
    case "space-bunny":
      return { spaceBunny: shared };
    case "openrouter":
      return { openrouter: shared };
    case "vercel-gateway":
      return { vercelGateway: shared };
    case "gemini":
      return { gemini: shared };
    case "nvidia":
      return { nvidia: shared };
    case "llmapi":
      return { llmapi: shared };
    default:
      return {};
  }
}

async function streamOwnerProxy({ provider, model, relay, fetchImpl, message, systemPrompt, context }) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const response = await fetchFn(relay, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, model, message, systemPrompt, context }),
  });
  const raw = await response.text();
  if (!response.ok) {
    let code = "provider_error";
    let text = raw;
    if (response.status === 429) code = "rate_limited";
    if (response.status === 402) code = "payment_required";
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.error?.code === "string") code = parsed.error.code;
      if (typeof parsed?.error?.message === "string") text = parsed.error.message;
    } catch {
      text = raw;
    }
    throw new AiBufferError(code, text);
  }
  let full = "";
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    if (chunk?.error) {
      const code = typeof chunk.error.code === "string" ? chunk.error.code : "provider_error";
      const text = typeof chunk.error.message === "string" ? chunk.error.message : "";
      throw new AiBufferError(code, text);
    }
    if (typeof chunk?.text === "string") full += chunk.text;
  }
  return full;
}

/**
 * Puter first in the browser. A memory key calls that provider directly.
 * Providers without one go through the Vercel relay, which holds the owner keys.
 */
export function createMapperRouter({ apiKey, keys, fetchImpl, loadPuter, timeoutMs = 55000, proxyUrl, selection }) {
  const keyMap = normalizeKeys({ apiKey, keys });
  const order = mapperCallOrder(selection);
  const relay = proxyUrl || AI_RELAY_URL;
  const chatBase = { fetchImpl, loadPuter, timeoutMs, selection };
  return {
    order,
    async streamChat({ message, systemPrompt, context }) {
      let last;
      for (let index = 0; index < order.length; index += 1) {
        const id = order[index];
        const key = keyMap[id];
        const more = index < order.length - 1;
        try {
          if (id === "puter" || key) {
            const router = createCallRouter(directOptions(id, key, chatBase));
            return await router.streamChat({
              route: id,
              message,
              systemPrompt,
              context,
            });
          }
          return await streamOwnerProxy({
            provider: id,
            model: modelFor(id, selection),
            relay,
            fetchImpl,
            message,
            systemPrompt,
            context,
          });
        } catch (error) {
          const wrapped = asAiError(error);
          if (!FAILOVER_CODES.has(wrapped.code) || !more) throw wrapped;
          last = wrapped;
        }
      }
      throw asAiError(last ?? new AiBufferError("provider_error", "No call route is configured."));
    },
  };
}

export async function askMapper({
  apiKey,
  keys,
  current,
  question,
  fetchImpl,
  loadPuter,
  proxyUrl,
  selection,
  timeoutMs,
}) {
  const router = createMapperRouter({
    apiKey,
    keys,
    fetchImpl,
    loadPuter,
    proxyUrl,
    selection,
    timeoutMs: timeoutMs ?? 55000,
  });
  return router.streamChat({
    message: question,
    systemPrompt: SYSTEM_PROMPT,
    context: repoNotes(current),
  });
}
