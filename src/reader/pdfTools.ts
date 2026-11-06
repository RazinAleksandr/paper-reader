import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { NRect } from '../../shared/types.ts';

export interface PdfLink {
  rect: NRect;
  url?: string;
  dest?: unknown;
}

export interface DestPoint {
  page: number;
  /** normalized top of the destination, when the PDF says where */
  y?: number;
  x?: number;
}

type Viewport = ReturnType<PDFPageProxy['getViewport']>;

function toViewportRect(vp: Viewport, r: number[]): [number, number, number, number] {
  const [x1, y1] = vp.convertToViewportPoint(r[0], r[1]);
  const [x2, y2] = vp.convertToViewportPoint(r[2], r[3]);
  return [x1, y1, x2, y2];
}

/** Link annotations of a page, in normalized page coordinates. */
export async function getLinks(page: PDFPageProxy): Promise<PdfLink[]> {
  const vp = page.getViewport({ scale: 1 });
  const annots = await page.getAnnotations({ intent: 'display' }).catch(() => []);
  const out: PdfLink[] = [];
  for (const a of annots as any[]) {
    if (a.subtype !== 'Link' || !a.rect) continue;
    const url = a.url || a.unsafeUrl;
    if (!url && !a.dest) continue;
    const [x1, y1, x2, y2] = toViewportRect(vp, a.rect);
    out.push({
      rect: {
        x: Math.min(x1, x2) / vp.width,
        y: Math.min(y1, y2) / vp.height,
        w: Math.abs(x2 - x1) / vp.width,
        h: Math.abs(y2 - y1) / vp.height,
      },
      url: url || undefined,
      dest: a.dest,
    });
  }
  return out;
}

export async function resolveDest(doc: PDFDocumentProxy, dest: unknown): Promise<DestPoint | null> {
  try {
    const explicit = (typeof dest === 'string' ? await doc.getDestination(dest) : dest) as any[] | null;
    if (!explicit?.[0]) return null;
    const ref = explicit[0];
    const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref);
    const page = await doc.getPage(index + 1);
    const vp = page.getViewport({ scale: 1 });
    const kind = explicit[1]?.name;
    let x: number | undefined;
    let y: number | undefined;
    if (kind === 'XYZ' && explicit[3] != null) [x, y] = vp.convertToViewportPoint(explicit[2] ?? 0, explicit[3]);
    else if ((kind === 'FitH' || kind === 'FitBH') && explicit[2] != null) [, y] = vp.convertToViewportPoint(0, explicit[2]);
    else if (kind === 'FitR') [x, y] = vp.convertToViewportPoint(explicit[2], explicit[5]);
    return {
      page: index + 1,
      x: x === undefined ? undefined : Math.max(0, x / vp.width),
      y: y === undefined ? undefined : Math.min(1, Math.max(0, y / vp.height)),
    };
  } catch {
    return null;
  }
}

/** Render a page region crisply; used for screenshots and link previews. */
export async function renderRegion(doc: PDFDocumentProxy, pageNum: number, rect: NRect, targetPx = 1600): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNum);
  const vp1 = page.getViewport({ scale: 1 });
  const regionW = rect.w * vp1.width;
  const regionH = rect.h * vp1.height;
  const s = Math.min(5, Math.max(1.5, targetPx / Math.max(regionW, regionH)));
  const vp = page.getViewport({ scale: s });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(regionW * s));
  canvas.height = Math.max(1, Math.round(regionH * s));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    viewport: vp,
    transform: [1, 0, 0, 1, -rect.x * vp.width, -rect.y * vp.height],
    background: '#ffffff',
  } as Parameters<PDFPageProxy['render']>[0]).promise;
  return canvas;
}

/** Text runs under a rectangle, joined in reading order. */
export async function textInRect(doc: PDFDocumentProxy, pageNum: number, rect: NRect): Promise<string> {
  const page = await doc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const words: string[] = [];
  for (const it of content.items as any[]) {
    if (!it.str?.trim()) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const nx = x / vp.width;
    const ny = y / vp.height;
    if (nx >= rect.x - 0.01 && nx <= rect.x + rect.w && ny >= rect.y && ny <= rect.y + rect.h + 0.01) words.push(it.str);
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

interface PageText {
  text: string;
  /** char offset where each run starts */
  runs: { start: number; end: number; item: any }[];
  vp: Viewport;
}

export interface FindHit {
  page: number;
  rects: NRect[];
}

/** Full-text search over a PDF, with match rectangles for painting. */
export class PdfFinder {
  private cache = new Map<number, Promise<PageText>>();
  private doc: PDFDocumentProxy;

  constructor(doc: PDFDocumentProxy) {
    this.doc = doc;
  }

  private pageText(n: number): Promise<PageText> {
    let p = this.cache.get(n);
    if (!p) {
      p = (async () => {
        const page = await this.doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        let text = '';
        const runs: PageText['runs'] = [];
        for (const item of content.items as any[]) {
          if (typeof item.str !== 'string') continue;
          const start = text.length;
          text += item.str;
          runs.push({ start, end: text.length, item });
          text += item.hasEOL || !/\s$/.test(item.str) ? ' ' : '';
        }
        return { text: text.toLowerCase(), runs, vp };
      })();
      this.cache.set(n, p);
    }
    return p;
  }

  private rectsFor(pt: PageText, from: number, to: number): NRect[] {
    const rects: NRect[] = [];
    for (const r of pt.runs) {
      if (r.end <= from || r.start >= to) continue;
      const it = r.item;
      const len = Math.max(1, r.end - r.start);
      const a = (Math.max(from, r.start) - r.start) / len;
      const b = (Math.min(to, r.end) - r.start) / len;
      const h = Math.abs(it.transform[3]) || it.height || 10;
      const x0 = it.transform[4] + it.width * a;
      const x1 = it.transform[4] + it.width * b;
      const [vx1, vy1, vx2, vy2] = toViewportRect(pt.vp, [x0, it.transform[5] - h * 0.2, x1, it.transform[5] + h * 0.85]);
      rects.push({
        x: Math.min(vx1, vx2) / pt.vp.width,
        y: Math.min(vy1, vy2) / pt.vp.height,
        w: Math.abs(vx2 - vx1) / pt.vp.width,
        h: Math.abs(vy2 - vy1) / pt.vp.height,
      });
    }
    return rects;
  }

  async find(query: string, signal: { cancelled: boolean }): Promise<FindHit[]> {
    const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!q) return [];
    const hits: FindHit[] = [];
    for (let n = 1; n <= this.doc.numPages; n++) {
      const pt = await this.pageText(n);
      if (signal.cancelled) return [];
      const flat = pt.text.replace(/\s/g, ' ');
      for (let at = flat.indexOf(q); at >= 0 && hits.length < 2000; at = flat.indexOf(q, at + q.length)) {
        hits.push({ page: n, rects: this.rectsFor(pt, at, at + q.length) });
      }
    }
    return hits;
  }
}
