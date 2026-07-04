import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface DynamicProviderConfig {
  id: string;
  name: string;
  type: string;
  apiKey: string;
  baseUrl?: string;
  enabled: boolean;
  enabledModelIds: string[];
  availableModelIds: string[];
  lastFetched?: string;
}

function getDataDir(): string {
    return config.dataDir;
}

function getStorePath(): string {
    return path.join(getDataDir(), 'providers.json');
}

export class ProviderStore {
    static getProviders(): DynamicProviderConfig[] {
        const p = getStorePath();
        if (!fs.existsSync(p)) return [];
        try {
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
        } catch {
            return [];
        }
    }

    static saveProviders(providers: DynamicProviderConfig[]): void {
        const p = getStorePath();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(providers, null, 2), 'utf-8');
    }

    static saveProvider(provider: DynamicProviderConfig): DynamicProviderConfig {
        const providers = this.getProviders();
        const index = providers.findIndex(p => p.id === provider.id);
        if (index >= 0) {
            providers[index] = provider;
        } else {
            providers.push(provider);
        }
        this.saveProviders(providers);
        return provider;
    }

    static deleteProvider(id: string): void {
        const providers = this.getProviders();
        const filtered = providers.filter(p => p.id !== id);
        this.saveProviders(filtered);
    }
}
