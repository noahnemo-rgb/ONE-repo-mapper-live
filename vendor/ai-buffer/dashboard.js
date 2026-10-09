import { createAiClient } from "./client.js";
import { AiBufferError } from "./errors.js";
import { looksLikeSecret, maskKeyHint } from "./redact.js";
import { createCallRouter, DEFAULT_CALL_ORDER } from "./router.js";
import { defaultModelFor, isAiProviderId, PROVIDER_CATALOG } from "./providers.js";
/** Visible dashboard words besides the provider names in `PROVIDER_CATALOG`. */
export const DASHBOARD_LABELS = {
    model: "model",
    active: "active",
    configured: "configured",
    notConfigured: "not configured",
};
const PROVIDER_KEY = "ai-buffer.active_provider";
function modelKey(id) {
    return `ai-buffer.model.${id}`;
}
/**
 * Saves the active provider and each provider's model in the app's store.
 * Phones can pass expo-secure-store. Tests can pass `createMemoryStore`.
 * This store does not save API keys.
 */
export function createProviderSelectionStore(store) {
    return {
        getProvider: async () => {
            const value = (await store.get(PROVIDER_KEY))?.trim() ?? "";
            return isAiProviderId(value) ? value : null;
        },
        setProvider: (id) => Promise.resolve(store.set(PROVIDER_KEY, id)),
        getModel: async (id) => {
            const value = (await store.get(modelKey(id)))?.trim();
            if (!value || looksLikeSecret(value))
                return defaultModelFor(id);
            return value;
        },
        setModel: async (id, value) => {
            const trimmed = value.trim();
            if (!trimmed) {
                await store.delete(modelKey(id));
                return;
            }
            if (looksLikeSecret(trimmed)) {
                throw new AiBufferError("provider_error", "The model field cannot store an API key.");
            }
            await store.set(modelKey(id), trimmed);
        },
        getSelection: async () => {
            const provider = (await store.get(PROVIDER_KEY))?.trim() ?? "";
            if (!isAiProviderId(provider))
                return null;
            const stored = (await store.get(modelKey(provider)))?.trim() ?? "";
            const model = stored && !looksLikeSecret(stored) ? stored : defaultModelFor(provider);
            return { provider, model };
        },
    };
}
export function isProviderConfigured(id, probe) {
    switch (id) {
        case "puter":
            return Boolean(probe.puterSignedIn);
        case "openrouter":
        case "space-bunny":
            return Boolean(probe.openrouterKey);
        case "vercel-gateway":
            return Boolean(probe.gatewayKey);
        case "gemini":
            return Boolean(probe.geminiKey);
        case "nvidia":
            return Boolean(probe.nvidiaKey);
        case "llmapi":
            return Boolean(probe.llmapiKey);
        default: {
            const never = id;
            return never;
        }
    }
}
export async function loadDashboard(store, probe = {}) {
    const active = await store.getProvider();
    const rows = [];
    for (const item of PROVIDER_CATALOG) {
        const configured = isProviderConfigured(item.id, probe);
        rows.push({
            id: item.id,
            label: item.label,
            configured,
            status: configured ? DASHBOARD_LABELS.configured : DASHBOARD_LABELS.notConfigured,
            activeLabel: active === item.id ? DASHBOARD_LABELS.active : "",
            modelLabel: DASHBOARD_LABELS.model,
            model: await store.getModel(item.id),
            keyHint: maskKeyHint(probe.keyHints?.[item.id] ?? ""),
        });
    }
    return rows;
}
export function createClientFromSelection(selection, options) {
    const model = selection.model.trim();
    const clientOptions = optionsForSelection(selection.provider, model, options);
    return createAiClient(clientOptions);
}
export function createRouterFromSelection(selection, options = {}) {
    const model = selection.model.trim();
    const routed = applyModel(selection.provider, model, options);
    const rest = (routed.order ?? DEFAULT_CALL_ORDER).filter((id) => id !== selection.provider);
    return createCallRouter({ ...routed, order: [selection.provider, ...rest] });
}
function optionsForSelection(provider, model, options) {
    switch (provider) {
        case "puter":
            return { provider: "puter", ...options.puter, ...(model ? { model } : {}) };
        case "openrouter":
            if (!options.openrouter)
                missingRoute(provider);
            return { provider: "openrouter", ...options.openrouter, ...(model ? { model } : {}) };
        case "space-bunny":
            if (!options.spaceBunny)
                missingRoute(provider);
            return { provider: "space-bunny", ...options.spaceBunny };
        case "vercel-gateway":
            if (!options.vercelGateway)
                missingRoute(provider);
            return { provider: "vercel-gateway", ...options.vercelGateway, ...(model ? { model } : {}) };
        case "gemini":
            if (!options.gemini)
                missingRoute(provider);
            return { provider: "gemini", ...options.gemini, ...(model ? { model } : {}) };
        case "nvidia":
            if (!options.nvidia)
                missingRoute(provider);
            return { provider: "nvidia", ...options.nvidia, ...(model ? { model } : {}) };
        case "llmapi":
            if (!options.llmapi)
                missingRoute(provider);
            return { provider: "llmapi", ...options.llmapi, ...(model ? { model } : {}) };
        default: {
            const never = provider;
            return never;
        }
    }
}
function applyModel(provider, model, options) {
    if (!model || provider === "space-bunny")
        return options;
    switch (provider) {
        case "puter":
            return { ...options, puter: { ...options.puter, model } };
        case "openrouter":
            return options.openrouter ? { ...options, openrouter: { ...options.openrouter, model } } : options;
        case "vercel-gateway":
            return options.vercelGateway ? { ...options, vercelGateway: { ...options.vercelGateway, model } } : options;
        case "gemini":
            return options.gemini ? { ...options, gemini: { ...options.gemini, model } } : options;
        case "nvidia":
            return options.nvidia ? { ...options, nvidia: { ...options.nvidia, model } } : options;
        case "llmapi":
            return options.llmapi ? { ...options, llmapi: { ...options.llmapi, model } } : options;
        default:
            return options;
    }
}
function missingRoute(id) {
    throw new AiBufferError("provider_error", `The ${id} route is not configured on this router.`);
}
