import { maskKeyHint } from "./redact.js";
/** Decode a base64 32-byte `AI_BUFFER_VAULT_KEY`. */
export function vaultKeyFromString(value) {
    const decoded = base64ToBytes(value.trim());
    if (decoded.length !== 32) {
        throw new Error("AI_BUFFER_VAULT_KEY must be 32 bytes, base64-encoded.");
    }
    return decoded;
}
/**
 * AES-256-GCM through Web Crypto, so importing this module does not load `node:crypto`.
 * The browser dashboard can keep importing the package entry.
 */
export function createKeyVault(options) {
    if (options.encryptionKey.length !== 32) {
        throw new Error("Vault encryption key must be 32 bytes.");
    }
    const rawKey = copyBytes(options.encryptionKey);
    function recordName(userId, provider) {
        return `ai-buffer.vault.${encodeURIComponent(userId)}.${encodeURIComponent(provider)}`;
    }
    async function cryptoKey() {
        return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
    }
    return {
        async put(userId, provider, apiKey) {
            const user = userId.trim();
            const name = provider.trim();
            const trimmed = apiKey.trim();
            if (!user || !name || !trimmed) {
                throw new Error("userId, provider, and apiKey are required.");
            }
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: copyBytes(iv), additionalData: copyBytes(aad(user, name)) }, await cryptoKey(), copyBytes(new TextEncoder().encode(trimmed))));
            const record = {
                iv: bytesToBase64(iv),
                ciphertext: bytesToBase64(encrypted),
                hint: trimmed.slice(-4),
            };
            await options.storage.set(recordName(user, name), JSON.stringify(record));
            return { configured: true, hint: maskKeyHint(record.hint) };
        },
        async status(userId, provider) {
            const raw = await options.storage.get(recordName(userId.trim(), provider.trim()));
            if (!raw)
                return { configured: false, hint: "" };
            const record = JSON.parse(raw);
            return { configured: true, hint: maskKeyHint(record.hint) };
        },
        async read(userId, provider) {
            const user = userId.trim();
            const name = provider.trim();
            const raw = await options.storage.get(recordName(user, name));
            if (!raw)
                return null;
            const record = JSON.parse(raw);
            const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: copyBytes(base64ToBytes(record.iv)), additionalData: copyBytes(aad(user, name)) }, await cryptoKey(), copyBytes(base64ToBytes(record.ciphertext)));
            return new TextDecoder().decode(plain);
        },
        async delete(userId, provider) {
            await options.storage.delete(recordName(userId.trim(), provider.trim()));
        },
    };
}
export function createMemoryVaultStorage() {
    const values = new Map();
    return {
        get: (key) => values.get(key) ?? null,
        set: (key, value) => {
            values.set(key, value);
        },
        delete: (key) => {
            values.delete(key);
        },
    };
}
function aad(userId, provider) {
    return new TextEncoder().encode(`${userId}\n${provider}`);
}
function copyBytes(bytes) {
    const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
    copy.set(bytes);
    return copy;
}
function bytesToBase64(bytes) {
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary);
}
function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
        bytes[index] = binary.charCodeAt(index);
    return bytes;
}
