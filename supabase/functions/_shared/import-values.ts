/** Locale-aware ERP values; numeric Excel cells are already unambiguous. */
export function currencyNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  let s = value.trim().replace(/^(?:ARS|AR\$|\$)\s*/i, "").replace(/\s/g, "");
  if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
  // Argentine thousands with optional decimal comma; also accept US decimal exports.
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  else if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const number = Number(s);
  return Number.isFinite(number) ? number : null;
}

export function coordinateNumber(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function argentinaCoordinates(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -56 && lat <= -21 && lng >= -74 && lng <= -53;
}

export function importDate(value: unknown): string | null {
  if (typeof value === "number") {
    // Serial 60 is Excel's fictitious 1900-02-29; never accept it as a real date.
    if (!Number.isFinite(value) || value < 1 || value >= 2958466 || Math.floor(value) === 60) return null;
    const date = new Date(Date.UTC(1899, 11, 31) + (Math.floor(value) - (value >= 60 ? 1 : 0)) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.exec(text);
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (!iso && !local) return null;
  const [year, month, day] = iso ? [+iso[1], +iso[2], +iso[3]] : [+local![3], +local![2], +local![1]];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function joinStreet(street: string | null, number: string | null): string | null {
  if (!street) return null;
  return number && !street.split(/\s+/).includes(number) ? `${street} ${number}` : street;
}
