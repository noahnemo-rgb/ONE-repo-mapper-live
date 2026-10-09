import { redactSecrets } from "./redact.js";
export class AiBufferError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "AiBufferError";
        this.code = code;
    }
}
export function openRouterHttpError(status, body) {
    return providerHttpError("OpenRouter", status, body);
}
export function providerHttpError(provider, status, body) {
    const safe = redactSecrets(body).slice(0, 300);
    const error = new Error(`${provider} HTTP ${status}: ${safe}`);
    error.status = status;
    return error;
}
export function formatAiError(error) {
    if (error instanceof AiBufferError)
        return redactSecrets(error.message);
    if (error instanceof Error && error.name === "TimeoutError") {
        return "The AI request timed out.";
    }
    if (error instanceof Error && error.name === "AbortError") {
        return "The AI request was cancelled.";
    }
    const err = error;
    if (err?.code === "too_many_requests" || err?.status === 429) {
        return "Too many AI requests. Wait a few seconds and try again.";
    }
    if (err?.code === "insufficient_funds" || err?.status === 402) {
        return "Your AI allowance is exhausted. Add credits or upgrade your provider account, then try again.";
    }
    if (err?.code === "subscription_required") {
        return "This AI feature requires a paid provider plan.";
    }
    if (typeof err?.message === "string" && err.message.trim()) {
        return redactSecrets(err.message);
    }
    return redactSecrets(String(error));
}
export function codeFor(error) {
    if (error instanceof AiBufferError)
        return error.code;
    const err = error;
    if (err?.name === "AbortError" || err?.name === "TimeoutError")
        return "cancelled";
    if (err?.code === "too_many_requests" || err?.status === 429)
        return "rate_limited";
    if (err?.code === "insufficient_funds" ||
        err?.code === "subscription_required" ||
        err?.status === 402) {
        return "payment_required";
    }
    if (err?.code === "signed_out")
        return "signed_out";
    if (err?.code === "missing_key")
        return "missing_key";
    if (err?.code === "empty_message")
        return "empty_message";
    if (err?.code === "busy")
        return "busy";
    return "provider_error";
}
export function asAiError(error) {
    if (error instanceof AiBufferError) {
        const message = redactSecrets(error.message);
        return message === error.message ? error : new AiBufferError(error.code, message);
    }
    return new AiBufferError(codeFor(error), formatAiError(error));
}
