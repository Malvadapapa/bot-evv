/**
 * Gestión de versiones y registro de cambios (Changelog) para Mequetrefe
 */

export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  highlights: string[];
  fixes: string[];
}

export const CURRENT_VERSION: ReleaseNote = {
  version: '1.2.4',
  date: '24/09/2026',
  title: 'Fallback inteligente en Meta AI, sanitización de LIDs y mejoras en avisos grupales',
  highlights: [
    'Fallback automático e invisible a Groq/Qwen/Gemini ante caídas o sobrecargas de Meta AI ("Something went wrong")',
    'Avisos preventivos de cumpleaños (12:00) y saludos matutinos (08:00) con nombre real y mención interactiva en WhatsApp',
    'Recordatorios para todo el grupo con etiqueta limpia @all y plantillas renovadas con autenticidad cordobesa',
    'Eliminación total del auto-etiquetado del bot en avisos grupales y personales',
    'Aislamiento estricto de interlocutor en prompts para evitar cruce de identidades entre miembros'
  ],
  fixes: [
    'Corregida fuga de LIDs numéricos (@242425150869604) en avisos de cumpleaños, inactividad y recordatorios',
    'Corregido el reenvío de mensajes de error de backend de Meta AI a los grupos de WhatsApp',
    'Corregida omisión de menciones interactivas (mentions array) en avisos del Scheduler',
    'Corregida la forzada conversión a @s.whatsapp.net de apodos registrados con LID'
  ]
};

export const CHANGELOG_HISTORY: ReleaseNote[] = [
  CURRENT_VERSION,
  {
    version: '1.2.3',
    date: '23/09/2026',
    title: 'Avisos a todo el grupo con mención real (@all) y difusión de updates a demanda',
    highlights: [
      'Avisos y recordatorios para todo el grupo (@all, @todos) con notificación/mención real a todos los miembros',
      'Limpieza inteligente de frases coloquiales y de pedido ("quiero que avises que...", "deciles que...")',
      'Difusión de novedades y features bajo demanda (/novedades broadcast o a pedido) para no saturar con fixes'
    ],
    fixes: [
      'Corregido error por el cual @all y @todos no eran reconocidos al programar recordatorios grupales',
      'Desactivada la difusión automática en cada reinicio para permitir acumular mejoras durante el desarrollo'
    ]
  },
  {
    version: '1.2.2',
    date: '23/09/2026',
    title: 'Precisión en recordatorios, disparadores naturales y plantillas dinámicas',
    highlights: [
      'Entrega de recordatorios de alta precisión (cada 3 segundos) para tiempos cortos como 15 o 30 segundos',
      'Soporte completo de disparadores naturales ("podés recordarme dentro de 15 segundos")',
      'Plantillas dinámicas con estilo cordobés natural, variadas y adaptadas al género del usuario'
    ],
    fixes: [
      'Corregido error donde el bot se etiquetaba a sí mismo al programar o entregar un recordatorio',
      'Corregido error en /recordar que fallaba por no reconocer los parámetros del comando',
      'Corregido error que mostraba el JID/LID numérico en lugar del nombre real de la persona',
      'Los auto-recordatorios personales ya no muestran la línea "Para: @..." en la confirmación'
    ]
  },
  {
    version: '1.2.1',
    date: '23/09/2026',
    title: 'Avisos y recordatorios programados, identidad estricta y mejoras en registro',
    highlights: [
      'Sistema de avisos y recordatorios por chat (/recordar o en lenguaje natural)',
      'Soporte para recordar a un tercero (@usuario), a todo el grupo (@todos) o auto-recordatorio',
      'Límite de 2 recordatorios por usuario y administración por privado'
    ],
    fixes: [
      'Regla estricta de identidad: el bot respeta siempre el nombre real de WhatsApp y no inventa nombres ajenos',
      'El comando /registrarse ahora acepta fecha y pronombre juntos en una sola línea y tolera corchetes [ ]',
      'Bienvenida a nuevos usuarios corregida sin mensajes confusos'
    ]
  },
  {
    version: '1.2.0',
    date: '23/09/2026',
    title: 'Aislamiento de contexto por grupo, Multi-grupo en Scheduler y Changelog automático',
    highlights: [
      'Aislamiento estricto de contexto entre grupos para que no se mezclen las conversaciones ni recuerdos',
      'El saludo matutino, clima y noticias ahora se envían a todos los grupos autorizados (EVV y pruebas)',
      'Sistema automático de resumen de versión con novedades y arreglos cada vez que se actualiza el bot',
      'Nuevo comando /novedades (o /changelog) para consultar las mejoras y cambios recientes'
    ],
    fixes: [
      'Corregido el scheduler para no limitar el saludo diario y noticias a un único grupo de pruebas',
      'Corregida la fuga de contexto entre chats grupales en las respuestas con Meta AI',
      'Corregido el mensaje de bienvenida/onboarding para evitar duplicaciones'
    ]
  },
  {
    version: '1.1.0',
    date: '22/09/2026',
    title: 'Horóscopo, apodos y mejoras de personalidad cordobesa',
    highlights: [
      'Nuevo comando de horóscopo diario y predicciones cordobesas para chicas',
      'Sistema de apodos y menciones para intervenir con humor compinche',
      'Mejoras en el estilo de habla cordobés y naturalidad en WhatsApp'
    ],
    fixes: [
      'Optimización de tiempos de respuesta del bridge de Meta AI'
    ]
  },
  {
    version: '1.0.0',
    date: '21/09/2026',
    title: 'Lanzamiento oficial de Mequetrefe',
    highlights: [
      'Mascota oficial del grupo de WhatsApp con personalidad de Córdoba Capital',
      'Integración dual Meta AI + Groq Qwen para respuestas rápidas y naturales',
      'Reporte matutino con efemérides, clima de Córdoba/Argentina y noticias de software'
    ],
    fixes: []
  }
];

/**
 * Plantilla amigable de WhatsApp para comunicar la actualización a los grupos.
 * Si es una segunda actualización en el mismo día, genera un mensaje con tono de continuidad.
 */
export function buildUpdateBroadcastMessage(
  release: ReleaseNote = CURRENT_VERSION,
  isSameDayContinuation: boolean = false
): string {
  const highlightsList = release.highlights.map((h) => `• ${h}`).join('\n');
  const fixesList = release.fixes.length > 0
    ? `\n\n🔧 *Correcciones y Ajustes:*\n${release.fixes.map((f) => `• ${f}`).join('\n')}`
    : '';

  if (isSameDayContinuation) {
    return [
      `🚀 *¡Mequetrefe sumó más mejoras hoy! (v${release.version})* 🐶✨`,
      `---------------------------------------`,
      `¡Gente! Se acaban de incorporar más cambios y ajustes hoy completando la actualización anterior:`,
      '',
      `✨ *Novedades:*`,
      highlightsList,
      fixesList,
      '',
      `---------------------------------------`,
      `💡 _Pueden ver todos los cambios acumulados poniendo \`/version\` 😉_`
    ].join('\n');
  }

  return [
    `🚀 *¡Mequetrefe se actualizó a la versión v${release.version}!* 🐶✨`,
    `---------------------------------------`,
    `¡Buenas gente! Acabo de recibir una actualización fresquita con mejoras para andar diez puntos en el grupo:`,
    '',
    `✨ *Novedades y Mejoras:*`,
    highlightsList,
    fixesList,
    '',
    `---------------------------------------`,
    `💡 _Cualquier cosita rara le avisan a Cristian o ponen \`/ayuda\`. ¡A seguir metiéndole onda!_ 🧉💬`
  ].join('\n');
}
