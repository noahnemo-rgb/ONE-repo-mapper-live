import { anySignal } from "./abort.js";
import { AiBufferError, openRouterHttpError } from "./errors.js";
import { readOpenRouterSse } from "./sse.js";
import { streamOpenRouterXhr } from "./openrouter-xhr.js";
import { OPENROUTER_URL, openRouterRequestBody } from "./openrouter-shared.js";
export { OPENROUTER_URL };
export async function streamOpenRouter(options) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) {
        throw new AiBufferError("missing_key", "OpenRouter API key is not set. Add a key on this device, or set OPENROUTER_API_KEY on the server.");
    }
    const signal = combinedSignal(options);
    const linked = { ...options, signal };
    if (options.transport === "xhr") {
        return streamOpenRouterXhr(linked);
    }
    return streamOpenRouterFetch(linked);
}
function combinedSignal(options) {
    const parts = [options.signal, options.timeoutSignal].filter((signal) => Boolean(signal));
    if (parts.length === 0)
        return undefined;
    return anySignal(parts);
}
async function streamOpenRouterFetch(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const headers = {
        Authorization: `Bearer ${options.apiKey.trim()}`,
        "Content-Type": "application/json",
    };
    if (options.siteUrl)
        headers["HTTP-Referer"] = options.siteUrl;
    if (options.appName)
        headers["X-Title"] = options.appName;
    const response = await fetchImpl(OPENROUTER_URL, {
        method: "POST",
        headers,
        body: openRouterRequestBody(options),
        signal: options.signal,
    });
    if (!response.ok) {
        const body = await response.text();
        throw openRouterHttpError(response.status, body);
    }
    if (!response.body) {
        throw new Error("OpenRouter returned an empty response.");
    }
    return readOpenRouterSse(response.body, (text) => options.onChunk?.(text));
}
