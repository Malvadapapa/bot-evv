import { MetaAIProvider } from '../ai/providers/meta-ai.provider.js';
import { ExternalLLMProvider } from '../ai/providers/external-llm.provider.js';
import type { ChatMessage } from '../ai/types.js';
import type { StoredMessage } from '../database/repositories/message.repository.js';
import { character } from '../config/character.js';

export interface AIServiceConfig {
  metaProvider?: MetaAIProvider;
  externalProvider?: ExternalLLMProvider;
}

export class AIService {
  private metaProvider?: MetaAIProvider;
  private externalProvider?: ExternalLLMProvider;

  constructor(config: AIServiceConfig) {
    this.metaProvider = config.metaProvider;
    this.externalProvider = config.externalProvider;
  }

  public get hasExternalProvider(): boolean {
    return Boolean(this.externalProvider?.isConfigured);
  }

  public get hasMetaProvider(): boolean {
    return Boolean(this.metaProvider?.isConfigured);
  }

  /**
   * Genera una respuesta conversacional cotidiana.
   * Prioridad 1: Meta AI Bridge (gratuito)
   * Prioridad 2: Fallback externo (Groq / OpenRouter)
   */
  public async generateConversationReply(
    prompt: string,
    history: ChatMessage[] = [],
    options?: import('../ai/types.js').GenerateReplyOptions
  ): Promise<{ text: string; providerUsed: string; latencyMs: number }> {
    const startTime = Date.now();
    let reply: string | undefined;
    let providerUsed = '';
    let lastError: Error | undefined;

    // 1. Intentar con Meta AI si está configurado
    if (this.metaProvider && this.metaProvider.isConfigured) {
      try {
        reply = await this.metaProvider.generateReply(prompt, history, options);
        providerUsed = this.metaProvider.name;
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ [AIService] Meta AI falló: ${err?.message || err}. Pasando a fallback.`);
      }
    }

    // 2. Fallback externo
    if (!reply && this.externalProvider && this.externalProvider.isConfigured) {
      try {
        reply = await this.externalProvider.generateReply(prompt, history, options);
        providerUsed = this.externalProvider.name;
      } catch (err: any) {
        const metaMsg = lastError ? ` (Meta AI: ${lastError.message})` : '';
        throw new Error(`Proveedor externo falló: ${err?.message || err}${metaMsg}`);
      }
    }

    if (!reply) {
      throw new Error('No hay proveedores de IA disponibles para responder.');
    }

    return {
      text: reply.trim(),
      providerUsed,
      latencyMs: Date.now() - startTime
    };
  }

  /**
   * Genera una respuesta conversacional directa para grupos con contexto real
   */
  public async generateGroupReply(
    groupJid: string,
    prompt: string,
    senderName: string,
    recentHistory: ChatMessage[] = [],
    options?: {
      userGender?: 'male' | 'female' | null;
      userName?: string;
      isFlirting?: boolean;
      isReplyingToBotJoke?: boolean;
    }
  ): Promise<string> {
    const formattedPrompt = `${senderName}: ${prompt}`;
    const result = await this.generateConversationReply(formattedPrompt, recentHistory, {
      userGender: options?.userGender,
      userName: options?.userName || senderName,
      isFlirting: options?.isFlirting,
      isReplyingToBotJoke: options?.isReplyingToBotJoke
    });
    return result.text;
  }

  /**
   * Genera una intervención espontánea con humor cordobés cuando se menciona a un miembro clave
   */
  public async generateSpontaneousIntervention(
    targetName: string,
    recentContext: string
  ): Promise<string> {
    const prompt = `Eres Mequetrefe, la mascota cordobesa oficial del grupo de WhatsApp.
En el grupo acaban de nombrar o hablar sobre ${targetName}.
Contexto reciente de lo que dijeron:
"${recentContext}"

Instrucción:
Haz una broma breve, cálida y divertida sobre ${targetName} (por ejemplo: que seguro está durmiendo como un tronco, que anda desaparecido, que le dio fiaquita o que se hace el importante).
Tono natural y relajado con emojis (🐶, 😂, 😴). No satures de modismos ni uses "culiau".
Máximo 2 oraciones breves. Incluye la mención "@${targetName}" en el chiste.`;

    try {
      if (this.metaProvider && this.metaProvider.isConfigured) {
        return (await this.metaProvider.generateReply(prompt, [])).trim();
      }
      if (this.externalProvider && this.externalProvider.isConfigured) {
        return (await this.externalProvider.generateReply(prompt, [], { maxTokens: 250 })).trim();
      }
    } catch {}

    // Fallback simpático garantizado
    return `¡Epa che! Hablando de ${targetName}... seguro está durmiendo como un tronco este @${targetName} a esta hora 😂🐶😴`;
  }

  /**
   * Genera el resumen incremental del grupo estilo crónica cronológica.
   * REGLA ESTRICTA: Se procesa SÍ O SÍ a través del proveedor externo por API Key
   * (Groq / OpenRouter) para soportar contextos amplios y proteger la cuenta contra baneos en WhatsApp.
   */
  public async generateIncrementalSummary(
    previousSummary: string | null,
    newMessages: StoredMessage[]
  ): Promise<string> {
    if (!this.externalProvider || !this.externalProvider.isConfigured) {
      throw new Error(
        'El comando /resumen requiere configurar una API Key externa (ej: Groq / AI_API_KEY) en .env para procesar historiales sin riesgo de baneo en WhatsApp.'
      );
    }

    if (newMessages.length === 0) {
      return previousSummary || 'Aún no hay mensajes registrados para resumir.';
    }

    // Formatear mensajes nuevos
    const formattedMessages = newMessages
      .map((m) => `[${m.senderName}]: ${m.content}`)
      .join('\n');

    const systemPrompt = `Sos el cronista oficial del grupo de WhatsApp.
Tu misión es redactar un resumen entretenido, con un tono cálido, relajado y con chispa, contando lo más relevante en el orden cronológico en que fue pasando la charla.

Pautas de estilo obligatorias:
1. Encabezado: 📋 *RESUMEN DE LA CHARLA*
2. Desarrollo cronológico por momentos/hitos:
   - Usa subtítulos ingeniosos con emojis según lo que pasó (ejemplos: 💀 *La frase que complicó todo*, 🐶 *El protagonista inesperado*, ❤️ *Momento profundo*, 🛋️ *La tragedia del sillón*, 🐕 *Plot twist jurídico*).
   - No fuerces premios a menos que pinte natural; lo principal es la narrativa entretenida y amigable.
   - Cuenta la anécdota y cita frases textuales memorables de los integrantes entre comillas cuando sumen gracia.
3. Cierre con onda:
   - Un remate divertido o reflexión sobre el grupo.
   - 📌 *En pocas palabras (Timeline):* Tema 1 → Tema 2 → Tema 3...
   - Un toque final simpático ("Un grupo completamente normal. 👍").

Usa formato de WhatsApp (*negrita* con un solo asterisco). No inventes datos que no estén en la conversación.`;

    let prompt = '';
    if (previousSummary) {
      prompt = `Tienes un resumen acumulado de lo conversado previamente en el día:\n"""\n${previousSummary}\n"""\n\nA continuación se presentan los NUEVOS mensajes de la conversación:\n"""\n${formattedMessages}\n"""\n\nPor favor, genera el resumen consolidado manteniendo el estilo de crónica amigable y orden cronológico.`;
    } else {
      prompt = `Conversación a resumir:\n"""\n${formattedMessages}\n"""\n\nPor favor, genera la crónica de la charla de hoy.`;
    }

    const reply = await this.externalProvider.generateReply(prompt, [], {
      maxTokens: 1500,
      systemPrompt
    });
    return reply.trim();
  }

  /**
   * Genera un saludo de cumpleaños personalizado considerando el género/pronombre
   */
  public async generateBirthdayGreeting(
    userName: string,
    gender?: 'male' | 'female' | null
  ): Promise<string> {
    let genderDirective = '';
    if (gender === 'female') {
      genderDirective = ' Trata a la persona como mujer (amiga, genia, crack, cumpleañera).';
    } else if (gender === 'male') {
      genderDirective = ' Trata a la persona como hombre (amigo, fiera, crack, cumpleañero).';
    }

    const prompt = `Genera un saludo de cumpleaños muy cálido, divertido y alegre para @${userName} de parte del grupo de amigos de WhatsApp como Mequetrefe (la mascota del grupo).${genderDirective} Usa modismos argentinos de buena onda ("de una", "a pleno", "crack"), emojis festivos (🎉, 🎂, 🚀, 🐶) y mantenlo breve (máximo 2 oraciones).`;
    try {
      if (this.externalProvider && this.externalProvider.isConfigured) {
        return await this.externalProvider.generateReply(prompt, [], { maxTokens: 250 });
      }
      if (this.metaProvider && this.metaProvider.isConfigured) {
        return await this.metaProvider.generateReply(prompt, []);
      }
    } catch (e) {
      // Fallback estático seguro
    }
    const suffix = gender === 'female' ? 'genia' : gender === 'male' ? 'fiera' : 'crack';
    return `🎉🎂 ¡Muy feliz cumpleaños @${userName} ${suffix}! Que pases un día increíble y que se festeje a pleno 🚀✨🐶`;
  }

  /**
   * Genera un mensaje de reactivación por inactividad
   */
  public async generateInactivityNudge(recentContext: string, targetUserName?: string): Promise<string> {
    let prompt = `El grupo de WhatsApp ha estado inactivo durante varias horas. Genera un mensaje ocurrente, divertido y cercano para reactivar la charla. Máximo 2 oraciones y con emojis.`;
    if (targetUserName) {
      prompt += ` Puedes mencionar con humor a @${targetUserName} preguntándole en qué anda.`;
    }
    if (recentContext) {
      prompt += ` Contexto de lo que hablaban antes: "${recentContext}".`;
    }

    try {
      if (this.externalProvider && this.externalProvider.isConfigured) {
        return (await this.externalProvider.generateReply(prompt, [])).trim();
      }
      if (this.metaProvider && this.metaProvider.isConfigured) {
        return (await this.metaProvider.generateReply(prompt, [])).trim();
      }
    } catch (e) {}

    return targetUserName
      ? `🤖 ¡El grupo está demasiado silencioso che! @${targetUserName} ¿en qué andás metido hoy? 👀☕`
      : `🤖 Este grupo está sospechosamente tranquilo... ¿Todos sobrevivieron al día o están esperando que hable el otro? 😂☕`;
  }
}
