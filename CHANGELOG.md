# Changelog de Mequetrefe

Todas las novedades, mejoras y correcciones del bot de WhatsApp para grupos.

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
