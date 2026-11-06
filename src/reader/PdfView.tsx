import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ArrowLeft, BookOpen, CornerDownRight, Loader2, MessageCircle, MessageCircleQuestion } from 'lucide-react';
import { fileUrl } from '../api.ts';
import type { Highlight, NRect } from '../../shared/types.ts';
import {
  HL_COLORS,
  cleanSelectionText,
  normalizeRects,
  type OutlineItem,
  type QuestionMark,
  type ViewerHandle,
  type ViewerProps,
} from './types.ts';
import { AreaSelect, type AreaResult } from './AreaSelect.tsx';
import { PdfFinder, getLinks, renderRegion, resolveDest, textInRect, type DestPoint, type FindHit, type PdfLink } from './pdfTools.ts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PAGE_GAP = 16;
const MAX_FIT = 1.8;
const MAX_CANVAS_PIXELS = 16_000_000;
const NO_HL: PageHighlight[] = [];
const NO_MARKS: QuestionMark[] = [];
const NO_HITS: FindHit[] = [];

interface Size {
  w: number;
  h: number;
}

/** Callbacks shared by all pages through a stable ref, so pages stay memoized. */
interface PageEvents {
  linkClick(link: PdfLink, e: React.MouseEvent): void;
  linkEnter(link: PdfLink, el: HTMLElement): void;
  linkLeave(): void;
  markClick(id: string): void;
}

/** A highlight's rects on one page. */
interface PageHighlight {
  h: Highlight;
  rects: NRect[];
}

export function highlightParts(h: Highlight): { page: number; rects: NRect[] }[] {
  if (h.parts?.length) return h.parts;
  return h.page && h.rects ? [{ page: h.page, rects: h.rects }] : [];
}

interface PageProps {
  doc: PDFDocumentProxy;
  n: number;
  size: Size;
  scale: number;
  renderScale: number;
  near: boolean;
  highlights: PageHighlight[];
  flash: NRect[] | null;
  hits: FindHit[];
  current: FindHit | null;
  marks: QuestionMark[];
  events: React.RefObject<PageEvents>;
}

const pct = (r: NRect) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });

const PdfPage = memo(function PdfPage({ doc, n, size, scale, renderScale, near, highlights, flash, hits, current, marks, events }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const textLayerRef = useRef<pdfjs.TextLayer | null>(null);
  const [rendered, setRendered] = useState(false);
  const [links, setLinks] = useState<PdfLink[]>([]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: ReturnType<PDFPageProxy['render']> | null = null;
    (async () => {
      const page = pageRef.current || (pageRef.current = await doc.getPage(n));
      if (cancelled) return;
      const canvas = canvasRef.current!;
      let dpr = window.devicePixelRatio || 1;
      const base = page.getViewport({ scale: renderScale });
      if (base.width * base.height * dpr * dpr > MAX_CANVAS_PIXELS) dpr = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height));
      const viewport = page.getViewport({ scale: renderScale * dpr });
      // Render offscreen first so the old bitmap stays visible while zooming.
      const off = document.createElement('canvas');
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      task = page.render({ canvas: off, viewport });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext('2d')!.drawImage(off, 0, 0);
      setRendered(true);

      const container = textRef.current!;
      const textViewport = page.getViewport({ scale: renderScale });
      if (!textLayerRef.current) {
        container.replaceChildren();
        const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport: textViewport });
        textLayerRef.current = tl;
        await tl.render().catch(() => {});
        const end = document.createElement('div');
        end.className = 'endOfContent';
        container.append(end);
      } else textLayerRef.current.update({ viewport: textViewport });
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, near, renderScale]);

  // Links load once per page, independently of (re)rendering, so a cancelled render never loses them.
  const linksLoaded = useRef(false);
  useEffect(() => {
    if (!near || linksLoaded.current) return;
    let alive = true;
    doc
      .getPage(n)
      .then(getLinks)
      .then((l) => {
        if (!alive) return;
        linksLoaded.current = true;
        setLinks(l);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [doc, n, near]);

  // Free bitmaps of pages far away from the viewport.
  useEffect(() => {
    if (near) return;
    const t = setTimeout(() => {
      const c = canvasRef.current;
      if (c) {
        c.width = 0;
        c.height = 0;
      }
      setRendered(false);
    }, 4000);
    return () => clearTimeout(t);
  }, [near]);

  return (
    <div
      className="pdf-page"
      data-page={n}
      style={
        {
          width: size.w * scale,
          height: size.h * scale,
          '--total-scale-factor': scale,
          '--scale-round-x': '1px',
          '--scale-round-y': '1px',
        } as React.CSSProperties
      }
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      {!rendered && <div className="page-placeholder">{n}</div>}
      <div className="hl-layer">
        {highlights.map(({ h, rects }) =>
          rects.map((r, i) => <div key={h.id + i} className={`hl ${h.note ? 'has-note' : ''}`} style={{ ...pct(r), background: HL_COLORS[h.color] }} />),
        )}
        {hits.map((hit, i) => hit.rects.map((r, j) => <div key={`s${i}-${j}`} className={`find-hit ${hit === current ? 'cur' : ''}`} style={pct(r)} />))}
        {flash?.map((r, i) => <div key={'f' + i} className="flash" style={pct(r)} />)}
      </div>
      <div ref={textRef} className="textLayer" />
      {links.length > 0 && (
        <div className="link-layer">
          {links.map((l, i) => (
            <a
              key={i}
              className="pdf-link"
              style={pct(l.rect)}
              href={l.url || '#'}
              title={l.url}
              onClick={(e) => events.current?.linkClick(l, e)}
              onMouseEnter={(e) => l.dest && events.current?.linkEnter(l, e.currentTarget)}
              onMouseLeave={() => events.current?.linkLeave()}
            />
          ))}
        </div>
      )}
      {marks.map((m) => (
        <button key={m.id} className="q-mark" style={{ top: `${m.y * 100}%` }} title={m.text} onClick={() => events.current?.markClick(m.id)}>
          <MessageCircle size={13} />
        </button>
      ))}
    </div>
  );
});

async function resolveOutline(doc: PDFDocumentProxy): Promise<OutlineItem[]> {
  const raw = await doc.getOutline().catch(() => null);
  if (!raw) return [];
  const walk = async (items: any[]): Promise<OutlineItem[]> =>
    Promise.all(
      items.map(async (it) => {
        const dest = it.dest ? await resolveDest(doc, it.dest) : null;
        return { title: it.title, page: dest?.page ?? null, children: it.items?.length ? await walk(it.items) : [] };
      }),
    );
  return walk(raw);
}

/** Headings guessed by the server for PDFs without bookmarks, nested by numbering depth. */
async function guessedOutline(paperId: string): Promise<OutlineItem[]> {
  const flat: { title: string; page: number; level: number }[] = await fetch(`/api/papers/${paperId}/outline`)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const root: OutlineItem[] = [];
  const stack: { level: number; item: OutlineItem }[] = [];
  for (const e of flat) {
    const item: OutlineItem = { title: e.title, page: e.page, children: [] };
    while (stack.length && stack[stack.length - 1].level >= e.level) stack.pop();
    (stack.length ? stack[stack.length - 1].item.children : root).push(item);
    stack.push({ level: e.level, item });
  }
  return root;
}

interface Peek {
  anchor: DOMRect;
  /** the link's own destination, to follow it exactly */
  raw: unknown;
  dest: DestPoint;
  rect: NRect;
  image?: string;
  /** a paper link found in the previewed reference */
  cited?: string;
}

/** arXiv id, DOI or URL inside a reference entry. */
function citedLink(text: string): string | undefined {
  const t = text.replace(/\s+/g, ' ');
  const arxiv = t.match(/arxiv[:\s.]*(?:org\/abs\/)?(\d{4}\.\d{4,5})/i)?.[1];
  if (arxiv) return `https://arxiv.org/abs/${arxiv}`;
  const doi = t.match(/\b(10\.\d{4,9}\/[^\s,;]+[^\s,;.)])/)?.[1];
  if (doi) return `https://doi.org/${doi}`;
  return t.match(/https?:\/\/[^\s,;)]+[^\s,;.)]/)?.[0];
}

/** Where to crop a preview of a link target: one column of text, or the area under a figure anchor. */
async function peekRect(doc: PDFDocumentProxy, dest: DestPoint): Promise<NRect> {
  const top = dest.y === undefined ? 0 : Math.max(0, dest.y - 0.012);
  const page = await doc.getPage(dest.page);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  // Two-column layout: a good share of line segments begin just right of the middle.
  // A segment starts a row or follows a wide horizontal gap (the gutter between columns).
  const rows = new Map<number, { x0: number; x1: number }[]>();
  for (const it of content.items as any[]) {
    if (!it.str?.trim()) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const key = Math.round(y / 2);
    rows.set(key, [...(rows.get(key) || []), { x0: x / vp.width, x1: (x + (it.width || 0)) / vp.width }]);
  }
  const starts: number[] = [];
  for (const runs of rows.values()) {
    runs.sort((a, b) => a.x0 - b.x0);
    runs.forEach((r, k) => (k === 0 || r.x0 - runs[k - 1].x1 > 0.03) && starts.push(r.x0));
  }
  const rightStarts = starts.filter((x) => x > 0.48 && x < 0.6).length;
  const twoCol = rightStarts >= 6 && rightStarts / Math.max(1, starts.length) > 0.25;
  if (twoCol && dest.x !== undefined) {
    const left = dest.x < 0.5 ? 0.06 : 0.5;
    return { x: left, y: top, w: 0.44, h: Math.min(0.2, 1 - top) };
  }
  return { x: 0.06, y: top, w: 0.88, h: Math.min(dest.y === undefined ? 0.35 : 0.26, 1 - top) };
}

export const PdfView = forwardRef<ViewerHandle, ViewerProps>(function PdfView(props, ref) {
  const { paperId, highlights, zoom, areaMode, onZoom, onPosition, onCapture, onAreaDone, onHighlightClick, onOutline, onFind } = props;
  const marks = props.marks || NO_MARKS;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState<Set<number>>(new Set([1, 2]));
  const [flash, setFlash] = useState<{ page: number; rects: NRect[] } | null>(null);
  const [back, setBack] = useState<number[]>([]);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [hits, setHits] = useState<FindHit[]>(NO_HITS);
  const [hitIndex, setHitIndex] = useState(0);
  const finder = useRef<PdfFinder | null>(null);
  const findRun = useRef({ cancelled: false });
  const restored = useRef(false);
  const lastReported = useRef('');

  useEffect(() => {
    let destroyed = false;
    const task = pdfjs.getDocument({
      url: fileUrl(paperId, 'paper.pdf'),
      cMapUrl: '/api/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/api/pdfjs/standard_fonts/',
      wasmUrl: '/api/pdfjs/wasm/',
    } as Parameters<typeof pdfjs.getDocument>[0]);
    task.promise
      .then(async (d) => {
        const all = await Promise.all(
          Array.from({ length: d.numPages }, (_, i) =>
            d.getPage(i + 1).then((p) => {
              const vp = p.getViewport({ scale: 1 });
              return { w: vp.width, h: vp.height };
            }),
          ),
        );
        if (destroyed) return;
        finder.current = new PdfFinder(d);
        setSizes(all);
        setDoc(d);
        resolveOutline(d)
          .then(async (o) => (o.length ? o : guessedOutline(paperId)))
          .then((o) => !destroyed && onOutline?.(o));
      })
      .catch((e) => !destroyed && setError(e.message));
    return () => {
      destroyed = true;
      findRun.current.cancelled = true;
      task.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const maxW = useMemo(() => Math.max(1, ...sizes.map((s) => s.w)), [sizes]);
  const fit = width ? Math.min(MAX_FIT, (width - 64) / maxW) : 1;
  const scale = zoom > 0 ? zoom : fit;

  // Re-render bitmaps only once zooming settles; CSS stretches the old ones meanwhile.
  const [renderScale, setRenderScale] = useState(scale);
  useEffect(() => {
    const t = setTimeout(() => setRenderScale(scale), 160);
    return () => clearTimeout(t);
  }, [scale]);

  // Keep the reading position when the scale changes: same page, same spot within it.
  const prevScale = useRef(scale);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const old = prevScale.current;
    prevScale.current = scale;
    if (!el || old === scale || !sizes.length) return;
    const center = el.scrollTop + el.clientHeight / 2;
    let y = PAGE_GAP;
    for (let i = 0; i < sizes.length; i++) {
      const h = sizes[i].h * old;
      if (center < y + h + PAGE_GAP || i === sizes.length - 1) {
        const frac = Math.max(0, Math.min(1, (center - y) / h));
        let ny = PAGE_GAP;
        for (let j = 0; j < i; j++) ny += sizes[j].h * scale + PAGE_GAP;
        el.scrollTop = ny + frac * sizes[i].h * scale - el.clientHeight / 2;
        break;
      }
      y += h + PAGE_GAP;
    }
  }, [scale, sizes]);

  const byPage = useMemo(() => {
    const map = new Map<number, PageHighlight[]>();
    for (const h of highlights) for (const part of highlightParts(h)) map.set(part.page, [...(map.get(part.page) || []), { h, rects: part.rects }]);
    return map;
  }, [highlights]);
  const marksByPage = useMemo(() => {
    const map = new Map<number, QuestionMark[]>();
    for (const m of marks) map.set(m.page, [...(map.get(m.page) || []), m]);
    return map;
  }, [marks]);
  const hitsByPage = useMemo(() => {
    const map = new Map<number, FindHit[]>();
    for (const h of hits) map.set(h.page, [...(map.get(h.page) || []), h]);
    return map;
  }, [hits]);

  const pageTops = useMemo(() => {
    const tops: number[] = [];
    let y = PAGE_GAP;
    for (const s of sizes) {
      tops.push(y);
      y += s.h * scale + PAGE_GAP;
    }
    return tops;
  }, [sizes, scale]);

  const updateVisible = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !sizes.length) return;
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    const margin = el.clientHeight * 1.2;
    const next = new Set<number>();
    let current = 1;
    for (let i = 0; i < sizes.length; i++) {
      const t = pageTops[i];
      const b = t + sizes[i].h * scale;
      if (b >= top - margin && t <= bottom + margin) next.add(i + 1);
      if (t <= top + el.clientHeight * 0.4) current = i + 1;
    }
    setNear((prev) => (prev.size === next.size && [...next].every((n) => prev.has(n)) ? prev : next));
    const max = el.scrollHeight - el.clientHeight;
    const progress = max > 0 ? Math.min(1, top / max) : 1;
    const key = `${current}:${progress.toFixed(3)}`;
    if (key !== lastReported.current) {
      lastReported.current = key;
      onPosition(current, sizes.length, progress);
    }
  }, [sizes, pageTops, scale, onPosition]);

  useEffect(() => {
    updateVisible();
  }, [updateVisible]);

  /** Scroll so that a point of a page sits at ~30% of the viewport height. */
  const scrollTo = useCallback(
    (page: number, y: number | undefined, opts: { flash?: NRect[]; smooth?: boolean } = {}) => {
      const el = scrollRef.current;
      if (!el || !sizes[page - 1]) return;
      const offset = y === undefined ? -8 : y * sizes[page - 1].h * scale - el.clientHeight * 0.3;
      el.scrollTo({ top: pageTops[page - 1] + Math.max(-8, offset), behavior: opts.smooth === false || !restored.current ? 'auto' : 'smooth' });
      if (opts.flash?.length) {
        setFlash({ page, rects: opts.flash });
        setTimeout(() => setFlash(null), 1800);
      }
    },
    [sizes, pageTops, scale],
  );

  const scrollToPage = useCallback(
    (page: number, rects?: NRect[]) => scrollTo(page, rects?.length ? Math.min(...rects.map((r) => r.y)) : undefined, { flash: rects }),
    [scrollTo],
  );

  // Restore last reading position once the layout is known.
  useEffect(() => {
    if (restored.current || !sizes.length || !width) return;
    const el = scrollRef.current!;
    if (props.initialProgress && props.initialProgress > 0) {
      requestAnimationFrame(() => {
        el.scrollTop = props.initialProgress! * (el.scrollHeight - el.clientHeight);
        restored.current = true;
      });
    } else {
      if (props.initialPage && props.initialPage > 1) scrollToPage(props.initialPage);
      restored.current = true;
    }
  }, [sizes, width, props.initialPage, props.initialProgress, scrollToPage]);

  // ── Search ──
  const showHit = useCallback(
    (list: FindHit[], i: number) => {
      const hit = list[i];
      if (hit) scrollTo(hit.page, Math.min(...hit.rects.map((r) => r.y)) - 0.05);
    },
    [scrollTo],
  );

  const find = useCallback(
    async (query: string) => {
      findRun.current.cancelled = true;
      const run = { cancelled: false };
      findRun.current = run;
      if (!query.trim() || !finder.current) {
        setHits(NO_HITS);
        onFind?.({ query, index: 0, count: 0, searching: false });
        return;
      }
      onFind?.({ query, index: 0, count: 0, searching: true });
      const list = await finder.current.find(query, run);
      if (run.cancelled) return;
      // Start from the first match at or after the current page.
      const el = scrollRef.current!;
      const fromPage = pageTops.findIndex((t, i) => t + sizes[i].h * scale > el.scrollTop) + 1;
      const start = Math.max(0, list.findIndex((h) => h.page >= fromPage));
      setHits(list.length ? list : NO_HITS);
      setHitIndex(start);
      showHit(list, start);
      onFind?.({ query, index: list.length ? start + 1 : 0, count: list.length, searching: false });
    },
    [onFind, pageTops, sizes, scale, showHit],
  );

  const findStep = useCallback(
    (dir: 1 | -1) => {
      if (!hits.length) return;
      const i = (hitIndex + dir + hits.length) % hits.length;
      setHitIndex(i);
      showHit(hits, i);
      onFind?.({ query: '', index: i + 1, count: hits.length, searching: false });
    },
    [hits, hitIndex, showHit, onFind],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage,
      scrollToHighlight: (h) => h.page && scrollToPage(h.page, h.rects),
      clearSelection: () => window.getSelection()?.removeAllRanges(),
      find,
      findStep,
    }),
    [scrollToPage, find, findStep],
  );

  // ── Links, previews, back navigation ──
  const peekTimers = useRef<{ show?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout> }>({});
  const peekToken = useRef(0);

  const goToDest = useCallback(
    async (dest: unknown) => {
      if (!doc) return;
      const point = await resolveDest(doc, dest);
      if (!point) return;
      const el = scrollRef.current!;
      setBack((b) => [...b.slice(-19), el.scrollTop]);
      setPeek(null);
      scrollTo(point.page, point.y, { flash: point.y !== undefined ? [{ x: 0.04, y: point.y, w: 0.92, h: 0.018 }] : undefined });
    },
    [doc, scrollTo],
  );

  const events = useRef<PageEvents>(null as unknown as PageEvents);
  events.current = {
    linkClick: (link, e) => {
      e.preventDefault();
      if (link.url) window.open(link.url, '_blank', 'noopener');
      else if (link.dest) goToDest(link.dest);
    },
    linkEnter: (link, el) => {
      clearTimeout(peekTimers.current.hide);
      clearTimeout(peekTimers.current.show);
      const token = ++peekToken.current;
      peekTimers.current.show = setTimeout(async () => {
        if (!doc) return;
        const dest = await resolveDest(doc, link.dest);
        if (!dest || token !== peekToken.current) return;
        const rect = await peekRect(doc, dest);
        setPeek({ anchor: el.getBoundingClientRect(), raw: link.dest, dest, rect });
        const [canvas, text] = await Promise.all([renderRegion(doc, dest.page, rect, 900), textInRect(doc, dest.page, rect)]);
        if (token === peekToken.current)
          setPeek((p) => (p && p.dest === dest ? { ...p, image: canvas.toDataURL('image/png'), cited: citedLink(text.slice(0, 400)) } : p));
      }, 320);
    },
    linkLeave: () => {
      clearTimeout(peekTimers.current.show);
      peekToken.current++;
      peekTimers.current.hide = setTimeout(() => setPeek(null), 250);
    },
    markClick: (id) => props.onMarkClick?.(id),
  };

  const askAboutPeek = async (p: Peek) => {
    if (!doc || !p.image) return;
    const text = await textInRect(doc, p.dest.page, p.rect);
    setPeek(null);
    onCapture({
      kind: 'image',
      image: p.image,
      text,
      page: p.dest.page,
      parts: [{ page: p.dest.page, rects: [p.rect] }],
      anchor: { x: p.anchor.left + p.anchor.width / 2, y: p.anchor.top, bottom: p.anchor.bottom },
    });
  };

  // ── Text selection → capture ──
  const readSelection = useCallback(() => {
    const sel = window.getSelection();
    const root = scrollRef.current;
    if (!sel || sel.isCollapsed || !root || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const text = cleanSelectionText(sel.toString());
    if (!text) return;
    const parts: { page: number; rects: NRect[] }[] = [];
    const rects = Array.from(range.getClientRects());
    root.querySelectorAll<HTMLElement>('.pdf-page').forEach((pageEl) => {
      const box = pageEl.getBoundingClientRect();
      // Element boxes fully inside the range (canvas, layers) come back too: keep only line-sized rects.
      const inside = rects.filter(
        (r) =>
          r.height < box.height * 0.08 &&
          r.top + r.height / 2 >= box.top &&
          r.top + r.height / 2 <= box.bottom &&
          r.left < box.right &&
          r.right > box.left,
      );
      if (inside.length) parts.push({ page: Number(pageEl.dataset.page), rects: normalizeRects(inside, box) });
    });
    const b = range.getBoundingClientRect();
    onCapture({ kind: 'text', text, page: parts[0]?.page, parts, anchor: { x: b.left + b.width / 2, y: b.top, bottom: b.bottom } });
  }, [onCapture]);

  const onMouseUp = (e: React.MouseEvent) => {
    if (areaMode) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return void setTimeout(readSelection, 0);
    // A plain click: maybe on a highlight
    const pageEl = (e.target as HTMLElement).closest<HTMLElement>('.pdf-page');
    if (!pageEl || (e.target as HTMLElement).closest('.pdf-link,.q-mark')) return;
    const box = pageEl.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    const page = Number(pageEl.dataset.page);
    const hit = (byPage.get(page) || []).find(({ rects }) => rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h));
    if (hit) onHighlightClick(hit.h, { x: e.clientX, y: e.clientY - 6, bottom: e.clientY + 6 });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key.startsWith('Arrow')) setTimeout(readSelection, 0);
    };
    window.addEventListener('keyup', onKey);
    return () => window.removeEventListener('keyup', onKey);
  }, [readSelection]);

  // Pinch / ctrl+wheel zoom
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const next = Math.min(4, Math.max(0.4, scale * Math.exp(-e.deltaY * 0.01)));
      onZoom(Math.round(next * 100) / 100);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, onZoom]);

  const onArea = async (r: AreaResult) => {
    onAreaDone();
    if (!doc) return;
    const [canvas, text] = await Promise.all([renderRegion(doc, r.page, r.rect), textInRect(doc, r.page, r.rect)]);
    onCapture({
      kind: 'image',
      image: canvas.toDataURL('image/png'),
      text,
      page: r.page,
      parts: [{ page: r.page, rects: [r.rect] }],
      anchor: r.anchor,
    });
  };

  if (error) return <div className="viewer-error">Не удалось открыть PDF: {error}</div>;

  const currentHit = hits[hitIndex] || null;

  return (
    <div
      ref={scrollRef}
      className={`pdf-scroll ${areaMode ? 'area-mode' : ''}`}
      onScroll={updateVisible}
      onMouseUp={onMouseUp}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('.pdf-link')) return;
        onCapture(null);
        const layer = (e.target as HTMLElement).closest('.pdf-page')?.querySelector('.textLayer');
        if (layer) {
          layer.classList.add('selecting');
          window.addEventListener('mouseup', () => layer.classList.remove('selecting'), { once: true });
        }
      }}
    >
      {!doc && (
        <div className="viewer-loading">
          <Loader2 className="spin" /> Открываю PDF…
        </div>
      )}
      {doc && (
        <div className="pdf-pages" style={{ paddingTop: PAGE_GAP, gap: PAGE_GAP }}>
          {sizes.map((size, i) => (
            <PdfPage
              key={i}
              doc={doc}
              n={i + 1}
              size={size}
              scale={scale}
              renderScale={renderScale}
              near={near.has(i + 1)}
              highlights={byPage.get(i + 1) || NO_HL}
              flash={flash?.page === i + 1 ? flash.rects : null}
              hits={hitsByPage.get(i + 1) || NO_HITS}
              current={currentHit?.page === i + 1 ? currentHit : null}
              marks={marksByPage.get(i + 1) || NO_MARKS}
              events={events}
            />
          ))}
        </div>
      )}
      {back.length > 0 &&
        createPortal(
          <button
            className="back-jump"
            onClick={() => {
              const top = back[back.length - 1];
              setBack((b) => b.slice(0, -1));
              scrollRef.current?.scrollTo({ top, behavior: 'smooth' });
            }}
          >
            <ArrowLeft size={15} /> Вернуться к чтению
          </button>,
          document.body,
        )}
      {peek &&
        createPortal(
          <div
            className="link-peek"
            style={{
              left: Math.min(window.innerWidth - 470, Math.max(8, peek.anchor.left + peek.anchor.width / 2 - 230)),
              ...(peek.anchor.top > window.innerHeight / 2
                ? { bottom: window.innerHeight - peek.anchor.top + 8 }
                : { top: peek.anchor.bottom + 8 }),
            }}
            onMouseEnter={() => clearTimeout(peekTimers.current.hide)}
            onMouseLeave={() => events.current.linkLeave()}
          >
            {peek.image ? <img src={peek.image} alt="" /> : <div className="peek-loading"><Loader2 className="spin" size={16} /></div>}
            <div className="peek-foot">
              <span className="muted">стр. {peek.dest.page}</span>
              <div className="row gap-4">
                {peek.cited && props.onOpenUrl && (
                  <button className="chip" title={peek.cited} onClick={() => (setPeek(null), props.onOpenUrl!(peek.cited!))}>
                    <BookOpen size={13} /> Открыть статью
                  </button>
                )}
                <button className="chip" onClick={() => askAboutPeek(peek)} disabled={!peek.image}>
                  <MessageCircleQuestion size={13} /> Спросить
                </button>
                <button className="chip" onClick={() => goToDest(peek.raw)}>
                  <CornerDownRight size={13} /> Перейти
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {areaMode && doc && <AreaSelect root={scrollRef} onDone={onArea} onCancel={onAreaDone} />}
    </div>
  );
});
