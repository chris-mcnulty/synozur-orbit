import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import ModelClient, { isUnexpected, type ChatRequestMessage } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import { db } from "../db";
import { aiConfiguration, aiFeatureModelAssignments, AI_PROVIDERS, AI_MODELS, AZURE_FOUNDRY_MODEL_ENDPOINT, type AIFeature, type AIProviderKey } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface AICompletionOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AICompletionResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
  durationMs: number;
}

export interface IAIProvider {
  readonly providerKey: string;
  readonly providerName: string;
  complete(
    model: string,
    userPrompt: string,
    options?: AICompletionOptions,
  ): Promise<AICompletionResult>;
  isAvailable(): boolean;
  isModelAvailable?(model: string): boolean;
}

class ReplitAnthropicProvider implements IAIProvider {
  readonly providerKey = AI_PROVIDERS.REPLIT_ANTHROPIC;
  readonly providerName = "Replit AI (Anthropic)";
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });
    }
    return this.client;
  }

  isAvailable(): boolean {
    return !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL);
  }

  async complete(model: string, userPrompt: string, options?: AICompletionOptions): Promise<AICompletionResult> {
    const client = this.getClient();
    const startTime = Date.now();

    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: options?.maxTokens ?? 8192,
      messages: [{ role: "user", content: userPrompt }],
    };

    if (options?.systemPrompt) {
      params.system = options.systemPrompt;
    }
    if (options?.temperature !== undefined) {
      params.temperature = options.temperature;
    }

    const response = await client.messages.create(params);
    const durationMs = Date.now() - startTime;

    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Unexpected response type from Anthropic");
    }

    return {
      text: textBlock.text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
      provider: this.providerKey,
      durationMs,
    };
  }
}

class ReplitOpenAIProvider implements IAIProvider {
  readonly providerKey = AI_PROVIDERS.REPLIT_OPENAI;
  readonly providerName = "Replit AI (OpenAI)";
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });
    }
    return this.client;
  }

  isAvailable(): boolean {
    return !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);
  }

  async complete(model: string, userPrompt: string, options?: AICompletionOptions): Promise<AICompletionResult> {
    const client = this.getClient();
    const startTime = Date.now();

    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: userPrompt });

    const response = await client.chat.completions.create({
      model,
      max_tokens: options?.maxTokens ?? 8192,
      temperature: options?.temperature,
      messages,
    });

    const durationMs = Date.now() - startTime;
    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error("Unexpected response from OpenAI");
    }

    return {
      text: choice.message.content,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      model: response.model,
      provider: this.providerKey,
      durationMs,
    };
  }
}

class AzureFoundryProvider implements IAIProvider {
  readonly providerKey = AI_PROVIDERS.AZURE_FOUNDRY;
  readonly providerName = "Azure AI Foundry";
  private aoaiClient: OpenAI | null = null;
  private inferenceClient: ReturnType<typeof ModelClient> | null = null;

  private getAoaiClient(): OpenAI {
    if (!this.aoaiClient) {
      const endpoint = process.env.AZURE_FOUNDRY_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_FOUNDRY_API_KEY;
      if (!endpoint || !apiKey) {
        throw new Error("Azure AI Foundry not configured: missing AZURE_FOUNDRY_OPENAI_ENDPOINT or AZURE_FOUNDRY_API_KEY");
      }
      this.aoaiClient = new OpenAI({
        apiKey,
        baseURL: endpoint,
      });
    }
    return this.aoaiClient;
  }

  private isAoaiAvailable(): boolean {
    return !!(process.env.AZURE_FOUNDRY_OPENAI_ENDPOINT && process.env.AZURE_FOUNDRY_API_KEY);
  }

  private isInferenceAvailable(): boolean {
    return !!(process.env.AZURE_FOUNDRY_PROJECT_ENDPOINT && process.env.AZURE_FOUNDRY_API_KEY);
  }

  isAvailable(): boolean {
    return this.isAoaiAvailable() || this.isInferenceAvailable();
  }

  isModelAvailable(model: string): boolean {
    const endpointType = AZURE_FOUNDRY_MODEL_ENDPOINT[model];
    if (endpointType === 'inference') {
      return this.isInferenceAvailable();
    }
    return this.isAoaiAvailable();
  }

  private getInferenceClient(): ReturnType<typeof ModelClient> {
    if (!this.inferenceClient) {
      const projectEndpoint = process.env.AZURE_FOUNDRY_PROJECT_ENDPOINT;
      const apiKey = process.env.AZURE_FOUNDRY_API_KEY;
      if (!projectEndpoint || !apiKey) {
        throw new Error("Azure AI Foundry Inference not configured: missing AZURE_FOUNDRY_PROJECT_ENDPOINT or AZURE_FOUNDRY_API_KEY");
      }
      this.inferenceClient = ModelClient(projectEndpoint, new AzureKeyCredential(apiKey));
    }
    return this.inferenceClient;
  }

  private async completeViaInference(model: string, userPrompt: string, options?: AICompletionOptions): Promise<AICompletionResult> {
    const client = this.getInferenceClient();
    const startTime = Date.now();

    const messages: ChatRequestMessage[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: userPrompt });

    const response = await client.path("/chat/completions").post({
      body: {
        messages,
        model,
        max_tokens: options?.maxTokens ?? 8192,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
    });

    if (isUnexpected(response)) {
      throw new Error(`Azure AI Inference error (${response.status}): ${JSON.stringify(response.body)}`);
    }

    const durationMs = Date.now() - startTime;
    const result = response.body;
    const choice = result.choices[0];
    if (!choice?.message?.content) {
      throw new Error("Unexpected response from Azure AI Inference");
    }

    return {
      text: choice.message.content,
      usage: {
        inputTokens: result.usage?.prompt_tokens ?? 0,
        outputTokens: result.usage?.completion_tokens ?? 0,
        totalTokens: result.usage?.total_tokens ?? 0,
      },
      model: result.model,
      provider: this.providerKey,
      durationMs,
    };
  }

  async complete(model: string, userPrompt: string, options?: AICompletionOptions): Promise<AICompletionResult> {
    const endpointType = AZURE_FOUNDRY_MODEL_ENDPOINT[model] ?? 'aoai';

    if (endpointType === 'inference') {
      return this.completeViaInference(model, userPrompt, options);
    }

    const client = this.getAoaiClient();
    const startTime = Date.now();

    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: userPrompt });

    const response = await client.chat.completions.create({
      model,
      max_tokens: options?.maxTokens ?? 8192,
      temperature: options?.temperature,
      messages,
    });

    const durationMs = Date.now() - startTime;
    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error("Unexpected response from Azure Foundry");
    }

    return {
      text: choice.message.content,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      model: response.model,
      provider: this.providerKey,
      durationMs,
    };
  }
}

const providers: Record<string, IAIProvider> = {
  [AI_PROVIDERS.REPLIT_ANTHROPIC]: new ReplitAnthropicProvider(),
  [AI_PROVIDERS.REPLIT_OPENAI]: new ReplitOpenAIProvider(),
  [AI_PROVIDERS.AZURE_FOUNDRY]: new AzureFoundryProvider(),
};

interface CachedConfig {
  globalConfig: { defaultProvider: string; defaultModel: string; maxTokensPerRequest: number | null } | null;
  featureAssignments: Map<string, { provider: string; model: string; maxTokens: number | null }>;
  fetchedAt: number;
}

let configCache: CachedConfig | null = null;
const CONFIG_CACHE_TTL_MS = 60_000;

async function loadConfig(): Promise<CachedConfig> {
  if (configCache && Date.now() - configCache.fetchedAt < CONFIG_CACHE_TTL_MS) {
    return configCache;
  }

  try {
    const [globalRows, featureRows] = await Promise.all([
      db.select().from(aiConfiguration).limit(1),
      db.select().from(aiFeatureModelAssignments),
    ]);

    const featureMap = new Map<string, { provider: string; model: string; maxTokens: number | null }>();
    for (const row of featureRows) {
      featureMap.set(row.feature, {
        provider: row.provider,
        model: row.model,
        maxTokens: row.maxTokens,
      });
    }

    configCache = {
      globalConfig: globalRows[0]
        ? {
            defaultProvider: globalRows[0].defaultProvider,
            defaultModel: globalRows[0].defaultModel,
            maxTokensPerRequest: globalRows[0].maxTokensPerRequest,
          }
        : null,
      featureAssignments: featureMap,
      fetchedAt: Date.now(),
    };
  } catch (error) {
    console.error("[ai-provider] Failed to load config from DB, using defaults:", error);
    configCache = {
      globalConfig: null,
      featureAssignments: new Map(),
      fetchedAt: Date.now(),
    };
  }

  return configCache;
}

export function invalidateAIConfigCache(): void {
  configCache = null;
}

export interface ResolvedProvider {
  provider: IAIProvider;
  model: string;
  providerKey: string;
  maxTokens?: number;
}

function findFirstAvailableModel(provider: IAIProvider, providerKey: string): string | null {
  const models = AI_MODELS[providerKey] ?? [];
  for (const m of models) {
    if (provider.isModelAvailable ? provider.isModelAvailable(m) : true) {
      return m;
    }
  }
  return null;
}

export async function getProviderForFeature(feature: AIFeature): Promise<ResolvedProvider> {
  const config = await loadConfig();

  const assignment = config.featureAssignments.get(feature);
  if (assignment) {
    const provider = providers[assignment.provider];
    const modelAvailable = provider && (
      provider.isModelAvailable
        ? provider.isModelAvailable(assignment.model)
        : provider.isAvailable()
    );
    if (provider && modelAvailable) {
      return {
        provider,
        model: assignment.model,
        providerKey: assignment.provider,
        maxTokens: assignment.maxTokens ?? undefined,
      };
    }
    console.warn(`[ai-provider] Provider ${assignment.provider} / model ${assignment.model} assigned to ${feature} is not available, falling back to default`);
  }

  const defaultProvider = config.globalConfig?.defaultProvider ?? AI_PROVIDERS.REPLIT_ANTHROPIC;
  const defaultModel = config.globalConfig?.defaultModel ?? "claude-sonnet-4-5";
  const provider = providers[defaultProvider];

  const defaultModelAvailable = provider && (
    provider.isModelAvailable
      ? provider.isModelAvailable(defaultModel)
      : provider.isAvailable()
  );

  if (!provider || !defaultModelAvailable) {
    if (provider?.isAvailable()) {
      const availableModel = findFirstAvailableModel(provider, defaultProvider);
      if (availableModel) {
        console.warn(`[ai-provider] Default model ${defaultModel} not available for ${defaultProvider}, using ${availableModel} instead`);
        return { provider, model: availableModel, providerKey: defaultProvider, maxTokens: config.globalConfig?.maxTokensPerRequest ?? undefined };
      }
    }
    const fallback = providers[AI_PROVIDERS.REPLIT_ANTHROPIC];
    if (fallback?.isAvailable()) {
      return { provider: fallback, model: "claude-sonnet-4-5", providerKey: AI_PROVIDERS.REPLIT_ANTHROPIC };
    }
    throw new Error("No AI provider available");
  }

  return {
    provider,
    model: defaultModel,
    providerKey: defaultProvider,
    maxTokens: config.globalConfig?.maxTokensPerRequest ?? undefined,
  };
}

export async function getDefaultProvider(): Promise<ResolvedProvider> {
  const config = await loadConfig();
  const providerKey = config.globalConfig?.defaultProvider ?? AI_PROVIDERS.REPLIT_ANTHROPIC;
  const model = config.globalConfig?.defaultModel ?? "claude-sonnet-4-5";
  const provider = providers[providerKey];

  const modelAvailable = provider && (
    provider.isModelAvailable
      ? provider.isModelAvailable(model)
      : provider.isAvailable()
  );

  if (!provider || !modelAvailable) {
    if (provider?.isAvailable()) {
      const availableModel = findFirstAvailableModel(provider, providerKey);
      if (availableModel) {
        console.warn(`[ai-provider] Default model ${model} not available for ${providerKey}, using ${availableModel} instead`);
        return { provider, model: availableModel, providerKey };
      }
    }
    const fallback = providers[AI_PROVIDERS.REPLIT_ANTHROPIC];
    if (fallback?.isAvailable()) {
      return { provider: fallback, model: "claude-sonnet-4-5", providerKey: AI_PROVIDERS.REPLIT_ANTHROPIC };
    }
    throw new Error("No AI provider available");
  }

  return { provider, model, providerKey };
}

export function getProvider(providerKey: string): IAIProvider | undefined {
  return providers[providerKey];
}

export function getAllProviderStatuses(): Array<{
  key: string;
  name: string;
  available: boolean;
  models: readonly string[];
  aoaiAvailable?: boolean;
  inferenceAvailable?: boolean;
}> {
  return Object.entries(providers).map(([key, provider]) => {
    const allModels = AI_MODELS[key] ?? [];
    const base: {
      key: string;
      name: string;
      available: boolean;
      models: readonly string[];
      aoaiAvailable?: boolean;
      inferenceAvailable?: boolean;
    } = {
      key,
      name: provider.providerName,
      available: provider.isAvailable(),
      models: allModels,
    };
    if (key === AI_PROVIDERS.AZURE_FOUNDRY && provider instanceof AzureFoundryProvider) {
      const aoai = !!(process.env.AZURE_FOUNDRY_OPENAI_ENDPOINT && process.env.AZURE_FOUNDRY_API_KEY);
      const inference = !!(process.env.AZURE_FOUNDRY_PROJECT_ENDPOINT && process.env.AZURE_FOUNDRY_API_KEY);
      base.aoaiAvailable = aoai;
      base.inferenceAvailable = inference;
      base.models = allModels.filter(m => {
        const ept = AZURE_FOUNDRY_MODEL_ENDPOINT[m];
        if (ept === 'inference') return inference;
        return aoai;
      });
    }
    return base;
  });
}

export function getAvailableModelsByProvider(): Record<string, string[]> {
  const statuses = getAllProviderStatuses();
  const result: Record<string, string[]> = {};
  for (const s of statuses) {
    result[s.key] = [...s.models];
  }
  return result;
}

export async function completeForFeature(
  feature: AIFeature,
  userPrompt: string,
  options?: AICompletionOptions,
): Promise<AICompletionResult> {
  const resolved = await getProviderForFeature(feature);
  const opts = {
    ...options,
    maxTokens: options?.maxTokens ?? resolved.maxTokens ?? 8192,
  };
  return resolved.provider.complete(resolved.model, userPrompt, opts);
}
