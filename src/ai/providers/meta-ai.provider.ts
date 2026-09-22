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

    const embeddedPrompt = options?.rawPrompt
      ? prompt
      : buildMetaAIPrompt(prompt, historySummary, {
          userGender: options?.userGender,
          userName: options?.userName,
          isFlirting: options?.isFlirting,
          isReplyingToBotJoke: options?.isReplyingToBotJoke,
          personalityDirective: options?.personalityDirective
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

    if (this.isCannedRefusal(content)) {
      console.warn(`🛡️ [MetaAIProvider] Detectada respuesta de rechazo/censura de Meta AI: "${content.slice(0, 80)}...". Forzando fallback a proveedor secundario.`);
      throw new Error(`Meta AI rechazó la solicitud con respuesta enlatada: "${content.slice(0, 100)}"`);
    }

    console.log(`✅ [MetaAIProvider] Respuesta recibida de Meta AI Bridge en ${elapsed}s (${content.length} caracteres)`);
    if (options?.rawPrompt) {
      return content.trim();
    }
    return this.cleanResponse(content);
  }

  /**
   * Detecta si la respuesta es un rechazo / censura estándar de Meta AI
   */
  public isCannedRefusal(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return (
      lower.includes("sorry, i can't help you with this request") ||
      lower.includes("sorry, i cannot help with this request") ||
      lower.includes("i can't help with that request") ||
      lower.includes("i'm unable to assist with this request") ||
      lower.includes("i cannot fulfill this request") ||
      lower.includes("no puedo ayudarte con esta solicitud") ||
      lower.includes("no puedo cumplir con esta solicitud") ||
      lower.includes("no puedo generar contenido que") ||
      lower.includes("as an ai developed by meta") ||
      lower.includes("como modelo de lenguaje de meta") ||
      (lower.includes("sorry, i can't") && lower.includes("help you with"))
    );
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
