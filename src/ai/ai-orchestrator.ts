import type { AIProvider, ChatMessage } from './types.js';
import { MetaAIProvider } from './providers/meta-ai.provider.js';
import { ExternalLLMProvider, type ExternalProviderType } from './providers/external-llm.provider.js';

export interface AIResponseResult {
  reply: string;
  providerUsed: string;
  latencyMs: number;
}

export class AIOrchestrator {
  private historyMap = new Map<string, ChatMessage[]>();
  private readonly maxHistoryLength = 6;

  constructor(
    private metaProvider: MetaAIProvider,
    private fallbackProvider?: ExternalLLMProvider
  ) {}

  /**
   * Agrega un mensaje al historial de la conversación
   */
  public recordMessage(chatJid: string, message: ChatMessage) {
    const list = this.historyMap.get(chatJid) || [];
    list.push(message);
    if (list.length > this.maxHistoryLength) {
      list.shift();
    }
    this.historyMap.set(chatJid, list);
  }

  /**
   * Obtiene el historial reciente para una conversación
   */
  public getHistory(chatJid: string): ChatMessage[] {
    return this.historyMap.get(chatJid) || [];
  }

  /**
   * Genera una respuesta intentando primero con Meta AI y luego activando el fallback si es necesario
   */
  public async getReply(chatJid: string, userPrompt: string, senderName: string): Promise<AIResponseResult> {
    const startTime = Date.now();
    const history = this.getHistory(chatJid);

    let reply: string | undefined;
    let providerUsed = '';
    let lastError: Error | undefined;

    // 1. Intento con Meta AI (solo si está configurada)
    if (this.metaProvider.isConfigured) {
      try {
        console.log(`🤖 [AIOrchestrator] Intentando con ${this.metaProvider.name}...`);
        reply = await this.metaProvider.generateReply(userPrompt, history);
        providerUsed = this.metaProvider.name;
      } catch (err: any) {
        console.warn(`⚠️ [AIOrchestrator] ${this.metaProvider.name} falló: ${err?.message || err}`);
        lastError = err;
      }
    }

    // 2. Proveedor externo (primario si Meta AI no configurada, fallback si Meta AI falló)
    if (!reply && this.fallbackProvider) {
      const isPrimary = !this.metaProvider.isConfigured;
      const label = isPrimary ? this.fallbackProvider.name : `${this.fallbackProvider.name} (Fallback)`;
      try {
        console.log(`🌐 [AIOrchestrator] Usando ${label}...`);
        reply = await this.fallbackProvider.generateReply(userPrompt, history);
        providerUsed = label;
      } catch (err: any) {
        const metaMsg = lastError ? ` | Meta AI: ${lastError.message}` : '';
        throw new Error(`${label} falló: ${err?.message || err}${metaMsg}`);
      }
    }

    // 3. Sin proveedores disponibles
    if (!reply) {
      throw new Error(
        'No hay proveedores de IA disponibles. Configura META_AI_JID o AI_API_KEY en tu archivo .env.'
      );
    }

    const latencyMs = Date.now() - startTime;

    // Registrar en historial
    this.recordMessage(chatJid, {
      role: 'user',
      senderName,
      text: userPrompt,
      timestamp: startTime
    });
    this.recordMessage(chatJid, {
      role: 'assistant',
      senderName: 'Mequetrefe',
      text: reply,
      timestamp: Date.now()
    });

    return { reply, providerUsed, latencyMs };
  }
}
