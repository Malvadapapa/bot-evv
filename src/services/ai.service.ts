import { MetaAIProvider } from '../ai/providers/meta-ai.provider.js';
import { ExternalLLMProvider } from '../ai/providers/external-llm.provider.js';
import type { ChatMessage } from '../ai/types.js';
import type { StoredMessage } from '../database/repositories/message.repository.js';
import { character, formatWhatsAppText } from '../config/character.js';

export interface AIServiceConfig {
  metaProvider?: MetaAIProvider;
  externalProvider?: ExternalLLMProvider;
}

export class AIService {
  private metaProvider?: MetaAIProvider;
  private externalProvider?: ExternalLLMProvider;
  private isMetaAiBusy: boolean = false;

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
   * Concurrencia inteligente: si Meta AI está ocupado (demora 7-8s),
   * deriva inmediatamente en paralelo al proveedor externo (Groq / OpenRouter, ~400ms)
   * para no descartar ni retrasar ningún mensaje.
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

    // Concurrencia: si Meta AI está ocupado con otra solicitud y hay proveedor externo configurado,
    // respondemos en paralelo de inmediato por el proveedor externo.
    if (this.isMetaAiBusy && this.externalProvider && this.externalProvider.isConfigured) {
      console.log(`⚡ [AIService] Meta AI ocupado con otra solicitud. Derivando concurrentemente a ${this.externalProvider.name} en paralelo.`);
      try {
        reply = await this.externalProvider.generateReply(prompt, history, options);
        providerUsed = `${this.externalProvider.name}-concurrent`;
      } catch (err: any) {
        console.warn(`⚠️ [AIService] Fallback concurrente falló: ${err?.message || err}. Esperando a Meta AI.`);
      }
    }

    // 1. Intentar con Meta AI si no se respondió concurrentemente y está configurado
    if (!reply && this.metaProvider && this.metaProvider.isConfigured) {
      this.isMetaAiBusy = true;
      try {
        reply = await this.metaProvider.generateReply(prompt, history, options);
        providerUsed = this.metaProvider.name;
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ [AIService] Meta AI falló: ${err?.message || err}. Pasando a fallback.`);
      } finally {
        this.isMetaAiBusy = false;
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
      text: formatWhatsAppText(reply),
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
      personalityDirective?: string;
    }
  ): Promise<string> {
    const formattedPrompt = `${senderName}: ${prompt}`;
    const result = await this.generateConversationReply(formattedPrompt, recentHistory, {
      userGender: options?.userGender,
      userName: options?.userName || senderName,
      isFlirting: options?.isFlirting,
      isReplyingToBotJoke: options?.isReplyingToBotJoke,
      personalityDirective: options?.personalityDirective
    });
    return result.text;
  }

  /**
   * Genera una intervención espontánea con humor cordobés cuando se menciona a un miembro clave
   */
  public async generateSpontaneousIntervention(
    targetName: string,
    recentContext: string,
    isFemale: boolean = false
  ): Promise<string> {
    const instruction = isFemale
      ? `Haz un comentario breve, simpático y pícaro halagando a ${targetName} con admiración cordobesa (por ejemplo: que si hablan de la reina del grupo avisen que te peinás, que llegó la jefa del grupo o que andan todos pendientes de ella). Tono compinche, dulce y divertido con emojis (🐶, ✨, 👑). Máximo 2 oraciones breves. Incluye la mención "@${targetName}".`
      : `Haz una broma breve, cálida y divertida sobre ${targetName} (por ejemplo: que seguro está durmiendo como un tronco, que anda desaparecido, que le dio fiaquita o que se hace el importante). Tono natural y relajado con emojis (🐶, 😂, 😴). No satures de modismos ni uses "culiau". Máximo 2 oraciones breves. Incluye la mención "@${targetName}" en el chiste.`;

    const prompt = `Eres Mequetrefe, la mascota cordobesa oficial del grupo de WhatsApp.
En el grupo acaban de nombrar o hablar sobre ${targetName}.
Contexto reciente de lo que dijeron:
"${recentContext}"

Instrucción:
${instruction}`;

    try {
      if (!this.isMetaAiBusy && this.metaProvider && this.metaProvider.isConfigured) {
        this.isMetaAiBusy = true;
        try {
          return formatWhatsAppText(await this.metaProvider.generateReply(prompt, []));
        } finally {
          this.isMetaAiBusy = false;
        }
      }
      if (this.externalProvider && this.externalProvider.isConfigured) {
        return formatWhatsAppText(await this.externalProvider.generateReply(prompt, [], { maxTokens: 250 }));
      }
    } catch {}

    // Fallback simpático garantizado
    return isFemale
      ? `¡Epa, si hablan de la reina del grupo avisen que me pongo la mejor pilcha! Firme acá a la orden @${targetName} 🐶👑`
      : `Epa che! Hablando de ${targetName}... seguro está durmiendo como un tronco este @${targetName} a esta hora 😂🐶😴`;
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
   * Genera un mensaje de reactivación por inactividad sin repetición de temas
   */
  public async generateInactivityNudge(
    freshContext?: string,
    targetMention?: { phone: string; name: string }
  ): Promise<string> {
    const angleTypes = [
      'humor_silencio',
      'debate_random',
      'chicana_compinche'
    ];
    const chosenAngle = angleTypes[Math.floor(Math.random() * angleTypes.length)];

    let prompt = `El grupo de WhatsApp lleva varias horas en silencio total. Genera un mensaje compinche, ocurrente y divertido para reactivar la conversación como la mascota del grupo. Máximo 2 oraciones breves y con emojis.`;

    if (targetMention) {
      prompt += ` Menciona puntualmente a @${targetMention.phone} (¡usa exactamente "@${targetMention.phone}" para que WhatsApp active el tag!) preguntándole en qué anda o tirándole una chicana sana.`;
    }

    if (freshContext && freshContext.trim().length > 0) {
      prompt += ` Tema reciente del que charlaban: "${freshContext}". Puedes retomarlo con gracia.`;
    } else if (chosenAngle === 'debate_random') {
      prompt += ` Abre un debate random o pregunta cotidiana picante para que todos salten a opinar (ej: debate gastronómico argentino, series, música, clima, mate dulce vs amargo, etc.).`;
    } else {
      prompt += ` Haz un chiste sobre el silencio absoluto del grupo (ej: si se quedaron sin señal, si se durmieron todos, si están esperando que hable el otro, o si parecen un desierto). No hables de comida ni de hambre salvo que el contexto lo pida explícitamente.`;
    }

    try {
      if (this.externalProvider && this.externalProvider.isConfigured) {
        return (await this.externalProvider.generateReply(prompt, [])).trim();
      }
      if (this.metaProvider && this.metaProvider.isConfigured) {
        return (await this.metaProvider.generateReply(prompt, [])).trim();
      }
    } catch (e) {}

    // Fallbacks dinámicos seguros
    if (targetMention) {
      return `🤖 ¡El grupo está sospechosamente quieto! @${targetMention.phone} tirá un centro che, ¿en qué andás hoy? 👀☕`;
    }
    const fallbackNudges = [
      '🤖 Che, este grupo está más silencioso que biblioteca de noche... ¿Todos sobrevivieron al día o qué onda? 😂☕',
      '👀 ¿Se les cortó el WiFi a todos o están esperando que hable el otro para saltar? Despierten che 🚀',
      '🤔 Pregunta seria para romper el hielo en este desierto: ¿el mate va con o sin yuyos? Abran debate 👇🧉',
      '🐶 Che, asomo la patita porque acá no vuela una mosca... ¿en qué andan metidos hoy? ✨'
    ];
    return fallbackNudges[Math.floor(Math.random() * fallbackNudges.length)];
  }

  /**
   * Genera un mensaje humorístico de "Búsqueda de Paradero" para miembros inactivos (+7 días)
   */
  public async generateGhostMemberCallout(userPhone: string, userName: string, daysInactive: number): Promise<string> {
    const prompt = `Un miembro del grupo de WhatsApp (${userName}) lleva ${daysInactive} días sin escribir un solo mensaje. Genera un aviso divertido y con mucha buena onda de "Búsqueda de Paradero / Alerta Fantasma" etiquetando a @${userPhone} (debes incluir exactamente "@${userPhone}" en el texto). Pregúntale si está vivo, si lo secuestraron los extraterrestres o si cambió de vida, y pídele que mande una señal de vida aunque sea un sticker. Máximo 2 oraciones, tono compinche argentino con emojis.`;

    try {
      if (this.externalProvider && this.externalProvider.isConfigured) {
        return (await this.externalProvider.generateReply(prompt, [])).trim();
      }
      if (this.metaProvider && this.metaProvider.isConfigured) {
        return (await this.metaProvider.generateReply(prompt, [])).trim();
      }
    } catch (e) {}

    return `👻 *REPORTE DE PERSONAS PERDIDAS* 🔍\nChe @${userPhone}, ¡hace más de una semana que no te leemos por acá! ¿Todo bien o te tragó la tierra? 🛸 ¡Mandá una señal de vida aunque sea un sticker che! 😂`;
  }

  /**
   * Genera una intervención espontánea ingeniosa y compinche sobre la conversación activa
   */
  public async generateSpontaneousChimeIn(recentConversation: string): Promise<string> {
    const prompt = `Estás escuchando la conversación en un grupo de amigos de WhatsApp donde eres la mascota compinche (Mequetrefe / Vector).
Los humanos están charlando de esto:
"""
${recentConversation}
"""
Entrométete de forma espontánea, breve y divertida (máximo 1 o 2 oraciones). Puedes acotar un remate gracioso, dar una opinión inesperada o tirar una chicana de buena onda sobre lo que están hablando. Habla como un argentino real en WhatsApp, sin ser pesado.`;

    try {
      if (this.externalProvider && this.externalProvider.isConfigured) {
        return formatWhatsAppText(await this.externalProvider.generateReply(prompt, []));
      }
      if (!this.isMetaAiBusy && this.metaProvider && this.metaProvider.isConfigured) {
        this.isMetaAiBusy = true;
        try {
          return formatWhatsAppText(await this.metaProvider.generateReply(prompt, []));
        } finally {
          this.isMetaAiBusy = false;
        }
      }
    } catch (e) {}

    return `Perdón que me meta che, pero venía leyendo la charla y no podía quedarme callado... ¡qué temita metieron sobre la mesa! 😂🍿`;
  }

  /**
   * Colección de al menos 16 aperturas dinámicas con energía positiva
   */
  private static readonly MORNING_GREETINGS = [
    '☀️ *¡Buen día, gente!* Espero que hayan arrancado el día con todo ☕🚀',
    '☀️ *¡Arriba ese ánimo, equipo!* Que hoy sea una gran jornada para todos ☕✨',
    '☕ *¡Buen día para todos!* Taza de café en mano y a encarar la jornada con la mejor vibra 🚀',
    '🌅 *¡Muy buenos días a toda la banda!* Arrancamos un nuevo día con todo el ritmo 🧉⚡',
    '☀️ *¡Buen día, gente linda!* Espero que hayan descansado de diez y estén listos para romperla hoy 💪🚀',
    '🧉 *¡Buen día a todos!* Mate listo y a encarar este día con toda la energía ✨',
    '☀️ *¡Hola a todos!* ¡Muy buen día! Que tengan una jornada productiva y sin dolores de cabeza ☕😎',
    '🚀 *¡Buen día!* Nuevo día, nuevas metas. ¡A darle para adelante con todo! ☕💪',
    '✨ *¡Muy buenos días!* Que tengan un día espectacular y lleno de buenas noticias ☕🎉',
    '☀️ *¡Arriba gente!* Ya amaneció y hay que meterle pilas a esta jornada 🧉🚀',
    '☕ *¡Buen día, cracks!* Que no falte el café ni las ganas de encarar la rutina hoy 💻🔥',
    '🌅 *¡Buen día, gente bella!* Arrancamos con toda la actitud positiva para hoy ☕✨',
    '☀️ *¡Buenas, buenas!* Espero que arranquen este día con una sonrisa y pilas recargadas 🚀🧉',
    '🔥 *¡Buen día a todo el grupo!* A ponerle garra y buena onda a lo que toque hacer hoy ☕💪',
    '☀️ *¡Buen día a la mejor comunidad!* Que tengan una jornada liviana, productiva y de diez ☕🙌',
    '☕ *¡Arriba todo el mundo!* Despertando motores para tener un día increíble 🚀✨'
  ];

  /**
   * Genera un saludo matutino dinámico variando entre 16+ opciones o mediante IA si está disponible.
   * REGLA ESTRICTA: El saludo no debe mencionar días de la semana ni fechas, para no duplicar ni contradecir el renglón de la fecha.
   */
  public async generateDynamicMorningGreeting(dayInfo?: string): Promise<string> {
    const greetings = AIService.MORNING_GREETINGS;
    const randomFallback = greetings[Math.floor(Math.random() * greetings.length)];
    const daysRegex = /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i;

    // Si hay IA disponible, intentamos enriquecer o variar dinámicamente
    if (this.metaProvider && this.metaProvider.isConfigured) {
      try {
        const prompt = `Genera un saludo matutino breve y cálido (máximo 1 línea) para un grupo de WhatsApp de amigos en Argentina. Usa emojis de mañana y café (☀️, ☕, 🚀, 🧉). Tono compinche y con buena onda.
REGLA ESTRICTA Y OBLIGATORIA:
PROHIBIDO TERMINANTEMENTE mencionar días de la semana (NO digas lunes, martes, miércoles, etc.) ni fechas numéricas, ya que la fecha exacta se imprime justo debajo. Solo desea un gran día o saluda alegremente. Directo al grano sin comillas.`;
        const reply = await this.metaProvider.generateReply(prompt, [], { rawPrompt: true });
        if (reply && reply.length >= 10 && reply.length <= 150 && !daysRegex.test(reply)) {
          return reply.trim();
        }
      } catch {}
    } else if (this.externalProvider && this.externalProvider.isConfigured) {
      try {
        const prompt = `Genera un saludo matutino breve y alegre (1 línea) para WhatsApp. Emojis (☀️, ☕, 🚀). PROHIBIDO mencionar días de la semana ni fechas. Solo la frase de saludo, sin comillas.`;
        const reply = await this.externalProvider.generateReply(prompt, [], { maxTokens: 80 });
        if (reply && reply.length >= 10 && reply.length <= 150 && !daysRegex.test(reply)) {
          return reply.trim();
        }
      } catch {}
    }

    return randomFallback;
  }

  /**
   * Genera un resumen corto y atractivo de 1 a 2 oraciones para una noticia tech usando Meta AI Bridge (o fallback)
   */
  public async summarizeNewsArticle(title: string, link: string, snippet?: string): Promise<string> {
    const cleanSnippet = snippet ? snippet.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    const detailPart = cleanSnippet ? `\nDetalles del artículo: "${cleanSnippet}"` : '';
    const prompt = `Resume en 1 o 2 oraciones breves, claras y atractivas en español para WhatsApp la siguiente noticia de tecnología:\nTítulo: ${title}${detailPart}\nEnlace: ${link}\nEntrega ÚNICAMENTE el resumen breve en texto plano, directo al grano, sin saludos ni introducciones ni comillas.`;

    // 1. Prioridad: Meta AI Bridge
    if (this.metaProvider && this.metaProvider.isConfigured) {
      try {
        const reply = await this.metaProvider.generateReply(prompt, [], { rawPrompt: true });
        if (reply && reply.trim().length > 15) {
          return reply.trim();
        }
      } catch (err: any) {
        console.warn(`⚠️ [AIService] Falló resumen con Meta AI Bridge: ${err?.message || err}. Intentando fallback.`);
      }
    }

    // 2. Fallback: Proveedor externo si está disponible
    if (this.externalProvider && this.externalProvider.isConfigured) {
      try {
        const reply = await this.externalProvider.generateReply(prompt, [], { maxTokens: 120 });
        if (reply && reply.trim().length > 15) {
          return reply.trim();
        }
      } catch {}
    }

    // 3. Fallback estático con snippet limpio o título
    if (cleanSnippet && cleanSnippet.length > 25) {
      return cleanSnippet.endsWith('.') ? cleanSnippet : `${cleanSnippet}...`;
    }

    return `Novedad sobre ${title}. Te invitamos a leer los detalles completos en el enlace.`;
  }
}
