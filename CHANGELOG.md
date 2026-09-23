# Changelog de Mequetrefe

Todas las novedades, mejoras y correcciones del bot de WhatsApp para grupos.

---

## [v1.2.1] - 2026-09-23
### ✨ Novedades y Mejoras
- **Sistema de avisos y recordatorios programados:** Soporte para programar recordatorios por chat en lenguaje natural o vía `/recordar <tiempo> <mensaje>`.
- **Menciones destinatarias:** Soporte para recordar a un tercero (`@usuario`), a todo el grupo (`@todos`) o auto-recordatorio personal.
- **Límites de uso y panel de admin en privado:** Límite de 2 recordatorios activos por usuario común (sin límite para administradores) y gestión completa por mensaje privado (DM).
- **Changelog continuo:** Detección de múltiples actualizaciones en el mismo día con mensaje de continuidad y comando `/version` con desglose detallado de novedades y correcciones.

### 🔧 Correcciones
- **Identidad real de usuarios:** Inyección obligatoria del nombre real de WhatsApp (`userName`) en los prompts de IA con prohibición estricta de inferir o inventar nombres ajenos (soluciona la confusión de nombres como "Pablo" vs "Leandro").
- **Parser tolerante de `/registrarse`:** Soporte completo para entradas con corchetes `[ ]` o paréntesis (ej: `/registrarse 27/06 [el]`), y registro atómico de fecha + pronombre en una sola línea.
- **Onboarding limpio para nuevos usuarios:** Bienvenida cordial sin el chiste confuso de base de datos en Excel y sin corchetes en los ejemplos de comando.

---

## [v1.2.0] - 2026-09-23
### ✨ Novedades y Mejoras
- **Aislamiento estricto de contexto entre grupos:** Cada grupo tiene su propio historial y contexto aislado; Meta AI y los LLMs ya no mezclan temas ni personas entre distintos grupos.
- **Distribución multi-grupo en Scheduler:** El saludo matutino (08:00), clima, efemérides y noticias de tecnología ahora se envían a todos los grupos autorizados (EVV y grupo de pruebas), respetando el registro de grupos.
- **Sistema de notificación de actualizaciones (Changelog):** Notificación automática con plantilla amigable a todos los grupos tras cada actualización del bot.
- **Nuevo comando `/novedades` (o `/changelog`):** Permite a cualquier miembro consultar la versión actual, mejoras y correcciones incorporadas. Comando de broadcast exclusivo para admin (`/novedades broadcast`).

### 🔧 Correcciones
- Solucionado el problema donde las noticias y el saludo de la mañana solo se enviaban al grupo de pruebas.
- Solucionada la fuga de memoria cruzada en Meta AI donde el bot recordaba información de un grupo mientras respondía en otro.
- Corregida la duplicación del mensaje de bienvenida/onboarding en reinicios o mensajes seguidos.

---

## [v1.1.0] - 2026-09-22
### ✨ Novedades y Mejoras
- **Horóscopo diario:** Predicciones cordobesas y banco de 50 halagos exclusivos para chicas con el comando `/horoscopo`.
- **Sistema de apodos y entromisión compinche:** Soporte para `/apodo` asociando palabras clave a integrantes para intervenciones graciosas.
- **Personalidad y tono cordobés:** Ajuste en modismos naturales y soltura de chat.

### 🔧 Correcciones
- Optimización de latencia en Meta AI Bridge.
- Rate limiting y guardrails de batería social adaptativos.

---

## [v1.0.0] - 2026-09-21
### ✨ Lanzamiento Oficial
- Personalidad de Mequetrefe (Córdoba Capital).
- Resúmenes automáticos y manuales con `/resumen`.
- Recordatorio de cumpleaños y felicitaciones automáticas.
- Estadísticas de actividad con `/top`.
