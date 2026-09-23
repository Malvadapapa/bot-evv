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
};

export const CHANGELOG_HISTORY: ReleaseNote[] = [
  CURRENT_VERSION,
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
 * Plantilla amigable de WhatsApp para comunicar la actualización a los grupos
 */
export function buildUpdateBroadcastMessage(release: ReleaseNote = CURRENT_VERSION): string {
  const highlightsList = release.highlights.map((h) => `• ${h}`).join('\n');
  const fixesList = release.fixes.length > 0
    ? `\n\n🔧 *Correcciones y Ajustes:*\n${release.fixes.map((f) => `• ${f}`).join('\n')}`
    : '';

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
