import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
).href;

export interface OutlineEntry {
  title: string;
  page: number;
  level: number;
}

export interface PdfInfo {
  title?: string;
  authors?: string;
  pages: number;
  /** headings guessed from font size and numbering, for PDFs without bookmarks */
  outline: OutlineEntry[];
  /** Markdown with a heading per page, for Claude to read and grep */
  markdown: string;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

const STANDARD_FONTS = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';

const BAD_TITLES = /^(untitled|microsoft word|title|document|paper|arxiv|\s*$)/i;

interface Line {
  y: number;
  h: number;
  text: string;
}

/** Rebuild lines from positioned text runs. */
function toLines(items: TextItem[]): Line[] {
  const lines: Line[] = [];
  let cur: (Line & { end: number }) | null = null;
  for (const it of items) {
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 10;
    if (!cur || Math.abs(cur.y - y) > h * 0.6) {
      if (cur) lines.push(cur);
      cur = { y, h, text: it.str, end: x + it.width };
    } else {
      // Small caps and kerning split words into runs: only a real gap is a space.
      const gap = x - cur.end;
      const needsSpace = cur.text && !/\s$/.test(cur.text) && it.str && !/^\s/.test(it.str) && (gap > h * 0.18 || gap < -h);
      cur.text += (needsSpace ? ' ' : '') + it.str;
      cur.end = x + it.width;
    }
    if (it.hasEOL && cur) {
      lines.push(cur);
      cur = null;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Paragraphs from vertical gaps between lines. */
function pageToText(lines: Line[]): string {
  let out = '';
  let prev: { y: number; h: number } | null = null;
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (prev) {
      const gap = Math.abs(prev.y - line.y);
      if (gap > Math.max(prev.h, line.h) * 1.7 || line.y > prev.y + prev.h) out += '\n\n';
      else if (out.endsWith('-') && /^[a-zа-я]/.test(text)) {
        // "exam-\nple" → "example", but "left-to-\nright" keeps its hyphen
        if (!/-\p{L}+-$/u.test(out)) out = out.slice(0, -1);
      }
      else out += ' ';
    }
    out += text;
    prev = line;
  }
  return out.trim();
}

function guessTitle(items: TextItem[]): string | undefined {
  const sized = items.filter((i) => i.str.trim()).map((i) => ({ i, size: Math.abs(i.transform[3]) }));
  if (!sized.length) return undefined;
  const max = Math.max(...sized.map((x) => x.size));
  // Lines that carry the biggest font; small-caps runs on them are smaller, so keep whole lines.
  const ys = sized.filter((x) => x.size >= max * 0.92 && /\p{L}/u.test(x.i.str)).map((x) => x.i.transform[5]);
  if (!ys.length) return undefined;
  const onTitleLines = sized.filter((x) => ys.some((y) => Math.abs(y - x.i.transform[5]) < max * 0.6)).map((x) => x.i);
  const title = toLines(onTitleLines)
    .slice(0, 4)
    .map((l) => l.text.trim())
    .join(' ')
    .replace(/(\p{L})- (\p{L})/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  return title.length > 3 && title.length < 300 ? title : undefined;
}

export async function extractPdf(data: Uint8Array): Promise<PdfInfo> {
  const task = pdfjs.getDocument({ data, standardFontDataUrl: STANDARD_FONTS });
  const doc = await task.promise;
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info || {}) as Record<string, unknown>;
    let title = typeof info.Title === 'string' ? info.Title.trim() : undefined;
    const author = typeof info.Author === 'string' ? info.Author.trim() : undefined;

    const pages: string[] = [];
    const allLines: (Line & { page: number })[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter((i) => 'str' in i) as unknown as TextItem[];
      if (n === 1 && (!title || BAD_TITLES.test(title) || title.length < 6)) title = guessTitle(items);
      const lines = toLines(items);
      pages.push(pageToText(lines));
      for (const l of lines) allLines.push({ ...l, text: l.text.replace(/\s+/g, ' ').trim(), page: n });
      page.cleanup();
    }

    const markdown =
      `# ${title || 'Без названия'}\n\n` +
      pages.map((text, i) => `<!-- page ${i + 1} -->\n## [стр. ${i + 1}]\n\n${text || '_(на странице нет текста — вероятно, рисунок или скан)_'}\n`).join('\n');
    return { title, authors: author || undefined, pages: doc.numPages, markdown, outline: guessOutline(allLines) };
  } finally {
    await task.destroy();
  }
}

const NUMBERED = /^((\d{1,2})(\.\d{1,2}){0,2}\.?|[A-H](\.\d{1,2}){0,2}\.?|[IVX]{1,4}\.)\s+\p{Lu}/u;
const NAMED = /^(abstract|introduction|related work|background|method(s|ology)?|experiments?|results|discussion|conclusions?|references|bibliography|acknowledg(e)?ments?|appendix|аннотация|введение|заключение|литература)\b/i;

/** Section headings: bigger than body text, or numbered/named like a section, and short. */
function guessOutline(lines: (Line & { page: number })[]): OutlineEntry[] {
  const counts = new Map<number, number>();
  for (const l of lines) if (l.text.length > 30) counts.set(Math.round(l.h * 2) / 2, (counts.get(Math.round(l.h * 2) / 2) || 0) + l.text.length);
  const body = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const out: OutlineEntry[] = [];
  for (const l of lines) {
    const t = l.text;
    if (t.length < 3 || t.length > 90 || /[.,;:]$/.test(t) || !/\p{L}{3}/u.test(t)) continue;
    const big = l.h >= body * 1.15;
    const numbered = NUMBERED.test(t) && l.h >= body * 0.97 && !/\d{3,}/.test(t.split(' ')[0]);
    const named = NAMED.test(t) && t.split(' ').length <= 4 && l.h >= body * 0.97;
    if (!(big || numbered || named)) continue;
    if (l.page === 1 && big && !numbered && !named) continue; // the title itself
    if (/^0[.\s]/.test(t)) continue; // "0.3 F1 …" is a number in prose, not a section
    const depth = (t.match(/^(\d+|[A-H])((\.\d+)*)/)?.[2] || '').split('.').length;
    const last = out[out.length - 1];
    if (last && last.title === t) continue;
    out.push({ title: t, page: l.page, level: Math.min(3, depth) });
    if (out.length >= 80) break;
  }
  // Too few or too many hits means the guess is noise.
  return out.length >= 3 && out.length <= 80 ? out : [];
}
