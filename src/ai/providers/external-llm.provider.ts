import type { AIProvider, ChatMessage } from '../types.js';
import { buildSystemPrompt } from '../../config/character.js';

export type ExternalProviderType = 'groq' | 'together' | 'openrouter';

const ENDPOINTS: Record<ExternalProviderType, string> = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  together: 'https://api.together.xyz/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions'
};

const DEFAULT_MODELS: Record<ExternalProviderType, string> = {
  groq: 'qwen/qwen3.8-27b',
  together: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
  openrouter: 'meta-llama/llama-3.3-70b-instruct'
};

export class ExternalLLMProvider implements AIProvider {
  public readonly name: string;
  private endpoint: string;
  private model: string;

  constructor(
    private providerType: ExternalProviderType,
    private apiKey: string,
    modelName?: string
  ) {
    this.name = `External LLM (${providerType.toUpperCase()})`;
    this.endpoint = ENDPOINTS[providerType] || ENDPOINTS.groq;
    this.model = modelName || DEFAULT_MODELS[providerType] || DEFAULT_MODELS.groq;
  }

  public get isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public async generateReply(
    prompt: string,
    history: ChatMessage[],
    options?: import('../types.js').GenerateReplyOptions
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error(`API key no configurada para el proveedor ${this.providerType} (AI_API_KEY vacía en .env)`);
    }

    const systemContent = options?.systemPrompt || buildSystemPrompt({
      userGender: options?.userGender,
      userName: options?.userName,
      isFlirting: options?.isFlirting,
      isReplyingToBotJoke: options?.isReplyingToBotJoke,
      personalityDirective: options?.personalityDirective
    });

    const messages: Array<{ role: string; content: string }> = [
      {
        role: 'system',
        content: systemContent
      }
    ];

    // Añadir historial reciente (últimos 6 mensajes)
    for (const msg of history.slice(-6)) {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: `${msg.senderName}: ${msg.text}`
      });
    }

    // Añadir el mensaje actual
    messages.push({
      role: 'user',
      content: prompt
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      console.log(`🌐 [ExternalLLMProvider] Consultando ${this.name} con modelo ${this.model}...`);
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.7,
          max_tokens: options?.maxTokens || 600
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status} de ${this.name}: ${errText}`);
      }

      const data = (await response.json()) as any;
      const content = data.choices?.[0]?.message?.content?.trim();

      if (!content) {
        throw new Error(`Respuesta vacía recibida de ${this.name}`);
      }

      return content;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error(`Timeout agotado (25s) consultando ${this.name}`);
      }
      throw err;
    }
  }
}
