// The clinic's location, from a Google Maps link pasted in Ajustes. Full
// links carry the coordinates; short ones (maps.app.goo.gl) are followed to
// the full link first.

export type Coordinates = { lat: number; lng: number };

const PATTERNS = [
  // The place's own pin, in a place link's data segment.
  /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  // ?q=13.69,-89.21, ?query=…, ?ll=…, ?destination=…
  /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
  // The map's center, /@13.69,-89.21,17z
  /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  // Plain coordinates, "13.6929, -89.2182"
  /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/,
];

export function parseCoordinates(raw: string): Coordinates | null {
  for (const pattern of PATTERNS) {
    const m = pattern.exec(raw);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) return { lat, lng };
  }
  return null;
}

const SHORT_LINK = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i;

export async function resolveMapsLink(raw: string, fetcher: typeof fetch = fetch): Promise<Coordinates | null> {
  const value = raw.trim();
  const direct = parseCoordinates(value);
  if (direct || !SHORT_LINK.test(value)) return direct;
  try {
    const res = await fetcher(value, { redirect: "follow", signal: AbortSignal.timeout(5000) });
    return parseCoordinates(decodeURIComponent(res.url));
  } catch {
    return null;
  }
}

export const mapsLink = ({ lat, lng }: Coordinates) => `https://www.google.com/maps?q=${lat},${lng}`;
