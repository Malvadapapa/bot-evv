# Bot-EVV: WhatsApp Group Bot (Baileys + Meta AI + TypeScript)

Bot inteligente para grupos de WhatsApp desarrollado directamente sobre Node.js y TypeScript (sin Docker ni contenedores). Utiliza **Baileys** para la conexión nativa, reenvía preguntas y respuestas con **Meta AI** dentro de WhatsApp con personalidad (**Mequetrefe**), y cuenta con fallback automático a APIs de LLMs externos (Groq, Together, OpenRouter).

---

## Estructura del Proyecto

```
bot-EVV/
├── docs/
│   └── baileys/                 # Documentación de referencia oficial indexada (Fase 0)
│       ├── INDEX.md             # Mapeo rápido de componentes y casos de uso
│       ├── Types/               # Interfaces y definiciones de TypeScript
│       ├── Socket/              # Métodos de socket, chats, grupos y mensajes
│       └── Example/             # Código de referencia oficial de Baileys
├── src/
│   ├── ai/
│   │   ├── providers/
│   │   │   ├── meta-ai.provider.ts      # Integración directa con el chat de Meta AI
│   │   │   └── external-llm.provider.ts # Fallback OpenAI-compatible (Groq, OpenRouter, Together)
│   │   ├── ai-orchestrator.ts           # Orquestador con memoria de conversación y fallback
│   │   └── types.ts                     # Interfaces desacopladas AIProvider
│   ├── bot/
│   │   └── bot-engine.ts        # Lógica de grupo: filtros, presencia, cooldowns, citas
│   ├── config/
│   │   ├── character.ts         # Personalidad "Mequetrefe", modismos y regla dinámica de nombre
│   │   └── env.ts               # Validación estricta de variables con Zod
│   ├── poc/
│   │   └── poc-meta-ai.ts       # Script de validación mínima y descubrimiento de JIDs (Fase 1)
│   ├── utils/
│   │   └── message.ts           # Desempaquetado seguro de mensajes, menciones y citas
│   └── index.ts                 # Punto de entrada principal (Fase 2)
├── .env.example                 # Plantilla de variables de entorno
├── tsconfig.json                # Configuración TypeScript (NodeNext / ES2022)
└── package.json                 # Dependencias y scripts de ejecución
```

---

## Requisitos Previos

* Node.js v18 o superior (probado en Node.js v24.x).
* Teléfono con WhatsApp instalado para vincular mediante código QR.

---

## Guía Paso a Paso

### 1. Instalación de Dependencias
```bash
npm install
```

---

### 2. Fase 1: Prueba de Concepto (PoC) y Descubrimiento de JID

El script de la Fase 1 valida la conexión, te ayuda a identificar el `remoteJid` exacto de Meta AI en tu cuenta y confirma el reenvío de mensajes:

```bash
npm run poc
```

1. **Escanear el QR**: Aparecerá en la terminal; abre WhatsApp > *Dispositivos vinculados* > *Vincular un dispositivo*.
2. **Descubrimiento de Meta AI**:
   - Envía cualquier mensaje (ej. *"hola"*) al chat de Meta AI desde tu WhatsApp.
   - En la consola aparecerá resaltado el `remoteJid` (por ejemplo: `13135550002@s.whatsapp.net` o similar).
   - Copia ese valor en la variable `META_AI_JID` de tu archivo `.env`.
3. **Descubrimiento del Grupo**:
   - Envía un mensaje en el grupo donde quieras que opere el bot.
   - La consola mostrará: `📢 [GRUPO DETECTADO] remoteJid: "120363xxxxxx@g.us"`.
   - Copia ese valor en `TARGET_GROUP_JID` de tu archivo `.env`.
4. **Validación del flujo**:
   - En el grupo escribe: `@bot ¿Cuál es la distancia a la Luna?`
   - Observa en los logs los 4 pasos:
     1. Mensaje recibido en grupo
     2. Reenviando a Meta AI
     3. Esperando respuesta de Meta AI
     4. Mensaje reenviado al grupo citando el mensaje original.

---

### 3. Configuración de Variables de Entorno (`.env`)

Copia o edita el archivo `.env`:

```ini
# JID del grupo donde opera el bot (si se deja vacío, responderá en cualquier grupo donde se mencione)
TARGET_GROUP_JID="120363xxxxxx@g.us"

# JID real de Meta AI detectado en la Fase 1
META_AI_JID="13135550002@s.whatsapp.net"

# Modo simulación (true no envía mensajes al grupo, solo los loggea)
DRY_RUN=false

# Proveedor de respaldo si Meta AI no responde o demora
AI_PROVIDER=groq
AI_API_KEY="gsk_xxxxxxxxxxxxxxxxxxxxxx"
AI_MODEL="llama-3.3-70b-versatile"
```

---

### 4. Fase 2: Ejecución del Bot Completo ("Mequetrefe")

Una vez validada la Fase 1 y configurado el `.env`, ejecuta el bot en modo desarrollo:

```bash
npm run dev
```

O compila y ejecuta la versión de producción:
```bash
npm run build
npm start
```

#### Características del Bot Completo:
* **Personalidad "Mequetrefe"**:
  * Cuando le pregunten su nombre (ej. *"¿Cómo te llamás?", "quién sos"*), Meta AI genera cada vez una respuesta ocurrente y divertida con emojis diciendo que se llama **Mequetrefe** (¡nunca una respuesta fija!).
  * Tono desenfadado, 3-5 modismos naturales y límite de 2 a 3 oraciones.
* **Triggers de Activación**:
  * Mención explícita `@bot` o `@<número_bot>`.
  * Responder/citar un mensaje previo del bot.
  * Mencionar la palabra clave `mequetrefe`.
* **Simulación de Presencia Humana**:
  * Marca mensajes como leídos (`readMessages`).
  * Muestra "escribiendo..." (`composing`).
  * Retardo aleatorio configurable entre 1.5 y 3.5 segundos.
* **Seguridad y Estabilidad**:
  * Cooldown por usuario y por grupo para prevenir spam.
  * Deduplicación de IDs de mensaje para evitar respuestas dobles.
  * Ignora siempre mensajes propios (`key.fromMe`).
* **Fallback Transparente**:
  * Si Meta AI en WhatsApp demora más de 45s o falla, conmuta automáticamente a Groq / OpenRouter / Together manteniendo el hilo de la conversación.
