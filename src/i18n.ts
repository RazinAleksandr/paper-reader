import { isLang, pageLabel, pick, type Lang } from '../shared/i18n.ts';
import { api } from './api.ts';

export { LANGS, type Lang } from '../shared/i18n.ts';

const KEY = 'pr-lang';

function detect(): Lang {
  const l = (navigator.language || 'en').toLowerCase();
  return l.startsWith('ru') ? 'ru' : l.startsWith('zh') ? 'zh' : 'en';
}

function cached(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

let lang: Lang = cached() || detect();
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;

export const currentLang = () => lang;

/** Translate: t('Ask', 'Спросить', '提问'). Call it during render or inside functions, never at module level. */
export const t = (en: string, ru: string, zh: string) => pick(lang, en, ru, zh);

/** "p. 4" / "стр. 4" / "第 4 页" */
export const pageRef = (n: number | string) => pageLabel(lang, n);

function apply(next: Lang) {
  lang = next;
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode */
  }
}

/**
 * Called once before the first render. The server config is the source of truth, because the server
 * also writes messages (Claude's status lines, exports). A fresh install takes the browser's language.
 */
export async function initLang() {
  try {
    const cfg = await api.config();
    if (isLang(cfg.uiLang)) apply(cfg.uiLang);
    else await api.saveConfig({ ...cfg, uiLang: lang });
  } catch {
    /* server not reachable: keep the cached or detected language */
  }
}

/** Switch the interface language. Reloads the page so every component re-renders in the new language. */
export async function setLang(next: Lang) {
  if (next === lang) return;
  const cfg = await api.config();
  await api.saveConfig({ ...cfg, uiLang: next });
  apply(next);
  location.reload();
}
