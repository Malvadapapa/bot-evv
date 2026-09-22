# Changelog

Todas las novedades, mejoras y correcciones notables de **Bot-EVV (Mequetrefe)** se documentan en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto se adhiere a [Semantic Versioning](https://semver.org/lang/es/).

---

## [1.1.0] - 2026-09-22

### 🚀 Novedades y Despliegue en Producción
- **Despliegue 24/7 en Windows Server VPS:**
  - Configuración de procesos en paralelo con PM2 a través de [`ecosystem.config.cjs`](ecosystem.config.cjs) (`bot-evv` y `meta-ai-bridge`).
  - Integración de autoarranque con el sistema operativo vía `pm2-windows-startup`.
- **CI/CD con GitHub Actions (Self-Hosted Runner):**
  - Workflow automatizado en [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
  - Detección inteligente de rutas de instalación en Windows Server (`C:\bot-evv`, `C:\Users\Administrador\bot-evv`).
  - Descarga, instalación de dependencias, compilación y reinicio desatendido en segundos ante cada `git push origin main`.
- **Comandos de Actualización y Diagnóstico:**
  - `/actualizar`: Comando exclusivo de administradores para actualizar el bot vía Git y compilar en caliente desde WhatsApp.
  - `/version`: Muestra el estado del sistema, versión activa, entorno VPS y módulos cargados.

### 🛡️ Guardrails y Reglas de Comportamiento (18 Reglas)
- **Rate Limiting de Comandos:**
  - Ventanas de tiempo móviles: Máximo 1 comando/segundo y 30 comandos/hora por usuario.
  - Exención total para administradores y registro auditable en la tabla `command_audit_log`.
- **Límite de Batería Social:**
  - Máximo 15 preguntas directas por hora por usuario con degradación progresiva de paciencia y humor cordobés. Silencio a partir de la interacción 16.
- **Protección de Mensajes Privados (DMs):**
  - Silencio absoluto a usuarios no administradores en privado. Los administradores pueden ejecutar comandos administrativos por DM.
- **Gestión de Ingreso a Grupos con Timeout:**
  - Ignora al 100% grupos no aprobados.
  - Notificación de solicitud a todos los administradores vía DM con identificador `SOL-xxx`.
  - **Timeout de 12 horas:** Si no se aprueba en 12 horas, abandona el grupo automáticamente.
- **Identidad Persistente Desacoplada:**
  - Identificador `bot_instance_id = 'bot-principal'` desacoplado del número telefónico.
- **Filtro de Seguridad @broadcast:**
  - Descarte total a nivel cero de estados de WhatsApp (`status@broadcast`).

### 🎭 Personalidad y "Chamuyo Cordobés"
- **Apodos Dinámicos y Entromisión Pasiva (`/apodo`):**
  - Asignación de palabras clave o apodos a números de teléfono (`/apodo <tel> <apodos...>`).
  - Entromisión espontánea del bot (~45% de probabilidad) etiquetando a la chica con elogios cordobeses cuando se menciona su apodo en el grupo.
- **Banco de 50 Afirmaciones del Horóscopo:**
  - Para usuarias identificadas como mujeres, `/h` y `/horoscopo` siempre incorporan una predicción positiva y cariñosa de Mequetrefe al pie.
- **Cooldown Estricto de 3 Horas:**
  - Ventana de 3 horas (10.800.000 ms) tras un piropo o halago espontáneo para no saturar ni ser cargoso.

---

## [1.0.0] - 2026-09-21

### ✨ Características Iniciales
- **Conexión Nativa de WhatsApp:**
  - Implementación con `@whiskeysockets/baileys` multi-file auth state.
- **Doble Proveedor de Inteligencia Artificial:**
  - Integración con Meta AI (`wa-metaai` bridge en Go/whatsmeow sobre puerto 8788).
  - Fallback concurrente de ultra baja latencia con Groq (modelo Qwen).
- **Personalidad Cordobesa "Mequetrefe":**
  - Prompt del sistema con modismos cordobeses, calidez, picardía y regla de trato por género.
- **Módulos y Comandos:**
  - `/resumen`: Resumen inteligente con checkpoints diarios y mitigación de repetición.
  - `/menciones` y `/marcar`: Registro de menciones con paginación y reconstrucción de contexto de conversación.
  - `/registrarse`: Registro de fecha de cumpleaños y pronombre en SQLite.
  - `/h` y `/h largo`: Horóscopo diario con caché de 24 horas y soporte para los 12 signos zodiacales.
  - `/top`: Tabla de posiciones con los 10 participantes más activos del grupo.
  - `/noticias`: Despacho diario matutino (08:00 hs) y bajo demanda de noticias tecnológicas desde fuentes RSS limpias.
  - Gestión de inactividad, alerta de miembros fantasma (+7 días) y felicitaciones preventivas de cumpleaños (12:00 hs).
