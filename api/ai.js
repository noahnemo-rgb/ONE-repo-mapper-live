import { createMemoryRateLimit, createNodeAiProxy } from "../vendor/ai-buffer/proxy.js";
import { DEFAULT_GEMINI_MODEL } from "../vendor/ai-buffer/gemini.js";
import { DEFAULT_LLMAPI_MODEL } from "../vendor/ai-buffer/llmapi.js";
import { DEFAULT_MODEL } from "../vendor/ai-buffer/messages.js";
import { DEFAULT_NVIDIA_MODEL } from "../vendor/ai-buffer/nvidia.js";
import { SPACE_BUNNY_MODEL } from "../vendor/ai-buffer/space-bunny.js";
import { DEFAULT_VERCEL_GATEWAY_MODEL } from "../vendor/ai-buffer/vercel-gateway.js";
import { AI_RELAY_ORIGINS, VERCEL_ORIGIN } from "../ai-config.js";

export const ALLOWED_ORIGINS = AI_RELAY_ORIGINS;

export const ALLOWED_PROVIDERS = [
  "openrouter",
  "space-bunny",
  "vercel-gateway",
  "gemini",
  "nvidia",
  "llmapi",
];

export const ALLOWED_MODELS = {
  openrouter: [DEFAULT_MODEL],
  "space-bunny": [SPACE_BUNNY_MODEL],
  "vercel-gateway": [DEFAULT_VERCEL_GATEWAY_MODEL],
  gemini: [DEFAULT_GEMINI_MODEL],
  nvidia: [DEFAULT_NVIDIA_MODEL],
  llmapi: [DEFAULT_LLMAPI_MODEL],
};

function originOf(req) {
  const value = req.headers?.origin ?? req.headers?.Origin;
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
}

function applyCors(req, res, allowedOrigins) {
  const origin = originOf(req);
  if (!origin || !allowedOrigins.includes(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function createRepoAiProxy(overrides = {}) {
  const allowedOrigins = overrides.allowedOrigins ?? ALLOWED_ORIGINS;
  const proxy = createNodeAiProxy({
    allowedOrigins,
    allowMissingOrigin: false,
    providers: ALLOWED_PROVIDERS,
    models: ALLOWED_MODELS,
    rateLimit: overrides.rateLimit ?? createMemoryRateLimit({ limit: 30, windowMs: 60_000 }),
    env: overrides.env,
    fetchImpl: overrides.fetchImpl,
    allowByok: true,
    appName: "Repo Mapper",
    siteUrl: VERCEL_ORIGIN,
  });
  return async function handler(req, res) {
    applyCors(req, res, allowedOrigins);
    if (req.method === "OPTIONS") {
      res.statusCode = originOf(req) && allowedOrigins.includes(originOf(req)) ? 204 : 403;
      res.end();
      return;
    }
    await proxy(req, res);
  };
}

const handler = createRepoAiProxy();
export default handler;
