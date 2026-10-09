import catalogue from "./catalogue.json";

// CIE-10 (ICD-10 in Spanish), 2013 edition from the MIT-licensed `cie10` npm
// package, plus the COVID-19 codes (U07.1, U07.2). Kept in memory: about
// 14,000 codes, searched on the server only.
const entries = catalogue as [string, string][];
const byCode = new Map(entries);

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const folded = entries.map(([code, description]) => ({ code, description, text: fold(description) }));

export function describeCode(code: string) {
  return byCode.get(code) ?? null;
}

export function isCode(code: string) {
  return byCode.has(code);
}

// A code or its start ("J06", "j069") matches by code; anything else matches
// descriptions containing every word. Shorter codes (categories) come first.
export function searchCodes(query: string, limit = 20) {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const compact = q.replace(/[\s.]/g, "").toUpperCase();
  const results = /^[A-Z]\d/.test(compact)
    ? folded.filter((e) => e.code.replace(".", "").startsWith(compact))
    : (() => {
        const words = q.split(/\s+/).filter(Boolean);
        return folded.filter((e) => words.every((w) => e.text.includes(w)));
      })();
  return results
    .sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map(({ code, description }) => ({ code, description }));
}
