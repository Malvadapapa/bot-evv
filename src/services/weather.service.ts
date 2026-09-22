export interface WeatherReport {
  city: string;
  temperature: number;
  condition: string;
  emoji: string;
}

export class WeatherService {
  private timeoutMs: number = 8000;

  /**
   * Obtiene el reporte del clima actual para Argentina en general
   */
  public async getArgentinaWeatherSummary(): Promise<string> {
    try {
      // Muestreo representativo de Norte, Centro, Litoral y Patagonia
      const url =
        'https://api.open-meteo.com/v1/forecast?latitude=-26.82,-31.42,-34.60,-41.13&longitude=-65.22,-64.18,-58.38,-71.31&current=temperature_2m,weather_code&timezone=America%2FArgentina%2FCordoba';

      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 Bot-EVV/1.0' },
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as any;
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Respuesta inesperada de la API de clima');
      }

      const codes: number[] = data.map((d: any) => d.current?.weather_code ?? 0);
      const hasRain = codes.some((c) => c >= 51 && c <= 99);
      const mostlyClear = codes.filter((c) => c <= 2).length >= 2;

      if (hasRain) {
        return '🌤️ *Clima en Argentina:* Jornada con tiempo variable; algunas lluvias aisladas en sectores del país y condiciones más estables hacia el centro y norte.';
      }

      if (mostlyClear) {
        return '🌤️ *Clima en Argentina:* Buen tiempo en general en gran parte del país, con cielo mayormente despejado, mañanas frescas y ambiente templado por la tarde.';
      }

      return '🌤️ *Clima en Argentina:* Jornada con nubosidad variable y tiempo estable en la mayor parte del territorio nacional.';
    } catch (err: any) {
      console.warn(`⚠️ [WeatherService] No se pudo obtener clima en vivo: ${err?.message || err}. Usando reporte de respaldo.`);
      return '🌤️ *Clima en Argentina:* Buenas condiciones meteorológicas en general en el territorio nacional para arrancar la jornada.';
    }
  }

  /**
   * Mapea códigos WMO meteorológicos a descripción en español y emoji
   */
  public mapWmoCode(code?: number): { text: string; emoji: string } {
    if (code === undefined || code === null) {
      return { text: 'Cielo despejado', emoji: '☀️' };
    }

    switch (code) {
      case 0:
        return { text: 'Cielo despejado', emoji: '☀️' };
      case 1:
        return { text: 'Mayormente despejado', emoji: '🌤️' };
      case 2:
        return { text: 'Parcialmente nublado', emoji: '⛅' };
      case 3:
        return { text: 'Cielo nublado', emoji: '☁️' };
      case 45:
      case 48:
        return { text: 'Presencia de niebla', emoji: '🌫️' };
      case 51:
      case 53:
      case 55:
        return { text: 'Lloviznas aisladas', emoji: '🌦️' };
      case 61:
      case 63:
      case 65:
        return { text: 'Lluvias', emoji: '🌧️' };
      case 71:
      case 73:
      case 75:
        return { text: 'Nevadas', emoji: '❄️' };
      case 80:
      case 81:
      case 82:
        return { text: 'Chaparrones', emoji: '🌧️' };
      case 95:
      case 96:
      case 99:
        return { text: 'Tormentas eléctricas', emoji: '⛈️' };
      default:
        return { text: 'Tiempo estable', emoji: '🌤️' };
    }
  }
}
