import { formatInTimeZone } from "date-fns-tz";

export const DISPLAY_DATE = "dd-MM-yyyy";
export const DISPLAY_TIME = "h:mm a";
export const DISPLAY_DATE_TIME = "dd-MM-yyyy, h:mm a";

export function displayTime(value: string | null): string {
  if (!value) return "";
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

export function parseDisplayTime(value: string): string | null {
  const match = /^(1[0-2]|[1-9]):([0-5]\d)\s*(AM|PM)$/i.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

/** Calendar dates stay ISO in storage and URLs; display never shifts timezones. */
export function isoDate(value: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function displayDate(value: string): string {
  const iso = isoDate(value);
  return iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : value;
}

export function displayDateTime(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, DISPLAY_DATE_TIME);
}

/** Normalize full calendar dates in newly generated replies, preserving URLs. */
export function normalizeChatDates(text: string): string {
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return text.split(/(https?:\/\/\S+)/g).map(part => {
    if (/^https?:\/\//.test(part)) return part;
    return part.replace(/\b(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2})?)?\b/g, (original, date: string, time?: string) =>
      isoDate(date) ? `${displayDate(date)}${time ? `, ${time}` : ""}` : original
    ).replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, (original, day: string, month: string, year: string) => {
      const date = `${day}-${month}-${year}`;
      return isoDate(date) ? date : original;
    }).replace(/\b(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})\b/gi, (original, day: string, month: string, year: string) => {
      const date = `${day.padStart(2, "0")}-${String(months.indexOf(month.toLowerCase()) + 1).padStart(2, "0")}-${year}`;
      return isoDate(date) ? date : original;
    });
  }).join("");
}

export function normalizeChatTimes(text: string): string {
  return text.split(/(https?:\/\/\S+)/g).map(part => {
    if (/^https?:\/\//.test(part)) return part;
    return part.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?:\s*(AM|PM|a\.\s*m\.|p\.\s*m\.))?/gi, (original, hour: string, minute: string, meridian?: string) => {
      if (meridian) {
        const iso = parseDisplayTime(`${Number(hour)}:${minute} ${meridian.replace(/[^apm]/gi, "")}`);
        return iso ? displayTime(iso) : original;
      }
      return displayTime(`${hour.padStart(2, "0")}:${minute}`);
    });
  }).join("");
}
