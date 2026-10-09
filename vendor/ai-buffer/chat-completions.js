import { anySignal } from "./abort.js";
import { AiBufferError, providerHttpError } from "./errors.js";
import { drainOpenRouterSse, readSse } from "./sse.js";
export function chatCompletionBody(options) {
    return JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: true,
        ...options.extra,
    });
}
export async function streamChatCompletions(options) {
    const apiKey = options.apiKey.trim();
    if (!apiKey)
        throw new AiBufferError("missing_key", options.missingKeyMessage);
    const signal = combinedSignal(options);
    return streamSsePost({
        url: options.url,
        headers: completionHeaders(options, apiKey),
        body: chatCompletionBody(options),
        transport: options.transport,
        signal,
        fetchImpl: options.fetchImpl,
        onChunk: options.onChunk,
        drain: (fullText, parsedThrough) => drainOpenRouterSse(fullText, parsedThrough, options.providerName),
        providerName: options.providerName,
    });
}
function completionHeaders(options, apiKey) {
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...options.extraHeaders,
    };
    if (options.siteUrl)
        headers["HTTP-Referer"] = options.siteUrl;
    if (options.appName)
        headers["X-Title"] = options.appName;
    return headers;
}
function combinedSignal(options) {
    const parts = [options.signal, options.timeoutSignal].filter((signal) => Boolean(signal));
    if (parts.length === 0)
        return undefined;
    return anySignal(parts);
}
export async function streamSsePost(options) {
    const signal = combinePostSignals(options);
    const linked = signal === options.signal ? options : { ...options, signal };
    if (linked.transport === "xhr")
        return streamSseXhr(linked);
    return streamSseFetch(linked);
}
function combinePostSignals(options) {
    const parts = [options.signal, options.timeoutSignal].filter((signal) => Boolean(signal));
    if (parts.length === 0)
        return undefined;
    return anySignal(parts);
}
async function streamSseFetch(options) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(options.url, {
        method: "POST",
        headers: options.headers,
        body: options.body,
        signal: options.signal,
    });
    if (!response.ok) {
        const body = await response.text();
        throw providerHttpError(options.providerName, response.status, body);
    }
    if (!response.body) {
        throw new Error(`${options.providerName} returned an empty response.`);
    }
    return readSse(response.body, (text) => options.onChunk?.(text), options.drain);
}
function abortError() {
    const error = new Error("The AI request was cancelled.");
    error.name = "AbortError";
    return error;
}
function streamSseXhr(options) {
    if (options.signal?.aborted)
        return Promise.reject(abortError());
    const XHR = globalThis.XMLHttpRequest;
    if (!XHR) {
        return Promise.reject(new Error('XMLHttpRequest is not available. Use transport: "fetch" in browsers and Node.'));
    }
    return new Promise((resolve, reject) => {
        const xhr = new XHR();
        xhr.open("POST", options.url);
        for (const [name, value] of Object.entries(options.headers)) {
            xhr.setRequestHeader(name, value);
        }
        let parsedThrough = 0;
        let full = "";
        let settled = false;
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            reject(error instanceof Error ? error : new Error(String(error)));
        };
        const succeed = (text) => {
            if (settled)
                return;
            settled = true;
            resolve(text);
        };
        const apply = (raw) => {
            const drained = options.drain(raw, parsedThrough);
            parsedThrough = drained.parsedThrough;
            if (drained.text) {
                full += drained.text;
                options.onChunk?.(drained.text);
            }
        };
        xhr.onprogress = () => {
            try {
                apply(xhr.responseText ?? "");
            }
            catch (error) {
                fail(error);
                xhr.abort();
            }
        };
        xhr.onload = () => {
            try {
                const raw = xhr.responseText ?? "";
                apply(raw.endsWith("\n") ? raw : `${raw}\n`);
                if (xhr.status >= 200 && xhr.status < 300)
                    succeed(full);
                else
                    fail(providerHttpError(options.providerName, xhr.status, raw));
            }
            catch (error) {
                fail(error);
            }
        };
        xhr.onerror = () => fail(new Error(`${options.providerName} network error`));
        xhr.onabort = () => fail(abortError());
        options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(options.body);
    });
}
