// config.ts — Application configuration. No framework imports required.

export interface AppConfig {
    port: number;
    host: string;
    env: 'development' | 'production' | 'test';
    dataDir: string;
    ollamaEmbedBaseUrl: string;
    cors: {
        origin: string | string[];
        credentials: boolean;
    };
    logging: {
        level: string;
        pretty: boolean;
    };
    continuation: {
        maxPasses: number;
        // Target maximum completion tokens per pass (soft hint; may not be enforced by all providers)
        perPassTokens: number;
    };
}

import os from 'os';
import path from 'path';

// In production (packaged Electron app) the CWD is inside the read-only install
// folder. Use the user's home dir so runtime data is always writable.
function resolveDataDir(): string {
    if (process.env.DATA_DIR) return process.env.DATA_DIR;
    if (process.env.NODE_ENV === 'production') {
        return path.join(os.homedir(), '.octoml', 'data');
    }
    return './data';
}

export const config: AppConfig = {
    port: parseInt(process.env.PORT || '3001', 10),
    host: process.env.HOST || '0.0.0.0',
    env: (process.env.NODE_ENV as any) || 'development',
    dataDir: resolveDataDir(),
    ollamaEmbedBaseUrl: process.env.OLLAMA_BASE_URL || process.env.OLLAMA_EMBED_BASE_URL || 'http://localhost:11434',
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        credentials: true,
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        pretty: process.env.NODE_ENV !== 'production',
    },
    continuation: {
        maxPasses: parseInt(process.env.AI_CONT_MAX_PASSES || '5', 10),
        perPassTokens: parseInt(process.env.AI_CONT_PER_PASS_TOKENS || '1536', 10),
    },
};
