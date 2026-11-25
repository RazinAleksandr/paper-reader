/** Interface languages. English is the default; the server and the browser share this list. */
export type Lang = 'en' | 'ru' | 'zh';

export const LANGS: { id: Lang; title: string }[] = [
  { id: 'en', title: 'English' },
  { id: 'ru', title: 'Русский' },
  { id: 'zh', title: '中文' },
];

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ru' || v === 'zh';

/** Pick the string for a language: tr-style triples keep every translation next to the code that uses it. */
export const pick = (lang: Lang, en: string, ru: string, zh: string) => (lang === 'ru' ? ru : lang === 'zh' ? zh : en);

/** Language Claude answers in when the user left "Answer language" empty. */
export const answerLanguage = (lang: Lang) => pick(lang, 'English', 'Russian', 'Simplified Chinese');

/** Label of a page reference, e.g. "p. 4" / "стр. 4" / "第 4 页". */
export const pageLabel = (lang: Lang, n: number | string) => pick(lang, `p. ${n}`, `стр. ${n}`, `第 ${n} 页`);
