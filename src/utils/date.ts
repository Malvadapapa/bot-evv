const CORDOBA_TZ = 'America/Argentina/Cordoba';

/**
 * Obtiene la fecha actual formateada como YYYY-MM-DD en la zona horaria de Córdoba
 */
export function getTodayCordoba(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CORDOBA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
  return parts; // en-CA produce YYYY-MM-DD
}

/**
 * Obtiene el día y mes actual (1-31, 1-12) en la zona horaria de Córdoba
 */
export function getCordobaDayAndMonth(date: Date = new Date()): { day: number; month: number } {
  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: CORDOBA_TZ,
    day: 'numeric',
    month: 'numeric'
  });
  const parts = formatter.formatToParts(date);
  const day = Number(parts.find((p) => p.type === 'day')?.value || 1);
  const month = Number(parts.find((p) => p.type === 'month')?.value || 1);
  return { day, month };
}

/**
 * Obtiene el día y mes que será mañana en la zona horaria de Córdoba
 */
export function getTomorrowCordobaDayAndMonth(date: Date = new Date()): { day: number; month: number } {
  const tomorrow = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  return getCordobaDayAndMonth(tomorrow);
}

/**
 * Formatea una hora en formato HH:mm o DD/MM HH:mm en Córdoba
 */
export function formatTimeCordoba(timestampMs: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: CORDOBA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestampMs));
}

/**
 * Formatea una fecha y hora completa en Córdoba
 */
export function formatDateTimeCordoba(timestampMs: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: CORDOBA_TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestampMs));
}
