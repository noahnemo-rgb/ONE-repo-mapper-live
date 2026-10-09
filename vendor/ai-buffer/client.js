import { haltError, raceAbort, startTimeout, DEFAULT_TIMEOUT_MS } from "./abort.js";
import { streamChatCompletions, streamSsePost } from "./chat-completions.js";
import { AiBufferError, asAiError } from "./errors.js";
import { drainGeminiSse, geminiRequestBody, geminiStreamUrl, GEMINI_MISSING_KEY, DEFAULT_GEMINI_MODEL } from "./gemini.js";
import { DEFAULT_NVIDIA_MODEL, NVIDIA_MISSING_KEY, NVIDIA_URL } from "./nvidia.js";
import { buildMessages, buildUserText, DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT } from "./messages.js";
import { DEFAULT_LLMAPI_MODEL, LLMAPI_MISSING_KEY, LLMAPI_URL } from "./llmapi.js";
import { streamOpenRouter } from "./openrouter.js";
import { providerLabel } from "./providers.js";
import { DEFAULT_SPACE_BUNNY_EFFORT, SPACE_BUNNY_MODEL, spaceBunnyExtra } from "./space-bunny.js";
import { extractPuterText, isAsyncIterable, loadPuterDefault, puterChunkError } from "./puter.js";
import { DEFAULT_VERCEL_GATEWAY_MODEL, VERCEL_GATEWAY_MISSING_KEY, VERCEL_GATEWAY_URL } from "./vercel-gateway.js";
function requireMessage(params) {
    if (!params.message.trim() && !params.context?.trim()) {
        throw new AiBufferError("empty_message", "Message is empty.");
    }
}
function messagesFor(params, defaultSystemPrompt) {
    requireMessage(params);
    return buildMessages({
        systemPrompt: params.systemPrompt ?? defaultSystemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        history: params.history,
        userText: buildUserText(params.message, params.context),
    });
}
function resolveTimeout(request, clientDefault) {
    if (request !== undefined)
        return request;
    if (clientDefault !== undefined)
        return clientDefault;
    return DEFAULT_TIMEOUT_MS;
}
async function readPuterStream(result, params, signals) {
    let full = "";
    const push = (text) => {
        if (!text)
            return;
        full += text;
        params.onChunk?.(text);
    };
    if (!isAsyncIterable(result)) {
        push(extractPuterText(result));
        return full;
    }
    const iterator = result[Symbol.asyncIterator]();
    while (true) {
        const step = await raceAbort(iterator.next(), signals);
        if (step.done)
            break;
        const failure = puterChunkError(step.value);
        if (failure)
            throw failure;
        push(extractPuterText(step.value));
    }
    return full;
}
export function createPuterClient(options = {}) {
    const loadPuter = options.loadPuter ?? loadPuterDefault;
    const model = options.model?.trim() || DEFAULT_MODEL;
    return {
        id: "puter",
        async getInfo() {
            try {
                const puter = await loadPuter();
                const signedIn = Boolean(puter.auth?.isSignedIn?.());
                return {
                    label: providerLabel("puter"),
                    description: signedIn
                        ? "Signed in to Puter. AI usage is billed to that Puter account."
                        : "Sign in to Puter when prompted. AI usage is billed to that Puter account.",
                    configured: signedIn,
                };
            }
            catch {
                return {
                    label: providerLabel("puter"),
                    description: "Puter runs in the browser. Add the Puter script, or install @heyputer/puter.js, then sign in.",
                    configured: false,
                };
            }
        },
        async signIn() {
            try {
                const puter = await loadPuter();
                if (!puter.auth?.signIn) {
                    throw new Error("This Puter build has no sign-in method.");
                }
                await puter.auth.signIn();
            }
            catch (error) {
                throw asAiError(error);
            }
        },
        async streamChat(params) {
            const timeoutMs = resolveTimeout(params.timeoutMs, options.timeoutMs);
            const timeout = timeoutMs > 0 ? startTimeout(timeoutMs) : undefined;
            const signals = { user: params.signal, timeout: timeout?.signal };
            try {
                const stopped = haltError(signals);
                if (stopped)
                    throw stopped;
                const puter = await raceAbort(loadPuter(), signals);
                if (puter.auth?.isSignedIn && !puter.auth.isSignedIn()) {
                    throw new AiBufferError("signed_out", "Sign in to Puter to send a message.");
                }
                if (!puter.ai?.chat) {
                    throw new Error("Puter.js loaded, but puter.ai.chat is missing.");
                }
                const messages = messagesFor(params, options.defaultSystemPrompt);
                const result = await raceAbort(Promise.resolve(puter.ai.chat(messages, { model, stream: true })), signals);
                return await readPuterStream(result, params, signals);
            }
            catch (error) {
                throw asAiError(haltError(signals) ?? error);
            }
            finally {
                timeout?.cancel();
            }
        },
    };
}
export function createOpenRouterClient(options) {
    async function resolveModel() {
        const fromGetter = (await options.getModel?.())?.trim();
        return fromGetter || options.model?.trim() || DEFAULT_MODEL;
    }
    return {
        id: "openrouter",
        async getInfo() {
            const key = (await options.getApiKey())?.trim();
            const model = await resolveModel();
            return {
                label: providerLabel("openrouter"),
                description: key
                    ? `Using model ${model}. Usage is billed to the OpenRouter account for this key.`
                    : "Add an OpenRouter API key. On a phone, keep the key on the device. On a server, set OPENROUTER_API_KEY.",
                configured: Boolean(key),
            };
        },
        async streamChat(params) {
            const timeoutMs = resolveTimeout(params.timeoutMs, options.timeoutMs);
            const timeout = timeoutMs > 0 ? startTimeout(timeoutMs) : undefined;
            const signals = { user: params.signal, timeout: timeout?.signal };
            try {
                const stopped = haltError(signals);
                if (stopped)
                    throw stopped;
                const apiKey = (await options.getApiKey())?.trim();
                if (!apiKey) {
                    throw new AiBufferError("missing_key", "OpenRouter API key is not set. Add a key on this device, or set OPENROUTER_API_KEY on the server.");
                }
                const model = await resolveModel();
                const messages = messagesFor(params, options.defaultSystemPrompt);
                return await raceAbort(streamOpenRouter({
                    apiKey,
                    model,
                    messages,
                    siteUrl: options.siteUrl,
                    appName: options.appName,
                    transport: options.transport,
                    signal: params.signal,
                    timeoutSignal: timeout?.signal,
                    onChunk: params.onChunk,
                    fetchImpl: options.fetchImpl,
                    extra: options.extra,
                }), signals);
            }
            catch (error) {
                throw asAiError(haltError(signals) ?? error);
            }
            finally {
                timeout?.cancel();
            }
        },
    };
}
export function createSpaceBunnyClient(options) {
    const effort = options.reasoningEffort ?? DEFAULT_SPACE_BUNNY_EFFORT;
    const inner = createOpenRouterClient({
        getApiKey: options.getApiKey,
        model: SPACE_BUNNY_MODEL,
        defaultSystemPrompt: options.defaultSystemPrompt,
        siteUrl: options.siteUrl,
        appName: options.appName,
        transport: options.transport,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        extra: spaceBunnyExtra(effort),
    });
    return {
        id: "space-bunny",
        async getInfo() {
            const key = (await options.getApiKey())?.trim();
            return {
                label: providerLabel("space-bunny"),
                description: key
                    ? `Calling ${SPACE_BUNNY_MODEL} through OpenRouter. Reasoning effort is ${effort}. The preview does not charge for tokens.`
                    : "Add an OpenRouter API key. Space Bunny Alpha is requested as stealth/space-bunny-alpha.",
                configured: Boolean(key),
            };
        },
        streamChat: (params) => inner.streamChat(params),
    };
}
export function createVercelGatewayClient(options) {
    async function resolveModel() {
        const fromGetter = (await options.getModel?.())?.trim();
        return fromGetter || options.model?.trim() || DEFAULT_VERCEL_GATEWAY_MODEL;
    }
    return {
        id: "vercel-gateway",
        async getInfo() {
            const key = (await options.getApiKey())?.trim();
            const model = await resolveModel();
            return {
                label: providerLabel("vercel-gateway"),
                description: key
                    ? `Using model ${model}. Send AI_GATEWAY_API_KEY, or VERCEL_OIDC_TOKEN when that key is unset.`
                    : "Set AI_GATEWAY_API_KEY, or VERCEL_OIDC_TOKEN on Vercel. Keep the key on the server or in device secure storage.",
                configured: Boolean(key),
            };
        },
        async streamChat(params) {
            return runProviderChat(params, options.timeoutMs, async (signals) => {
                const apiKey = (await options.getApiKey())?.trim();
                if (!apiKey)
                    throw new AiBufferError("missing_key", VERCEL_GATEWAY_MISSING_KEY);
                const model = await resolveModel();
                const messages = messagesFor(params, options.defaultSystemPrompt);
                return raceAbort(streamChatCompletions({
                    url: VERCEL_GATEWAY_URL,
                    apiKey,
                    model,
                    messages,
                    providerName: providerLabel("vercel-gateway"),
                    missingKeyMessage: VERCEL_GATEWAY_MISSING_KEY,
                    siteUrl: options.siteUrl,
                    appName: options.appName,
                    transport: options.transport,
                    signal: params.signal,
                    timeoutSignal: signals.timeout,
                    onChunk: params.onChunk,
                    fetchImpl: options.fetchImpl,
                    extra: options.extra,
                }), signals);
            });
        },
    };
}
export function createGeminiClient(options) {
    async function resolveModel() {
        const fromGetter = (await options.getModel?.())?.trim();
        return fromGetter || options.model?.trim() || DEFAULT_GEMINI_MODEL;
    }
    return {
        id: "gemini",
        async getInfo() {
            const key = (await options.getApiKey())?.trim();
            const model = await resolveModel();
            return {
                label: providerLabel("gemini"),
                description: key
                    ? `Using model ${model}. Requests use the Gemini API key in the x-goog-api-key header.`
                    : "Set GEMINI_API_KEY. Keep the key on the server or in device secure storage.",
                configured: Boolean(key),
            };
        },
        async streamChat(params) {
            return runProviderChat(params, options.timeoutMs, async (signals) => {
                const apiKey = (await options.getApiKey())?.trim();
                if (!apiKey)
                    throw new AiBufferError("missing_key", GEMINI_MISSING_KEY);
                const model = await resolveModel();
                const messages = messagesFor(params, options.defaultSystemPrompt);
                const url = geminiStreamUrl(model);
                return raceAbort(streamSsePost({
                    url,
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": apiKey,
                    },
                    body: geminiRequestBody(messages),
                    providerName: providerLabel("gemini"),
                    transport: options.transport,
                    signal: params.signal,
                    timeoutSignal: signals.timeout,
                    fetchImpl: options.fetchImpl,
                    onChunk: params.onChunk,
                    drain: drainGeminiSse,
                }), signals);
            });
        },
    };
}
export function createLlmapiClient(options) {
    const url = options.url?.trim() || LLMAPI_URL;
    async function resolveModel() {
        const fromGetter = (await options.getModel?.())?.trim();
        return fromGetter || options.model?.trim() || DEFAULT_LLMAPI_MODEL;
    }
    return {
        id: "llmapi",
        async getInfo() {
            const key = (await options.getApiKey())?.trim();
            const model = await resolveModel();
            return {
                label: providerLabel("llmapi"),
                description: key
                    ? `Using model ${model}.`
                    : "Set LLM_API_KEY. Keep the key on the server or in device secure storage.",
                configured: Boolean(key),
            };
        },
        async streamChat(params) {
            return runProviderChat(params, options.timeoutMs, async (signals) => {
                const apiKey = (await options.getApiKey())?.trim();
                if (!apiKey)
                    throw new AiBufferError("missing_key", LLMAPI_MISSING_KEY);
                const model = await resolveModel();
                const messages = messagesFor(params, options.defaultSystemPrompt);
                return raceAbort(streamChatCompletions({
                    url,
                    apiKey,
                    model,
                    messages,
                    providerName: providerLabel("llmapi"),
                    missingKeyMessage: LLMAPI_MISSING_KEY,
                    siteUrl: options.siteUrl,
                    appName: options.appName,
                    transport: options.transport,
                    signal: params.signal,
                    timeoutSignal: signals.timeout,
                    onChunk: params.onChunk,
                    fetchImpl: options.fetchImpl,
                    extra: options.extra,
                }), signals);
            });
        },
    };
}
export function createNvidiaClient(options) {
    async function resolveModel() {
        const fromGetter = (await options.getModel?.())?.trim();
        return fromGetter || options.model?.trim() || DEFAULT_NVIDIA_MODEL;
    }
    return {
        id: "nvidia",
        async getInfo() {
            const key = (await options.getApiKey())?.trim();
            const model = await resolveModel();
            return {
                label: providerLabel("nvidia"),
                description: key
                    ? `Using model ${model}.`
                    : "Set NVIDIA_API_KEY. Keep the key on the server or in device secure storage.",
                configured: Boolean(key),
            };
        },
        async streamChat(params) {
            return runProviderChat(params, options.timeoutMs, async (signals) => {
                const apiKey = (await options.getApiKey())?.trim();
                if (!apiKey)
                    throw new AiBufferError("missing_key", NVIDIA_MISSING_KEY);
                const model = await resolveModel();
                const messages = messagesFor(params, options.defaultSystemPrompt);
                return raceAbort(streamChatCompletions({
                    url: NVIDIA_URL,
                    apiKey,
                    model,
                    messages,
                    providerName: providerLabel("nvidia"),
                    missingKeyMessage: NVIDIA_MISSING_KEY,
                    siteUrl: options.siteUrl,
                    appName: options.appName,
                    transport: options.transport,
                    signal: params.signal,
                    timeoutSignal: signals.timeout,
                    onChunk: params.onChunk,
                    fetchImpl: options.fetchImpl,
                    extra: options.extra,
                }), signals);
            });
        },
    };
}
async function runProviderChat(params, clientTimeout, run) {
    const timeoutMs = resolveTimeout(params.timeoutMs, clientTimeout);
    const timeout = timeoutMs > 0 ? startTimeout(timeoutMs) : undefined;
    const signals = { user: params.signal, timeout: timeout?.signal };
    try {
        const stopped = haltError(signals);
        if (stopped)
            throw stopped;
        return await run(signals);
    }
    catch (error) {
        throw asAiError(haltError(signals) ?? error);
    }
    finally {
        timeout?.cancel();
    }
}
export function createAiClient(options) {
    switch (options.provider) {
        case "puter":
            return createPuterClient(options);
        case "space-bunny":
            return createSpaceBunnyClient(options);
        case "openrouter":
            return createOpenRouterClient(options);
        case "vercel-gateway":
            return createVercelGatewayClient(options);
        case "gemini":
            return createGeminiClient(options);
        case "llmapi":
            return createLlmapiClient(options);
        case "nvidia":
            return createNvidiaClient(options);
        default: {
            const never = options;
            return never;
        }
    }
}
