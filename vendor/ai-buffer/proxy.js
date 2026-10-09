import { streamChatCompletions, streamSsePost } from "./chat-completions.js";
import { asAiError } from "./errors.js";
import { drainGeminiSse, geminiRequestBody, geminiStreamUrl } from "./gemini.js";
import { LLMAPI_URL } from "./llmapi.js";
import { buildMessages, buildUserText } from "./messages.js";
import { NVIDIA_URL } from "./nvidia.js";
import { OPENROUTER_URL } from "./openrouter.js";
import { isAiProviderId } from "./providers.js";
import { looksLikeSecret, redactSecrets } from "./redact.js";
import { SPACE_BUNNY_MODEL, spaceBunnyExtra } from "./space-bunny.js";
import { VERCEL_GATEWAY_URL } from "./vercel-gateway.js";
/** Providers that can run behind the server proxy. Puter stays in the browser. */
export const SERVER_PROXY_PROVIDERS = [
    "openrouter",
    "space-bunny",
    "vercel-gateway",
    "gemini",
    "nvidia",
    "llmapi",
];
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,200}$/;
export function createMemoryRateLimit(options) {
    const limit = options?.limit ?? 30;
    const windowMs = options?.windowMs ?? 60_000;
    const hits = new Map();
    return function allow(caller) {
        const id = `${caller.userId ?? caller.ip ?? "unknown"}:${caller.provider}`;
        const now = Date.now();
        const recent = (hits.get(id) ?? []).filter((time) => now - time < windowMs);
        if (recent.length >= limit) {
            hits.set(id, recent);
            return false;
        }
        recent.push(now);
        hits.set(id, recent);
        return true;
    };
}
export function readOwnerApiKey(provider, env) {
    const pick = (name) => {
        const value = env[name]?.trim();
        return value ? value : null;
    };
    switch (provider) {
        case "openrouter":
        case "space-bunny":
            return pick("OPENROUTER_API_KEY");
        case "vercel-gateway":
            return pick("AI_GATEWAY_API_KEY") ?? pick("VERCEL_OIDC_TOKEN");
        case "gemini":
            return pick("GEMINI_API_KEY");
        case "nvidia":
            return pick("NVIDIA_API_KEY");
        case "llmapi":
            return pick("LLM_API_KEY");
        default: {
            const never = provider;
            return never;
        }
    }
}
export function createAiProxy(options) {
    const allowed = new Set(options.providers ?? SERVER_PROXY_PROVIDERS);
    return async function handle(request) {
        if (request.method !== "POST")
            return jsonError(405, "provider_error", "Method is not allowed.");
        const originError = checkOrigin(request, options.allowedOrigins, options.allowMissingOrigin);
        if (originError)
            return originError;
        let payload;
        try {
            payload = (await request.json());
        }
        catch {
            return jsonError(400, "provider_error", "Request body is not valid JSON.");
        }
        const provider = readProvider(payload.provider, allowed);
        if (!provider)
            return jsonError(400, "provider_error", "Provider is not allowed.");
        const model = readModel(provider, payload.model, options.models);
        if (!model)
            return jsonError(400, "provider_error", "Model is not allowed.");
        const userId = options.resolveUser ? (await options.resolveUser(request))?.trim() || null : null;
        const ip = options.clientIp?.(request) ?? requestIp(request);
        if (options.rateLimit) {
            const permitted = await options.rateLimit({ ip, userId, provider });
            if (!permitted) {
                return jsonError(429, "rate_limited", "Too many AI requests. Wait a few seconds and try again.");
            }
        }
        const byok = options.allowByok === false || typeof payload.byok !== "string" ? "" : payload.byok.trim();
        let apiKey = byok;
        if (!apiKey && options.vault && userId) {
            apiKey = (await options.vault.read(userId, provider))?.trim() ?? "";
        }
        if (!apiKey) {
            const env = options.env ?? process.env;
            const owner = options.readOwnerKey ? await options.readOwnerKey(provider) : readOwnerApiKey(provider, env);
            apiKey = owner?.trim() ?? "";
        }
        if (!apiKey)
            return jsonError(400, "missing_key", "API key is not configured on the server.");
        let messages;
        try {
            messages = readMessages(payload);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Request messages are not valid.";
            return jsonError(400, "provider_error", message);
        }
        return streamResponse({
            provider,
            model,
            messages,
            apiKey,
            appName: options.appName,
            siteUrl: options.siteUrl,
            fetchImpl: options.fetchImpl,
        });
    };
}
/** Accepts a user key once and returns `{ configured, hint }`. The full key is not in the response. */
export function createVaultHandler(options) {
    return async function handle(request) {
        const originError = checkOrigin(request, options.allowedOrigins, options.allowMissingOrigin);
        if (originError)
            return originError;
        const userId = (await options.resolveUser(request))?.trim() || "";
        if (!userId)
            return jsonError(401, "signed_out", "Sign in required.");
        const ip = options.clientIp?.(request) ?? requestIp(request);
        if (request.method === "GET" || request.method === "DELETE") {
            const provider = new URL(request.url).searchParams.get("provider")?.trim() ?? "";
            if (!isServerProvider(provider))
                return jsonError(400, "provider_error", "Provider is not allowed.");
            if (options.rateLimit) {
                const permitted = await options.rateLimit({ ip, userId, provider });
                if (!permitted)
                    return jsonError(429, "rate_limited", "Too many AI requests. Wait a few seconds and try again.");
            }
            if (request.method === "DELETE") {
                await options.vault.delete(userId, provider);
                return jsonStatus({ configured: false, hint: "" });
            }
            return jsonStatus(await options.vault.status(userId, provider));
        }
        if (request.method !== "POST")
            return jsonError(405, "provider_error", "Method is not allowed.");
        let payload;
        try {
            payload = (await request.json());
        }
        catch {
            return jsonError(400, "provider_error", "Request body is not valid JSON.");
        }
        const provider = typeof payload.provider === "string" ? payload.provider.trim() : "";
        if (!isServerProvider(provider))
            return jsonError(400, "provider_error", "Provider is not allowed.");
        if (options.rateLimit) {
            const permitted = await options.rateLimit({ ip, userId, provider });
            if (!permitted)
                return jsonError(429, "rate_limited", "Too many AI requests. Wait a few seconds and try again.");
        }
        const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
        if (!apiKey)
            return jsonError(400, "missing_key", "API key is not configured on the server.");
        try {
            return jsonStatus(await options.vault.put(userId, provider, apiKey));
        }
        catch {
            return jsonError(400, "provider_error", "The key could not be stored.");
        }
    };
}
/** Node `http` listener. Mount it on the route that browsers call. */
export function createNodeAiProxy(options) {
    const handle = createAiProxy(options);
    return async function nodeHandler(req, res) {
        await writeNodeResponse(req, res, handle);
    };
}
export function createNodeVaultHandler(options) {
    const handle = createVaultHandler(options);
    return async function nodeHandler(req, res) {
        await writeNodeResponse(req, res, handle);
    };
}
function isServerProvider(value) {
    return SERVER_PROXY_PROVIDERS.includes(value);
}
function readProvider(value, allowed) {
    if (typeof value !== "string")
        return null;
    const id = value.trim();
    if (!isAiProviderId(id) || id === "puter" || !allowed.has(id))
        return null;
    return id;
}
function readModel(provider, value, allowlist) {
    const model = provider === "space-bunny" ? SPACE_BUNNY_MODEL : typeof value === "string" ? value.trim() : "";
    if (!model || !MODEL_ID.test(model) || looksLikeSecret(model))
        return null;
    const list = allowlist?.[provider];
    if (list && !list.includes(model))
        return null;
    return model;
}
function readMessages(payload) {
    if (Array.isArray(payload.messages)) {
        const messages = [];
        for (const item of payload.messages) {
            if (!item || typeof item !== "object")
                throw new Error("Request messages are not valid.");
            const role = item.role;
            const content = item.content;
            if ((role !== "system" && role !== "user" && role !== "assistant") || typeof content !== "string") {
                throw new Error("Request messages are not valid.");
            }
            messages.push({ role, content });
        }
        if (!messages.length)
            throw new Error("Request messages are not valid.");
        return messages;
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
        const history = Array.isArray(payload.history) ? payload.history : [];
        return buildMessages({
            systemPrompt: typeof payload.systemPrompt === "string" ? payload.systemPrompt : undefined,
            history,
            userText: buildUserText(payload.message, typeof payload.context === "string" ? payload.context : undefined),
        });
    }
    throw new Error("Request messages are not valid.");
}
async function streamResponse(input) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (value) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
            };
            try {
                if (input.provider === "gemini") {
                    await streamSsePost({
                        url: geminiStreamUrl(input.model),
                        headers: {
                            "Content-Type": "application/json",
                            Accept: "text/event-stream",
                            "x-goog-api-key": input.apiKey,
                        },
                        body: geminiRequestBody(input.messages),
                        providerName: "Gemini API",
                        fetchImpl: input.fetchImpl,
                        onChunk: (text) => send({ text }),
                        drain: drainGeminiSse,
                    });
                }
                else {
                    await streamChatCompletions({
                        url: urlFor(input.provider),
                        apiKey: input.apiKey,
                        model: input.model,
                        messages: input.messages,
                        providerName: input.provider,
                        missingKeyMessage: "API key is not configured on the server.",
                        siteUrl: input.siteUrl,
                        appName: input.appName,
                        fetchImpl: input.fetchImpl,
                        onChunk: (text) => send({ text }),
                        extra: input.provider === "space-bunny" ? spaceBunnyExtra() : undefined,
                    });
                }
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
            }
            catch (error) {
                const ai = asAiError(error);
                send({ error: { code: ai.code, message: ai.message } });
                controller.close();
            }
        },
    });
    return new Response(stream, {
        status: 200,
        headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
        },
    });
}
function urlFor(provider) {
    switch (provider) {
        case "openrouter":
        case "space-bunny":
            return OPENROUTER_URL;
        case "vercel-gateway":
            return VERCEL_GATEWAY_URL;
        case "nvidia":
            return NVIDIA_URL;
        case "llmapi":
            return LLMAPI_URL;
        default: {
            const never = provider;
            return never;
        }
    }
}
function checkOrigin(request, allowedOrigins, allowMissingOrigin) {
    const origin = request.headers.get("origin");
    if (origin) {
        return allowedOrigins.includes(origin) ? null : jsonError(403, "provider_error", "Origin is not allowed.");
    }
    return allowMissingOrigin ? null : jsonError(403, "provider_error", "Origin is not allowed.");
}
function requestIp(request) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (!forwarded)
        return null;
    return forwarded.split(",")[0]?.trim() || null;
}
function jsonError(status, code, message) {
    return new Response(JSON.stringify({ error: { code, message: redactSecrets(message) } }), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
}
function jsonStatus(status) {
    return new Response(JSON.stringify({ configured: status.configured, hint: status.hint }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
}
async function writeNodeResponse(req, res, handle) {
    const host = req.headers.host ?? "localhost";
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined)
            continue;
        if (Array.isArray(value)) {
            for (const item of value)
                headers.append(key, item);
        }
        else {
            headers.set(key, value);
        }
    }
    const request = new Request(`http://${host}${req.url ?? "/"}`, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
        if (key === "transfer-encoding")
            return;
        res.setHeader(key, value);
    });
    if (!response.body) {
        res.end();
        return;
    }
    const reader = response.body.getReader();
    while (true) {
        const step = await reader.read();
        if (step.done)
            break;
        res.write(Buffer.from(step.value));
    }
    res.end();
}
