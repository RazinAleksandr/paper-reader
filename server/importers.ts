import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { marked } from 'marked';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { extractPdf } from './pdftext.ts';
import { listPapers, newId, paperDir, savePaper, slugify } from './library.ts';
import type { PaperMeta } from '../shared/types.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

export class ImportError extends Error {}

function isPdf(buf: Uint8Array): boolean {
  return Buffer.from(buf.subarray(0, 1024)).includes('%PDF');
}

function makeId(title: string): string {
  return `${slugify(title)}-${newId().slice(0, 4).toLowerCase()}`;
}

const sha1 = (buf: Uint8Array) => crypto.createHash('sha1').update(buf).digest('hex');

/** Same file or same link imported again: open the paper already in the library. */
function existing(test: (p: PaperMeta) => boolean): PaperMeta | null {
  return listPapers().find(test) || null;
}

interface KnownMeta {
  title?: string;
  authors?: string;
}

function formatAuthors(names: string[]): string | undefined {
  const clean = names.map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!clean.length) return undefined;
  return clean.length > 4 ? `${clean.slice(0, 3).join(', ')} и др.` : clean.join(', ');
}

/** Title and authors from the arXiv API: PDF text extraction mangles small caps and ligatures. */
async function arxivMeta(id: string): Promise<KnownMeta> {
  try {
    const res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(8000) });
    const xml = await res.text();
    const entry = xml.split('<entry>')[1] || '';
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim();
    const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => m[1]);
    return { title: title || undefined, authors: formatAuthors(authors) };
  } catch {
    return {};
  }
}

async function importPdf(buf: Uint8Array, source: PaperMeta['source'], fallbackTitle: string, known: KnownMeta = {}): Promise<PaperMeta> {
  const hash = sha1(buf);
  const dup = existing((p) => p.sha1 === hash);
  if (dup) return dup;
  let info;
  try {
    info = await extractPdf(new Uint8Array(buf));
  } catch (e) {
    throw new ImportError(`Не получилось прочитать PDF: ${(e as Error).message}`);
  }
  const title = known.title || info.title || fallbackTitle;
  const meta: PaperMeta = {
    id: makeId(title),
    title,
    authors: known.authors || info.authors,
    kind: 'pdf',
    source,
    pages: info.pages,
    sha1: hash,
    createdAt: new Date().toISOString(),
  };
  const dir = paperDir(meta.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'paper.pdf'), buf);
  fs.writeFileSync(path.join(dir, 'outline.json'), JSON.stringify(info.outline));
  fs.writeFileSync(path.join(dir, 'paper.md'), known.title ? info.markdown.replace(/^# .*$/m, `# ${known.title}`) : info.markdown);
  savePaper(meta);
  return meta;
}

/** Block-aware HTML → plain markdown-ish text, good enough for Claude to read. */
function htmlToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const out: string[] = [];
  const walk = (node: any) => {
    for (const el of Array.from(node.childNodes) as any[]) {
      if (el.nodeType !== 1) continue;
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) out.push('#'.repeat(Number(tag[1]) + 1) + ' ' + el.textContent.trim());
      else if (['p', 'li', 'pre', 'blockquote', 'figcaption', 'td', 'th', 'dt', 'dd'].includes(tag))
        out.push((tag === 'li' ? '- ' : '') + el.textContent.replace(/\s+/g, tag === 'pre' ? '$&' : ' ').trim());
      else if (tag === 'img' && el.getAttribute('alt')) out.push(`[изображение: ${el.getAttribute('alt')}]`);
      else walk(el);
    }
  };
  walk(document.body);
  return out.filter(Boolean).join('\n\n');
}

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'cite', 'data']);
const DROP_TAGS = 'script,style,iframe,frame,frameset,object,embed,applet,form,input,button,textarea,select,noscript,link,meta,base,template,portal';

/** Article HTML is shown inside the app, so only inert markup and http(s)/relative links survive. */
export function sanitize(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  document.querySelectorAll(DROP_TAGS).forEach((n: any) => n.remove());
  document.querySelectorAll('*').forEach((el: any) => {
    for (const attr of Array.from(el.attributes) as any[]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style' || name === 'srcset' || name === 'srcdoc') {
        el.removeAttribute(attr.name);
        continue;
      }
      if (!URL_ATTRS.has(name)) continue;
      // Browsers ignore control characters and spaces inside the scheme ("java\tscript:").
      const value = String(attr.value).replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
      const scheme = value.match(/^([a-z][a-z0-9+.-]*):/)?.[1];
      const okData = name === 'src' && el.tagName.toLowerCase() === 'img' && /^data:image\/(png|jpe?g|gif|webp);/.test(value);
      if (scheme && !['http', 'https', 'mailto'].includes(scheme) && !okData) el.removeAttribute(attr.name);
    }
  });
  return document.body.innerHTML;
}

/** Download remote images next to the article so screenshots and offline reading work. */
async function localizeImages(html: string, baseUrl: string | undefined, dir: string): Promise<string> {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const imgs = Array.from(document.querySelectorAll('img')) as any[];
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  let i = 0;
  await Promise.all(
    imgs.slice(0, 80).map(async (img) => {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (!src || src.startsWith('data:')) return;
      try {
        const url = new URL(src, baseUrl).href;
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) return;
        const type = res.headers.get('content-type') || '';
        const ext = type.includes('svg') ? 'svg' : type.includes('png') ? 'png' : type.includes('gif') ? 'gif' : type.includes('webp') ? 'webp' : 'jpg';
        const name = `img-${++i}.${ext}`;
        fs.writeFileSync(path.join(dir, 'assets', name), Buffer.from(await res.arrayBuffer()));
        img.setAttribute('src', `assets/${name}`);
      } catch {
        img.remove();
      }
    }),
  );
  return document.body.innerHTML;
}

async function importHtml(
  html: string,
  source: PaperMeta['source'],
  fallbackTitle: string,
  opts: { baseUrl?: string; readability?: boolean; title?: string } = {},
): Promise<PaperMeta> {
  let title = opts.title || fallbackTitle;
  let body = html;
  let authors: string | undefined;
  if (opts.readability) {
    const { document } = parseHTML(html);
    const article = new Readability(document as any, { keepClasses: false }).parse();
    if (!article?.content) throw new ImportError('На странице не нашлось текста статьи');
    title = article.title?.trim() || title;
    authors = article.byline?.trim() || undefined;
    body = article.content;
  }
  const meta: PaperMeta = {
    id: makeId(title),
    title,
    authors,
    kind: 'html',
    source,
    createdAt: new Date().toISOString(),
  };
  const dir = paperDir(meta.id);
  fs.mkdirSync(dir, { recursive: true });
  body = await localizeImages(sanitize(body), opts.baseUrl, dir);
  if (!/<h1[\s>]/i.test(body)) {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    body = `<h1>${esc(title)}</h1>${authors ? `<p class="byline">${esc(authors)}</p>` : ''}\n${body}`;
  }
  fs.writeFileSync(path.join(dir, 'article.html'), body);
  fs.writeFileSync(path.join(dir, 'paper.md'), `# ${title}\n\n${htmlToText(body)}\n`);
  savePaper(meta);
  return meta;
}

function baseName(name: string) {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim() || 'Документ';
}

export async function importFile(
  buf: Buffer,
  filename: string,
  source: PaperMeta['source'] = { type: 'file', name: filename },
): Promise<PaperMeta> {
  const ext = path.extname(filename).toLowerCase();
  const title = baseName(filename);
  if (ext === '.pdf' || isPdf(buf)) {
    // Files named like arXiv downloads ("2106.09685v2.pdf") get proper metadata too.
    const arxivId = path.basename(filename, ext).match(/^(\d{4}\.\d{4,5})(v\d+)?$/)?.[1];
    return importPdf(buf, source, title, arxivId ? await arxivMeta(arxivId) : {});
  }
  if (ext === '.docx') {
    const { value } = await mammoth.convertToHtml({ buffer: buf });
    return importHtml(value, source, title);
  }
  if (ext === '.md' || ext === '.markdown') {
    const text = buf.toString('utf8');
    const h1 = text.match(/^#\s+(.+)$/m)?.[1];
    return importHtml(await marked.parse(text), source, title, { title: h1 });
  }
  if (ext === '.html' || ext === '.htm') return importHtml(decodeText(buf, ''), source, title, { readability: true });
  if (ext === '.txt' || ext === '') {
    const text = decodeText(buf, '');
    const html = text
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`)
      .join('\n');
    return importHtml(html, source, title);
  }
  throw new ImportError(`Формат ${ext} пока не поддерживается. Подойдут PDF, DOCX, HTML, Markdown, TXT.`);
}

/** Turn landing-page links of popular paper hosts into direct PDF links. */
export function normalizePaperUrl(raw: string): string {
  const url = new URL(raw.trim());
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'arxiv.org' || host === 'export.arxiv.org' || host.endsWith('alphaxiv.org')) {
    const m = url.pathname.match(/^\/(?:abs|pdf|html|overview)\/(.+?)(?:\.pdf)?\/?$/);
    if (m) return `https://arxiv.org/pdf/${m[1]}`;
  }
  if (host === 'openreview.net' && url.pathname.startsWith('/forum')) return `https://openreview.net/pdf?id=${url.searchParams.get('id')}`;
  if (host === 'aclanthology.org' && !url.pathname.endsWith('.pdf')) return `https://aclanthology.org${url.pathname.replace(/\/$/, '')}.pdf`;
  if (host === 'biorxiv.org' || host === 'medrxiv.org') {
    if (/\/content\/[^?]+v\d+$/.test(url.pathname)) return `${url.origin}${url.pathname}.full.pdf`;
  }
  return url.href;
}

const MAX_DOWNLOAD = 150 * 1024 * 1024;

/** Decode text with the charset from the header or a <meta> tag; old Russian sites still use windows-1251. */
function decodeText(buf: Buffer, contentType: string): string {
  const head = buf.subarray(0, 4096).toString('latin1');
  const charset = (
    contentType.match(/charset=["']?([\w-]+)/i)?.[1] ||
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ||
    'utf-8'
  ).toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_DOWNLOAD) throw new ImportError('Файл больше 150 МБ — слишком большой');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > MAX_DOWNLOAD) throw new ImportError('Файл больше 150 МБ — слишком большой');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchUrl(url: string) {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/pdf,text/html;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new ImportError(`Не удалось скачать ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ImportError(`Сервер ответил ${res.status} для ${url}`);
  const buf = await readCapped(res);
  return { buf, type: res.headers.get('content-type') || '', finalUrl: res.url || url };
}

export async function importUrl(raw: string): Promise<PaperMeta> {
  let url: string;
  try {
    url = normalizePaperUrl(raw);
  } catch {
    throw new ImportError('Это не похоже на ссылку');
  }
  const source: PaperMeta['source'] = { type: 'url', url: raw.trim() };
  const dup = existing((p) => {
    if (p.source.type !== 'url' || !p.source.url) return false;
    try {
      return normalizePaperUrl(p.source.url).replace(/v\d+$/, '') === url.replace(/v\d+$/, '');
    } catch {
      return false;
    }
  });
  if (dup) return dup;
  const arxivId = url.match(/^https:\/\/arxiv\.org\/pdf\/(.+)$/)?.[1];
  const [{ buf, type, finalUrl }, known] = await Promise.all([fetchUrl(url), arxivId ? arxivMeta(arxivId) : Promise.resolve({})]);
  const lastSegment = new URL(finalUrl).pathname.split('/').filter(Boolean).pop() || new URL(finalUrl).hostname;
  let fallback = lastSegment;
  try {
    fallback = decodeURIComponent(lastSegment);
  } catch {
    // keep the raw segment, e.g. "50%off.pdf"
  }

  if (type.includes('pdf') || isPdf(buf)) return importPdf(buf, source, baseName(fallback), known);

  const html = decodeText(buf, type);
  // Journal and preprint pages advertise their PDF for Google Scholar; prefer it.
  const { document } = parseHTML(html);
  const pdfMeta = document.querySelector('meta[name="citation_pdf_url"]')?.getAttribute('content');
  if (pdfMeta) {
    try {
      const pdf = await fetchUrl(new URL(pdfMeta, finalUrl).href);
      const cited: KnownMeta = {
        title: document.querySelector('meta[name="citation_title"]')?.getAttribute('content')?.trim() || undefined,
        authors: formatAuthors(Array.from(document.querySelectorAll('meta[name="citation_author"]')).map((m: any) => m.getAttribute('content') || '')),
      };
      if (isPdf(pdf.buf)) return importPdf(pdf.buf, source, cited.title || baseName(fallback), cited);
    } catch {
      // fall back to the HTML article
    }
  }
  if (type.includes('markdown') || /\.md$/i.test(finalUrl)) return importHtml(await marked.parse(html), source, baseName(fallback), { baseUrl: finalUrl });
  if (type.includes('text/plain')) return importFile(buf, `${fallback}.txt`, source);
  return importHtml(html, source, baseName(fallback), { baseUrl: finalUrl, readability: true });
}
