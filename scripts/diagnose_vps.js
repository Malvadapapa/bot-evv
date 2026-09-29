/**
 * Script de Diagnóstico Rápido para VPS (Producción)
 * Ejecución en VPS: node scripts/diagnose_vps.js
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import 'dotenv/config';

const CORDOBA_TZ = process.env.TIMEZONE || 'America/Argentina/Cordoba';

function formatCordobaTime(dateOrMs) {
  const d = typeof dateOrMs === 'number' ? new Date(dateOrMs) : (dateOrMs || new Date());
  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: CORDOBA_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function getTodayCordoba(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: CORDOBA_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

console.log('\n======================================================');
console.log('🔍 INICIANDO DIAGNÓSTICO DE PRODUCCIÓN (VPS)');
console.log('======================================================\n');

const report = {
  timestampUtc: new Date().toISOString(),
  timestampCordoba: formatCordobaTime(new Date()),
  system: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(os.uptime()),
    processUptimeSeconds: Math.floor(process.uptime())
  },
  environment: {
    TARGET_GROUP_JID: process.env.TARGET_GROUP_JID || '(vacío)',
    TIMEZONE: process.env.TIMEZONE || 'America/Argentina/Cordoba (default)',
    AI_PROVIDER: process.env.AI_PROVIDER || '(no definido)',
    AI_MODEL: process.env.AI_MODEL || '(no definido)',
    DRY_RUN: process.env.DRY_RUN || 'false',
    ADMIN_PHONE_SUFFIX: process.env.ADMIN_PHONE_SUFFIX || '(no definido)'
  },
  database: {},
  schedulerSimulation: {},
  pm2LogsExcerpt: []
};

// 1. Información del Sistema
console.log('💻 SISTEMA:');
console.log(`• OS: ${report.system.platform} ${report.system.release} (${report.system.arch})`);
console.log(`• Node: ${report.system.nodeVersion}`);
console.log(`• Hora actual UTC: ${report.timestampUtc}`);
console.log(`• Hora actual Córdoba: ${report.timestampCordoba}`);
console.log(`• Fecha actual Córdoba (YYYY-MM-DD): ${getTodayCordoba()}`);

// 2. Variables de Entorno
console.log('\n⚙️ CONFIGURACIÓN (.env):');
console.log(`• TARGET_GROUP_JID: ${report.environment.TARGET_GROUP_JID}`);
console.log(`• TIMEZONE: ${report.environment.TIMEZONE}`);
console.log(`• AI_PROVIDER: ${report.environment.AI_PROVIDER}`);
console.log(`• AI_MODEL: ${report.environment.AI_MODEL}`);
console.log(`• ADMIN_PHONE_SUFFIX: ${report.environment.ADMIN_PHONE_SUFFIX}`);
console.log(`• DRY_RUN: ${report.environment.DRY_RUN}`);

// 3. Inspección de Base de Datos SQLite
const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || 'data/bot.sqlite');
console.log(`\n📂 BASE DE DATOS: ${dbPath}`);

if (!fs.existsSync(dbPath)) {
  console.error(`❌ La base de datos no existe en: ${dbPath}`);
  report.database.error = 'File not found';
} else {
  const stats = fs.statSync(dbPath);
  report.database.sizeBytes = stats.size;
  report.database.modifiedAt = stats.mtime.toISOString();
  console.log(`• Tamaño: ${(stats.size / 1024).toFixed(1)} KB`);
  console.log(`• Última modificación: ${formatCordobaTime(stats.mtime)}`);

  try {
    const db = new DatabaseSync(dbPath);

    // Grupos autorizados
    const groups = db.prepare(`
      SELECT group_jid, group_name, authorized_at, authorized_by, intro_sent
      FROM authorized_groups
      ORDER BY authorized_at DESC
    `).all();

    report.database.authorizedGroups = groups.map((g) => ({
      ...g,
      authorizedAtCordoba: formatCordobaTime(g.authorized_at),
      introSent: Boolean(g.intro_sent)
    }));

    console.log(`\n👥 GRUPOS AUTORIZADOS (${groups.length}):`);
    if (groups.length === 0) {
      console.log('  (Ningún grupo autorizado en la tabla)');
    } else {
      for (const g of report.database.authorizedGroups) {
        console.log(`  - [${g.group_jid}] "${g.group_name}"`);
        console.log(`    Autorizado por: ${g.authorized_by} el ${g.authorizedAtCordoba} | Intro enviada: ${g.introSent}`);
      }
    }

    // Solicitudes de ingreso a grupos
    const joinReqs = db.prepare(`
      SELECT id, group_jid, group_name, invited_by_phone, status, created_at, expires_at, resolved_by, resolved_at
      FROM group_join_requests
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    report.database.joinRequests = joinReqs.map((r) => ({
      ...r,
      createdAtCordoba: formatCordobaTime(r.created_at),
      expiresAtCordoba: formatCordobaTime(r.expires_at),
      resolvedAtCordoba: r.resolved_at ? formatCordobaTime(r.resolved_at) : null
    }));

    console.log(`\n📝 SOLICITUDES DE GRUPO RECIENTES (${joinReqs.length}):`);
    if (joinReqs.length === 0) {
      console.log('  (No hay solicitudes registradas)');
    } else {
      for (const r of report.database.joinRequests) {
        console.log(`  - [${r.id}] "${r.group_name}" (${r.group_jid})`);
        console.log(`    Estado: ${r.status.toUpperCase()} | Creada: ${r.createdAtCordoba} | Expira: ${r.expiresAtCordoba}`);
        if (r.resolved_by) {
          console.log(`    Resuelta por: ${r.resolved_by} el ${r.resolvedAtCordoba}`);
        }
      }
    }

    // Ejecuciones de Jobs (Especialmente Saludo Matutino y Reset Diario)
    const jobExecs = db.prepare(`
      SELECT job_key, group_jid, executed_at
      FROM job_executions
      ORDER BY executed_at DESC
      LIMIT 25
    `).all();

    report.database.jobExecutions = jobExecs.map((j) => ({
      ...j,
      executedAtCordoba: formatCordobaTime(j.executed_at)
    }));

    console.log(`\n⏰ HISTORIAL DE EJECUCIÓN DE TAREAS PROGRAMADAS (Últimas 25):`);
    if (jobExecs.length === 0) {
      console.log('  (No hay ejecuciones registradas en job_executions)');
    } else {
      for (const j of report.database.jobExecutions) {
        console.log(`  • ${j.executedAtCordoba} → ${j.job_key} (Grupo: ${j.group_jid})`);
      }
    }

    // Verificación específica del saludo matutino para hoy
    const todayCordoba = getTodayCordoba();
    console.log(`\n☀️ VERIFICACIÓN SALUDO MATUTINO DE HOY (${todayCordoba}):`);
    for (const g of report.database.authorizedGroups) {
      const morningKey = `daily_morning_message:${g.group_jid}:${todayCordoba}`;
      const found = jobExecs.find((j) => j.job_key === morningKey);
      if (found) {
        console.log(`  ✅ Grupo "${g.group_name}": EJECUTADO el ${formatCordobaTime(found.executed_at)}`);
      } else {
        console.log(`  ❌ Grupo "${g.group_name}": NO SE HA EJECUTADO HOY (${morningKey})`);
      }
    }

    // Auditoría de comandos recientes (últimos 15)
    try {
      const audit = db.prepare(`
        SELECT command, user_jid, user_name, group_jid, timestamp, result, block_reason
        FROM command_audit_log
        ORDER BY timestamp DESC
        LIMIT 15
      `).all();

      report.database.recentCommands = audit.map((a) => ({
        ...a,
        timestampCordoba: formatCordobaTime(a.timestamp)
      }));

      console.log(`\n📜 COMANDOS AUDITADOS RECIENTES (${audit.length}):`);
      for (const a of report.database.recentCommands) {
        console.log(`  • ${a.timestampCordoba} | ${a.user_name} (${a.user_jid}): "${a.command}" | Resultado: ${a.result}${a.block_reason ? ` (${a.block_reason})` : ''}`);
      }
    } catch {
      console.log('\n📜 command_audit_log: (tabla sin registros o no disponible)');
    }

    // Simulación de resolución de grupos para el Scheduler
    const authorizedJids = groups.map((g) => g.group_jid);
    const targetGroupJids = [...authorizedJids];
    if (process.env.TARGET_GROUP_JID && !targetGroupJids.includes(process.env.TARGET_GROUP_JID)) {
      targetGroupJids.push(process.env.TARGET_GROUP_JID);
    }
    const finalSchedulerGroups = Array.from(new Set(targetGroupJids.filter(Boolean)));

    report.schedulerSimulation = {
      authorizedFromDb: authorizedJids,
      envTargetGroupJid: process.env.TARGET_GROUP_JID || null,
      finalTargetsForScheduler: finalSchedulerGroups
    };

    console.log(`\n🎯 SIMULACIÓN DEL SCHEDULER:`);
    console.log(`• Grupos que el Scheduler reconoce para enviar mensajes matutinos:`);
    for (const jid of finalSchedulerGroups) {
      const match = groups.find((g) => g.group_jid === jid);
      const name = match ? match.group_name : (jid === process.env.TARGET_GROUP_JID ? 'Env TARGET_GROUP_JID' : 'Desconocido');
      console.log(`  👉 ${jid} ("${name}")`);
    }

  } catch (err) {
    console.error(`❌ Error consultando la base de datos:`, err.message);
    report.database.queryError = err.message;
  }
}

// 4. Búsqueda de logs de PM2 en ubicaciones típicas de Windows
console.log('\n📋 BUSCANDO LOGS DE PM2:');
const homeDir = os.homedir();
const possibleLogPaths = [
  path.join(homeDir, '.pm2', 'logs', 'bot-evv-out.log'),
  path.join(homeDir, '.pm2', 'logs', 'bot-evv-error.log'),
  path.join(process.cwd(), 'logs', 'bot-evv-out.log'),
  path.join(process.cwd(), 'logs', 'bot-evv-error.log')
];

let foundLogs = false;
for (const logFile of possibleLogPaths) {
  if (fs.existsSync(logFile)) {
    foundLogs = true;
    const stat = fs.statSync(logFile);
    console.log(`• Encontrado: ${logFile} (${(stat.size / 1024).toFixed(1)} KB)`);

    try {
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const relevant = lines.filter((l) =>
        l.includes('[Scheduler') ||
        l.includes('08:00') ||
        l.includes('matutino') ||
        l.includes('Error') ||
        l.includes('aprobar') ||
        l.includes('SOL-')
      ).slice(-20);

      if (relevant.length > 0) {
        console.log(`  Líneas relevantes en ${path.basename(logFile)}:`);
        for (const line of relevant) {
          console.log(`    ${line.trim()}`);
        }
        report.pm2LogsExcerpt.push({ file: logFile, lines: relevant });
      }
    } catch (e) {
      console.warn(`  No se pudo leer ${logFile}:`, e.message);
    }
  }
}

if (!foundLogs) {
  console.log('• No se encontraron archivos de log de PM2 en las rutas estándar.');
}

// 5. Guardar reporte JSON
const outDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
const reportPath = path.join(outDir, 'vps_diagnostic_report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

console.log('\n======================================================');
console.log(`✅ Diagnóstico finalizado con éxito.`);
console.log(`📄 Reporte JSON guardado en: ${reportPath}`);
console.log('======================================================\n');
console.log('💡 Podés copiar la salida de esta terminal o el contenido de');
console.log(`   ${reportPath} y pegármelo acá para que lo analice.\n`);
