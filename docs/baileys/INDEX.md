# Índice de Referencia de Baileys (`WhiskeySockets/Baileys`)

Este directorio contiene la documentación técnica, tipos de TypeScript, implementación de sockets y ejemplos oficiales extraídos directamente del repositorio oficial de Baileys para consulta rápida durante el desarrollo de **Bot-EVV**.

---

## Estructura General

```
docs/baileys/
├── README.md             # Documentación general oficial, guías de instalación y primeros pasos
├── INDEX.md              # Este archivo (mapeo estructurado de componentes)
├── Example/              # Código de ejemplo de implementación completa
│   └── example.ts        # Ejemplo de conexión, manejo de auth y eventos
├── Types/                # Definiciones de tipos e interfaces de TypeScript
│   ├── Auth.ts           # Credenciales, estados de autenticación y claves Signal
│   ├── Bussines.ts       # Tipos para perfiles de WhatsApp Business
│   ├── Call.ts           # Interfaces para eventos y estados de llamadas
│   ├── Chat.ts           # Modelos de chats, presencia, estado 'composing', etc.
│   ├── Contact.ts        # Información de contactos y vCards
│   ├── Events.ts         # Mapa de eventos de Baileys (connection.update, messages.upsert, etc.)
│   ├── GroupMetadata.ts  # Metadatos de grupos (participantes, permisos, admins)
│   ├── Message.ts        # Estructura de mensajes (WAMessage, proto.IMessage, quoted, etc.)
│   ├── Socket.ts         # Configuración del Socket (SocketConfig, UserFacingSocketConfig)
│   ├── State.ts          # Estados de conexión y desconexión (DisconnectReason)
│   └── ...               # Tipos adicionales (USync, Signal, Mex, Labels)
└── Socket/               # Métodos y funciones del cliente de WhatsApp
    ├── socket.ts         # Conexión WebSocket base con los servidores de WhatsApp
    ├── messages-send.ts  # Métodos de envío: sendMessage, relayMessage, sendPresenceUpdate
    ├── messages-recv.ts  # Recepción, descifrado y procesamiento de mensajes entrantes
    ├── chats.ts          # Gestión de chats, lectura de mensajes (readMessages), presencia
    ├── groups.ts         # Métodos de grupos: groupMetadata, groupParticipantsUpdate
    ├── newsletter.ts     # Soporte para canales / newsletters de WhatsApp
    └── business.ts       # Consultas y catálogos de WhatsApp Business
```

---

## 1. Guía Rápida por Casos de Uso en Bot-EVV

### Autenticación y Conexión
* **Ubicación clave**: `Types/Auth.ts`, `Types/State.ts`, `Socket/socket.ts`
* **Funciones / Tipos principales**:
  * `useMultiFileAuthState(folderPath)`: Guarda y recupera credenciales en archivos JSON locales sin base de datos externa.
  * `DisconnectReason`: Enum con causas de desconexión (`loggedOut`, `connectionLost`, `restartRequired`, `timedOut`). Permite decidir cuándo reconectar automáticamente.
  * Evento `connection.update`: Notifica cambios de estado (`connection: 'open' | 'close' | 'connecting'`) y emite códigos QR (`qr: string`).

### Recepción de Mensajes y Filtros
* **Ubicación clave**: `Types/Events.ts`, `Types/Message.ts`, `Socket/messages-recv.ts`
* **Funciones / Tipos principales**:
  * Evento `messages.upsert`: Emite los mensajes nuevos recibidos (`type: 'notify' | 'append'`).
  * `WAMessage`: Estructura principal del mensaje:
    * `key.remoteJid`: JID de origen (identifica si es grupo `@g.us` o chat directo `@s.whatsapp.net`).
    * `key.fromMe`: Booleano para evitar que el bot se responda a sí mismo.
    * `key.id`: Identificador único del mensaje (usado para deduplicación).
    * `message`: Contenedor del payload (ej. `conversation`, `extendedTextMessage`).
    * `message.extendedTextMessage.contextInfo`: Contiene `mentionedJid` y `quotedMessage`.

### Envío de Mensajes y Citas (`quoted`)
* **Ubicación clave**: `Socket/messages-send.ts`, `Types/Message.ts`
* **Funciones / Métodos**:
  * `sock.sendMessage(jid, content, options)`:
    * `jid`: Destinatario (ej. `TARGET_GROUP_JID` o `META_AI_JID`).
    * `content`: Objeto `{ text: '...' }` u otros tipos multimedia.
    * `options`: `{ quoted: wamsg }` para responder citando el mensaje original.

### Simulación de Presencia Humana
* **Ubicación clave**: `Socket/chats.ts`, `Socket/messages-send.ts`
* **Funciones / Métodos**:
  * `sock.readMessages([msg.key])`: Marca el mensaje como leído (doble tilde azul).
  * `sock.sendPresenceUpdate('composing', jid)`: Simula "escribiendo..." en el chat/grupo antes de responder.
  * `sock.sendPresenceUpdate('paused', jid)`: Detiene la indicación de escritura.

---

## 2. Detalle de Archivos de Socket (`Socket/`)

| Archivo | Responsabilidad Principal |
| :--- | :--- |
| `Socket/socket.ts` | Inicialización de la sesión WebSocket, handshake de Noise protocol y control del ciclo de vida de la conexión. |
| `Socket/messages-send.ts` | Contiene `sendMessage`, `relayMessage`, manipulación de reintentos, cifrado de mensajes salientes y citas. |
| `Socket/messages-recv.ts` | Desempaqueta stanzas entrantes de WhatsApp, descifra el payload Signal y emite los eventos `messages.upsert`. |
| `Socket/chats.ts` | Control de presencia (`composing`, `available`), sincronización de estados y lectura de mensajes (`readMessages`). |
| `Socket/groups.ts` | Consultas sobre grupos (`groupMetadata`), extracción de participantes, títulos, administradores y enlaces de invitación. |

---

## 3. Detalle de Tipos e Interfaces (`Types/`)

| Archivo | Interfaces Relevantes |
| :--- | :--- |
| `Types/Events.ts` | `BaileysEventMap`: Diccionario fuertemente tipado de todos los eventos (`messages.upsert`, `connection.update`, `creds.update`). |
| `Types/Message.ts` | `WAMessage`, `WAMessageContent`, `MessageUserReceipt`, `AnyMessageContent`. |
| `Types/Auth.ts` | `AuthenticationState`, `AuthenticationCreds`, `SignalKeyStore`. |
| `Types/Chat.ts` | `Chat`, `PresenceData`, `WAPresence`. |
| `Types/GroupMetadata.ts` | `GroupMetadata`, `GroupParticipant`. |
| `Types/Socket.ts` | `UserFacingSocketConfig`, parámetros de conexión (timeout, logger, browser info). |

---

## 4. Ejemplo Oficial de Referencia (`Example/example.ts`)

Contiene la implementación canónica de:
1. Configuración del logger (`pino`).
2. Configuración de credenciales con `useMultiFileAuthState`.
3. Conexión WebSocket mediante `makeWASocket`.
4. Manejo del ciclo de eventos `sock.ev.process` y reconexión automática en caso de desconexión recuperable.
