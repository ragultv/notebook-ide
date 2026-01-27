// AI and model-related types
export interface ProviderInfo {
  name: string;
  connected: boolean;
  models: ModelInfo[];
  requiresApiKey: boolean;
  apiKeyConfigured?: boolean;
  local?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  context: string;
  provider?: string;
  local?: boolean;
}

export interface SelectedModel {
  provider: string;
  modelId: string;
}

export interface ModelSelection {
  [providerId: string]: {
    [modelId: string]: boolean;
  };
}

export interface AIOperation {
  type: string;
  params: Record<string, unknown>;
}

export interface AIResponse {
  response: string;
  operations?: AIOperation[];
}
