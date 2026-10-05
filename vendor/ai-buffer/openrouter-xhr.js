import { openRouterHttpError } from "./errors.js";
import { OPENROUTER_URL, openRouterRequestBody } from "./openrouter-shared.js";
import { drainOpenRouterSse } from "./sse.js";
function abortError() {
    const error = new Error("The AI request was cancelled.");
    error.name = "AbortError";
    return error;
}
/**
 * React Native's fetch often delivers the body only after it finishes.
 * XMLHttpRequest `onprogress` is what a phone app uses to show tokens as they arrive.
 */
export function streamOpenRouterXhr(options) {
    if (options.signal?.aborted)
        return Promise.reject(abortError());
    const XHR = globalThis.XMLHttpRequest;
    if (!XHR) {
        return Promise.reject(new Error('XMLHttpRequest is not available. Use transport: "fetch" in browsers and Node.'));
    }
    return new Promise((resolve, reject) => {
        const xhr = new XHR();
        xhr.open("POST", OPENROUTER_URL);
        xhr.setRequestHeader("Authorization", `Bearer ${options.apiKey.trim()}`);
        xhr.setRequestHeader("Content-Type", "application/json");
        if (options.siteUrl)
            xhr.setRequestHeader("HTTP-Referer", options.siteUrl);
        if (options.appName)
            xhr.setRequestHeader("X-Title", options.appName);
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
            const drained = drainOpenRouterSse(raw, parsedThrough);
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
                    fail(openRouterHttpError(xhr.status, raw));
            }
            catch (error) {
                fail(error);
            }
        };
        xhr.onerror = () => fail(new Error("OpenRouter network error"));
        xhr.onabort = () => fail(abortError());
        options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(openRouterRequestBody(options));
    });
}
