/**
 * KeyStore.ts — P1-3: Persistent, AES-256-GCM encrypted API key storage.
 *
 * Keys are stored encrypted at rest in `data/keystore.enc`.
 * The encryption key is derived from a machine-local secret stored in `data/keystore.secret`.
 * If the secret file doesn't exist, a fresh random secret is generated and saved.
 *
 * This provides strong encryption at rest without requiring an OS keychain (cross-platform).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES  = 12;
const KEY_BYTES = 32;

// ── Paths ─────────────────────────────────────────────────────────────────────

function getDataDir(): string {
    return config.dataDir;
}

function getSecretPath(): string {
    return path.join(getDataDir(), 'keystore.secret');
}

function getStorePath(): string {
    return path.join(getDataDir(), 'keystore.enc');
}

// ── Secret management ─────────────────────────────────────────────────────────

/**
 * Returns the 32-byte encryption key for AES-256-GCM.
 * First boot: generates a random secret and persists it to disk.
 * Subsequent boots: loads from disk.
 */
function getMasterKey(): Buffer {
    const secretPath = getSecretPath();
    try {
        fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    } catch (err) {
        console.warn(`[KeyStore] Could not create directory for secret at ${secretPath}:`, err);
    }

    if (fs.existsSync(secretPath)) {
        try {
            const hex = fs.readFileSync(secretPath, 'utf-8').trim();
            const buf = Buffer.from(hex, 'hex');
            if (buf.length === KEY_BYTES) {
                return buf;
            }
            console.warn(`[KeyStore] Existing secret in ${secretPath} has invalid length (${buf.length}), regenerating...`);
        } catch (err) {
            console.warn(`[KeyStore] Failed to read secret file at ${secretPath}, regenerating...`, err);
        }
    }

    // First boot or invalid secret — generate a fresh random secret
    const secret = crypto.randomBytes(KEY_BYTES);
    try {
        fs.writeFileSync(secretPath, secret.toString('hex'), { mode: 0o600 }); // owner-read only
    } catch (err) {
        console.error(`[KeyStore] Failed to write secret to ${secretPath}:`, err);
    }
    return secret;
}

// ── Encrypt / Decrypt ─────────────────────────────────────────────────────────

function encrypt(plaintext: string, masterKey: Buffer): string {
    const iv     = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
    const enc1   = cipher.update(plaintext, 'utf-8');
    const enc2   = cipher.final();
    const tag    = cipher.getAuthTag();
    // Format: iv(hex) + ':' + tag(hex) + ':' + ciphertext(hex)
    return [iv.toString('hex'), tag.toString('hex'), Buffer.concat([enc1, enc2]).toString('hex')].join(':');
}

function decrypt(encoded: string, masterKey: Buffer): string {
    const parts = encoded.split(':');
    if (parts.length !== 3) throw new Error('KeyStore: invalid ciphertext format');
    const [ivHex, tagHex, ctHex] = parts;
    const iv         = Buffer.from(ivHex, 'hex');
    const tag        = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ctHex, 'hex');
    const decipher   = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(tag);
    const dec1 = decipher.update(ciphertext);
    const dec2 = decipher.final();
    return Buffer.concat([dec1, dec2]).toString('utf-8');
}

// ── Store read / write ────────────────────────────────────────────────────────

type KeyMap = Record<string, string>; // { [provider]: encryptedKey }

function readStore(): KeyMap {
    const p = getStorePath();
    if (!fs.existsSync(p)) return {};
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
        return {};
    }
}

function writeStore(store: KeyMap): void {
    const p = getStorePath();
    try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 });
    } catch (err) {
        console.error(`[KeyStore] Failed to write keystore file at ${p}:`, err);
        throw new Error(`Failed to save key to disk (${p}): ${err instanceof Error ? err.message : String(err)}`);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

let cachedMasterKey: Buffer | null = null;

function masterKey(): Buffer {
    if (!cachedMasterKey) cachedMasterKey = getMasterKey();
    return cachedMasterKey;
}

export class KeyStore {
    /**
     * Save an API key for a provider.
     * Overwrites any existing key for that provider.
     */
    public static setKey(provider: string, apiKey: string): void {
        const store = readStore();
        store[provider] = encrypt(apiKey, masterKey());
        writeStore(store);
    }

    /**
     * Retrieve the decrypted API key for a provider.
     * Returns undefined if no key is stored for that provider.
     */
    public static getKey(provider: string): string | undefined {
        const store = readStore();
        const enc = store[provider];
        if (!enc) return undefined;
        try {
            return decrypt(enc, masterKey());
        } catch (e) {
            console.error(`[KeyStore] Failed to decrypt key for ${provider}:`, e);
            return undefined;
        }
    }

    /** Remove the stored key for a provider. Returns true if a key was deleted. */
    public static deleteKey(provider: string): boolean {
        const store = readStore();
        if (!(provider in store)) return false;
        delete store[provider];
        writeStore(store);
        return true;
    }

    /** List all providers that have a key stored (keys are NOT returned). */
    public static listProviders(): string[] {
        return Object.keys(readStore());
    }

    /** True if a key exists for this provider. */
    public static hasKey(provider: string): boolean {
        return provider in readStore();
    }
}
