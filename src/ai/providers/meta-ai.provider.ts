import type { AIProvider, ChatMessage } from '../types.js';
import { buildMetaAIPrompt } from '../../config/character.js';

export class MetaAIProvider implements AIProvider {
  public readonly name = 'Meta AI (Bridge)';

  constructor(
    private bridgeUrl: string = 'http://localhost:8788',
    private timeoutMs: number = 90000
  ) {}

  /** Indica si el proveedor tiene una URL de bridge configurada */
  public get isConfigured(): boolean {
    return Boolean(this.bridgeUrl && this.bridgeUrl.trim().length > 0);
  }

  public async generateReply(
    prompt: string,
    history: ChatMessage[],
    options?: import('../types.js').GenerateReplyOptions
  ): Promise<string> {
    if (!this.bridgeUrl) {
      throw new Error('META_AI_BRIDGE_URL no configurada en variables de entorno');
    }

    // Formatear historial corto como contexto si existe (últimos 6 mensajes)
    let historySummary: string | undefined;
    if (history.length > 0) {
      historySummary = history
        .slice(-6)
        .map((m) => `${m.senderName}: ${m.text}`)
        .join('\n');
    }

    const embeddedPrompt = buildMetaAIPrompt(prompt, historySummary, {
      userGender: options?.userGender,
      isReplyingToBotJoke: options?.isReplyingToBotJoke
    });

    console.log(`➡️ [MetaAIProvider] Consultando bridge Meta AI en ${this.bridgeUrl}...`);
    const startTime = Date.now();

    const response = await fetch(`${this.bridgeUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'meta-ai',
        messages: [
          {
            role: 'user',
            content: embeddedPrompt
          }
        ]
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Bridge respondió con error HTTP ${response.status}: ${errorText || response.statusText}`);
    }

    const data = (await response.json()) as any;
    const content = data?.choices?.[0]?.message?.content;

    if (!content || typeof content !== 'string') {
      throw new Error('Respuesta inválida o vacía recibida desde Meta AI Bridge');
    }

    console.log(`✅ [MetaAIProvider] Respuesta recibida de Meta AI Bridge en ${elapsed}s (${content.length} caracteres)`);
    return this.cleanResponse(content);
  }

  /**
   * Limpia preámbulos explicativos o etiquetas de guion de Meta AI
   */
  private cleanResponse(text: string): string {
    let cleaned = text.trim();
    // Extraer directamente el diálogo si Meta AI lo devuelve entre comillas o con prefijo de personaje
    const quotedMatch = cleaned.match(/(?:Mequetrefe:\s*)?["'«“]([^"'»”]{10,})["'»”]/i);
    if (quotedMatch && quotedMatch[1]) {
      return quotedMatch[1].trim();
    }
    // Eliminar preámbulos explicativos típicos
    cleaned = cleaned.replace(/^(?:Te paso|Acá tenés|Aquí va|Para el personaje|Como personaje|Aquí tienes)[^\n:]*:\s*/i, '');
    cleaned = cleaned.replace(/^\*{0,2}Mequetrefe:\*{0,2}\s*/i, '');
    cleaned = cleaned.replace(/^["'«“](.*)["'»”]$/s, '$1');
    return cleaned.trim();
  }
}
