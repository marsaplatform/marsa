/** Every user-facing string in both languages. Tools pick one with the `lang` input. */
export type Lang = "ar" | "en";

export const messages = {
  en: {
    notFound: (id: string) => `No item with id "${id}". Use search_items to find ids.`,
    upstream: "The data source did not answer in time. Retry in a moment.",
    badInput: "The input is not valid.",
    noResults: "No results. Try fewer or different words (Arabic or English).",
  },
  ar: {
    notFound: (id: string) => `لا يوجد عنصر بالمعرّف "${id}". استعمل search_items لإيجاد المعرّفات.`,
    upstream: "مصدر البيانات لم يرد في الوقت المحدد. أعد المحاولة بعد قليل.",
    badInput: "المدخلات غير صالحة.",
    noResults: "لا نتائج. جرّب كلمات أقل أو مختلفة (بالعربية أو الإنجليزية).",
  },
} satisfies Record<Lang, Record<string, unknown>>;

export const t = (lang: Lang | undefined) => messages[lang ?? "ar"];
