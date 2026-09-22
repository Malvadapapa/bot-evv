# Bot-EVV: Mequetrefe 🤖🇦🇷

Bot inteligente de WhatsApp para grupos desarrollado sobre **Node.js**, **TypeScript** y **Baileys**. Integra inteligencia artificial dual mediante **Meta AI** (a través de un puente Go/whatsmeow) y fallback de alta velocidad con **Groq / LLMs externos**, con una personalidad cálida, pícara y 100% cordobesa (**Mequetrefe**).

Incluye un sistema integral de **18 Guardrails empresariales**, horóscopo diario, noticias automatizadas, resúmenes con checkpoints, efemérides de cumpleaños, apodos dinámicos con entromisión pasiva, chamuyo sutil y despliegue continuo 24/7 en **Windows Server VPS** con **PM2** y **GitHub Actions**.

---

## 🌟 Características Principales

### 🧠 Inteligencia Artificial Dual y Alta Disponibilidad
- **Meta AI Nativo:** Reenvío transparente al bot oficial de WhatsApp (`867051314767696@bot`) a través del sidecar en Go (`meta-ai-bridge/wametaai.exe` sobre el puerto 8788).
- **Fallback Concurrente Ultra Rápido:** Si Meta AI está ocupado o excede la latencia esperada, conmuta en ~400ms a modelos de vanguardia (Groq / Qwen / LLaMA) manteniendo la memoria y el tono cordobés.

### 🎭 Personalidad "Mequetrefe" & Chamuyo Cordobés
- Respuestas naturales, pícaras, con modismos cordobeses bien aplicados (*"culiau", "de diez", "fiera", "reina"*).
- **Trato diferenciado por género:** Regla de respeto de pronombres registrados por el usuario.
- **Chamuyo sutil para chicas:** Halagos cordobeses con estilo y sin ser cargoso.
- **Cooldown de 3 horas:** Tras un halago o piropo espontáneo, respeta una ventana de 3 horas antes de volver a halagar a la misma persona.
- **Banco de 50 Afirmaciones del Horóscopo:** Predicciones cariñosas y motivadoras exclusivas para chicas al consultar el horóscopo.

### 🏷️ Apodos Dinámicos y Entromisión Pasiva
- Los administradores pueden asociar palabras clave o apodos a números de teléfono (`/apodo 351xxxx batichica morocha reina`).
- El bot escucha pasivamente las conversaciones del grupo; si alguien menciona el apodo, hay una probabilidad de **~45%** de que Mequetrefe intervenga de forma espontánea etiquetándola con buena onda.

### 🛡️ 18 Guardrails y Reglas de Comportamiento
1. **Rate Limiting de Comandos:** Máximo 1 comando/segundo y 30 comandos/hora por usuario (Admins exentos). Registro en `command_audit_log`.
2. **Batería Social:** Máximo 15 preguntas directas/hora por usuario con degradación progresiva de paciencia y silencio absoluto en 16+.
3. **Protección de Mensajes Privados (DMs):** Silencio total a usuarios comunes en privado. Solo los administradores pueden enviar comandos por DM.
4. **Autorización de Ingreso a Grupos con Timeout:** Ignora 100% grupos no aprobados. Envía alerta con ID `SOL-xxx` a los administradores. Si no se aprueba en 12 horas, abandona el grupo automáticamente.
5. **Filtro @broadcast:** Descarte total a nivel cero de estados de WhatsApp.
6. **Persistencia Desacoplada:** La identidad y datos del bot (`bot_instance_id = 'bot-principal'`) no dependen del número telefónico.
7. **Copias de Seguridad:** Exportación completa de todas las tablas SQLite a JSON con `/backup`.

---

## 📋 Lista de Comandos

### 👥 Comandos Generales (Para todos los usuarios)
| Comando | Descripción |
|---|---|
| `/ayuda` o `/help` | Muestra la guía interactiva de comandos disponibles. |
| `/version` o `/v` | Muestra el estado del sistema, versión activa y entorno de ejecución. |
| `/resumen` | Genera un resumen inteligente de lo conversado en el día con checkpoints. |
| `/menciones [pág]` | Lista de forma privada tus menciones recientes en el grupo. |
| `/marcar` | Reconstruye el contexto de conversación de tu última mención. |
| `/registrarse DD/MM [el/ella]` | Registra tu fecha de cumpleaños y pronombre en el sistema. |
| `/h [signo]` | Horóscopo diario resumido (hasta 3 párrafos). |
| `/h largo [signo]` | Horóscopo completo con predicción extendida. |
| `/top` | Ranking de los 10 participantes más activos del grupo. |
| `/noticias [n]` | Despacha 1 o más noticias tecnológicas del día (fuentes RSS limpias). |
| `@Mequetrefe <pregunta>` | Conversación libre con la inteligencia artificial en el grupo. |

### 👑 Comandos de Administrador (Grupo o DM Privado)
| Comando | Descripción |
|---|---|
| `/admin <teléfono>` | Registra a un nuevo usuario como administrador del bot. |
| `/admin quitar <teléfono>` | Revoca los privilegios de administrador. |
| `/admin listar` | Lista todos los administradores registrados. |
| `/apodo <tel> <apodo1> [apodo2]...` | Asocia apodos y palabras de activación a un número. |
| `/apodo quitar <tel> <apodo>` | Elimina un apodo específico. |
| `/apodo listar` | Muestra el listado de apodos registrados en la base de datos. |
| `/aprobar <id_solicitud>` | Aprueba el ingreso del bot a un nuevo grupo e inicia el onboarding. |
| `/rechazar <id_solicitud>` | Rechaza la solicitud y hace que el bot abandone el grupo. |
| `/actualizar` | Descarga cambios de Git (`origin main`), compila y reinicia con PM2. |
| `/backup` | Genera un volcado JSON con todas las tablas de SQLite en `data/backups/`. |
| `/config [clave] [valor]` | Consulta o modifica parámetros operativos en caliente. |

---

## 🏗️ Estructura del Proyecto

```text
bot-EVV/
├── .github/
│   └── workflows/
│       └── deploy.yml           # CI/CD automatizado para Windows Server VPS
├── meta-ai-bridge/              # Microservicio Go/whatsmeow para Meta AI (puerto 8788)
│   ├── main.go
│   ├── go.mod
│   └── wametaai.exe             # Binario ejecutable compilado para Windows
├── src/
│   ├── ai/                      # Proveedores de IA (Meta AI, Groq, orquestador)
│   ├── bot/                     # Manejador de eventos de WhatsApp y enrutamiento
│   ├── config/                  # Personalidad Mequetrefe, modismos y Zod Env
│   ├── database/                # SQLite3 con repositorios y migraciones
│   │   ├── repositories/        # Mensajes, cumpleaños, estadísticas, guardrails, etc.
│   │   └── schema.ts            # Esquema relacional con índices
│   ├── services/                # Lógica de negocio (Horóscopo, Noticias, Guardrails, etc.)
│   └── index.ts                 # Punto de entrada principal y conexión Baileys
├── tests/
│   └── unit/                    # Suite completa de tests unitarios (94+ tests)
├── CHANGELOG.md                 # Registro histórico de versiones y cambios
├── ecosystem.config.cjs         # Configuración de procesos para PM2
├── tsconfig.json                # Configuración de TypeScript (ES2022 / NodeNext)
└── package.json                 # Dependencias y scripts
```

---

## 🚀 Despliegue en Producción (Windows Server VPS)

El bot está diseñado para correr **24/7 de forma autónoma** en un VPS con Windows Server utilizando **PM2** y **GitHub Actions Self-Hosted Runner**.

### 1. Iniciar los servicios con PM2
```powershell
# En la carpeta del proyecto en el VPS (ej. C:\bot-evv):
npm install
npm run build
pm2 start ecosystem.config.cjs

# Configurar autoarranque con el sistema operativo:
pm2-startup install
pm2 save
```

### 2. Monitoreo en tiempo real
```powershell
# Ver estado de los procesos:
pm2 status

# Ver logs en vivo:
pm2 logs bot-evv
pm2 logs meta-ai-bridge
```

### 3. CI/CD: Flujo de Trabajo (Git Flow)
1. Los desarrollos y pruebas se realizan en la rama **`develop`**.
2. Al validar los cambios, se mergea a **`main`** y se hace `git push origin main`.
3. El **Runner de GitHub en el VPS** detecta el push, ejecuta automáticamente `git pull`, `npm install`, `npm run build` y reinicia el bot con `pm2 restart bot-evv`.

---

## 🧪 Pruebas Unitarias

El proyecto cuenta con cobertura de pruebas automatizadas sobre Node.js native test runner y `tsx`:

```bash
# Ejecutar todas las pruebas unitarias:
npm test

# Ejecutar una suite específica:
npx tsx --test tests/unit/flirting-aliases.test.ts
npx tsx --test tests/unit/guardrails.test.ts
```

---

## 📄 Licencia

Desarrollado para uso privado y administración comunitaria. Todos los derechos reservados.
