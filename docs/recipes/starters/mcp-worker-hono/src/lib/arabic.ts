/**
 * Arabic-aware normalisation for matching user input: strips diacritics and tatweel,
 * unifies alef/yaa/taa marbuta forms and Arabic-Indic digits, lowercases Latin.
 */
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(DIACRITICS, "")
    .replace(/\u0640/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the query appears in the text (after normalisation). */
export function matches(text: string, query: string): boolean {
  const hay = normalize(text);
  return normalize(query)
    .split(" ")
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
