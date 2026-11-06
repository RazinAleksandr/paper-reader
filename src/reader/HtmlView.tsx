import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { domToCanvas } from 'modern-screenshot';
import { Loader2 } from 'lucide-react';
import { fileUrl } from '../api.ts';
import type { Highlight, HighlightColor } from '../../shared/types.ts';
import { cleanSelectionText, type OutlineItem, type ViewerHandle, type ViewerProps } from './types.ts';
import { AreaSelect, type AreaResult } from './AreaSelect.tsx';

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];
const CONTEXT = 40;

/** Flat view over an element's text nodes, to map text offsets back to DOM ranges. */
function textIndex(root: HTMLElement) {
  const nodes: { node: Text; start: number }[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, start: text.length });
    text += (n as Text).data;
  }
  const locate = (offset: number) => {
    let lo = 0;
    let hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (nodes[mid].start <= offset) lo = mid;
      else hi = mid - 1;
    }
    const n = nodes[lo];
    return { node: n.node, offset: Math.min(offset - n.start, n.node.data.length) };
  };
  const offsetOf = (node: Node, offset: number) => {
    const hit = nodes.find((n) => n.node === node);
    return hit ? hit.start + offset : -1;
  };
  return { text, locate, offsetOf };
}

type Index = ReturnType<typeof textIndex>;

const squash = (s: string) => s.replace(/\s+/g, ' ');

/** Words of the article inside a client rectangle (for screenshots, so Claude also gets the text). */
function textOfRect(root: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n && out.length < 400; n = walker.nextNode()) {
    range.selectNodeContents(n);
    const b = range.getBoundingClientRect();
    if (b.bottom < rect.top || b.top > rect.top + rect.height || b.right < rect.left || b.left > rect.left + rect.width) continue;
    out.push((n as Text).data);
  }
  return squash(out.join(' ')).trim().slice(0, 4000);
}

function findRange(idx: Index, h: Pick<Highlight, 'text' | 'prefix' | 'suffix'>): Range | null {
  // Compare on whitespace-collapsed text, then map positions back.
  const map: number[] = [];
  let flat = '';
  for (let i = 0; i < idx.text.length; i++) {
    const c = /\s/.test(idx.text[i]) ? ' ' : idx.text[i];
    if (c === ' ' && flat.endsWith(' ')) continue;
    flat += c;
    map.push(i);
  }
  const exact = squash(h.text).trim();
  if (!exact) return null;
  let best = -1;
  let bestScore = -1;
  for (let at = flat.indexOf(exact); at >= 0; at = flat.indexOf(exact, at + 1)) {
    let score = 0;
    if (h.prefix && flat.slice(Math.max(0, at - CONTEXT - 5), at).includes(squash(h.prefix).trim().slice(-15))) score += 1;
    if (h.suffix && flat.slice(at + exact.length, at + exact.length + CONTEXT + 5).includes(squash(h.suffix).trim().slice(0, 15))) score += 1;
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  if (best < 0) return null;
  const start = idx.locate(map[best]);
  const end = idx.locate(map[best + exact.length - 1] + 1);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

export const HtmlView = forwardRef<ViewerHandle, ViewerProps>(function HtmlView(props, ref) {
  const { paperId, highlights, zoom, areaMode, onPosition, onCapture, onAreaDone, onHighlightClick, onOutline, onZoom, onFind } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranges = useRef<Map<string, Range>>(new Map());
  const hits = useRef<{ list: Range[]; index: number }>({ list: [], index: 0 });
  const restored = useRef(false);
  const restoredDone = useRef(false);

  useEffect(() => {
    fetch(fileUrl(paperId, 'article.html'))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((h) => setHtml(h.replace(/(src|href)="assets\//g, `$1="${fileUrl(paperId, 'assets/')}`)))
      .catch((e) => setError(e.message));
  }, [paperId]);

  // Outline from headings
  useEffect(() => {
    const el = articleRef.current;
    if (!html || !el) return;
    const items: OutlineItem[] = [];
    el.querySelectorAll<HTMLElement>('h1,h2,h3').forEach((h, i) => {
      h.dataset.outline = String(i);
      items.push({ title: h.textContent?.trim() || '', page: -(i + 1), children: [] });
    });
    onOutline?.(items.filter((i) => i.title));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  // Paint highlights with the CSS Custom Highlight API (no DOM mutation).
  useEffect(() => {
    const el = articleRef.current;
    if (!html || !el || !('highlights' in CSS)) return;
    const idx = textIndex(el);
    const next = new Map<string, Range>();
    const byColor: Record<string, Range[]> = {};
    for (const h of highlights) {
      const r = findRange(idx, h);
      if (!r) continue;
      next.set(h.id, r);
      (byColor[h.color] ||= []).push(r);
    }
    ranges.current = next;
    for (const c of COLORS) CSS.highlights.set(`hl-${c}`, new window.Highlight(...(byColor[c] || [])));
    return () => {
      for (const c of COLORS) CSS.highlights.delete(`hl-${c}`);
    };
  }, [html, highlights]);

  const flash = (r: Range) => {
    if (!('highlights' in CSS)) return;
    CSS.highlights.set('hl-flash', new window.Highlight(r));
    setTimeout(() => CSS.highlights.delete('hl-flash'), 1800);
  };

  const showHit = (i: number) => {
    const { list } = hits.current;
    const r = list[i];
    if (!r || !('highlights' in CSS)) return;
    hits.current.index = i;
    CSS.highlights.set('find-cur', new window.Highlight(r));
    const box = r.getBoundingClientRect();
    const el = scrollRef.current!;
    el.scrollTo({ top: el.scrollTop + box.top - el.getBoundingClientRect().top - el.clientHeight * 0.35, behavior: 'smooth' });
  };

  useImperativeHandle(
    ref,
    () => ({
      find: (query: string) => {
        const root = articleRef.current;
        const q = query.trim();
        if (!root || !('highlights' in CSS)) return;
        CSS.highlights.delete('find-hit');
        CSS.highlights.delete('find-cur');
        hits.current = { list: [], index: 0 };
        if (!q) return onFind?.({ query, index: 0, count: 0, searching: false });
        const idx = textIndex(root);
        const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi');
        const list: Range[] = [];
        for (const m of idx.text.matchAll(re)) {
          if (list.length >= 2000) break;
          const a = idx.locate(m.index!);
          const b = idx.locate(m.index! + m[0].length);
          const r = document.createRange();
          r.setStart(a.node, a.offset);
          r.setEnd(b.node, b.offset);
          list.push(r);
        }
        hits.current.list = list;
        CSS.highlights.set('find-hit', new window.Highlight(...list));
        showHit(0);
        onFind?.({ query, index: list.length ? 1 : 0, count: list.length, searching: false });
      },
      findStep: (dir: 1 | -1) => {
        const { list, index } = hits.current;
        if (!list.length) return;
        const i = (index + dir + list.length) % list.length;
        showHit(i);
        onFind?.({ query: '', index: i + 1, count: list.length, searching: false });
      },
      scrollToPage: (page) => {
        // Negative "pages" are heading indexes from the outline.
        if (page < 0) articleRef.current?.querySelector(`[data-outline="${-page - 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      scrollToHighlight: (h) => {
        const r = ranges.current.get(h.id) || (articleRef.current && findRange(textIndex(articleRef.current), h));
        if (!r) return;
        const box = r.getBoundingClientRect();
        const el = scrollRef.current!;
        el.scrollTo({ top: el.scrollTop + box.top - el.getBoundingClientRect().top - el.clientHeight * 0.3, behavior: 'smooth' });
        flash(r);
      },
      clearSelection: () => window.getSelection()?.removeAllRanges(),
    }),
    [],
  );

  const report = useCallback(() => {
    const el = scrollRef.current;
    // Until the saved position is restored, scrolling is layout noise, not reading.
    if (!el || !restoredDone.current) return;
    const max = el.scrollHeight - el.clientHeight;
    onPosition(0, 0, max > 0 ? Math.min(1, el.scrollTop / max) : 1);
  }, [onPosition]);

  useEffect(() => {
    if (!html || restored.current) return;
    restored.current = true;
    // Images change the article height: restore the position once they have loaded.
    const imgs = Array.from(articleRef.current?.querySelectorAll('img') || []);
    const loaded = imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((done) => {
            img.addEventListener('load', () => done(), { once: true });
            img.addEventListener('error', () => done(), { once: true });
          }),
    );
    Promise.race([Promise.all(loaded), new Promise((r) => setTimeout(r, 2500))]).then(() =>
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        if (props.initialProgress) el.scrollTop = props.initialProgress * (el.scrollHeight - el.clientHeight);
        restoredDone.current = true;
        report();
      }),
    );
  }, [html, props.initialProgress, report]);

  const readSelection = useCallback(() => {
    const sel = window.getSelection();
    const root = articleRef.current;
    if (!sel || sel.isCollapsed || !root || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const text = cleanSelectionText(sel.toString());
    if (!text) return;
    const idx = textIndex(root);
    const start = idx.offsetOf(range.startContainer, range.startOffset);
    const end = idx.offsetOf(range.endContainer, range.endOffset);
    const b = range.getBoundingClientRect();
    onCapture({
      kind: 'text',
      text,
      prefix: start >= 0 ? idx.text.slice(Math.max(0, start - CONTEXT), start) : undefined,
      suffix: end >= 0 ? idx.text.slice(end, end + CONTEXT) : undefined,
      anchor: { x: b.left + b.width / 2, y: b.top, bottom: b.bottom },
    });
  }, [onCapture]);

  const onMouseUp = (e: React.MouseEvent) => {
    if (areaMode) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return void setTimeout(readSelection, 0);
    const caret = (document as any).caretRangeFromPoint?.(e.clientX, e.clientY) as Range | null;
    if (!caret) return;
    for (const h of highlights) {
      const r = ranges.current.get(h.id);
      if (r && r.isPointInRange(caret.startContainer, caret.startOffset)) {
        onHighlightClick(h, { x: e.clientX, y: e.clientY - 6, bottom: e.clientY + 6 });
        return;
      }
    }
  };

  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const cur = zoom || 1;
      onZoom(Math.round(Math.min(2.2, Math.max(0.6, cur * Math.exp(-e.deltaY * 0.01))) * 100) / 100);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, onZoom]);

  const onArea = async (r: AreaResult) => {
    onAreaDone();
    const el = r.el;
    const box = el.getBoundingClientRect();
    const scale = 2;
    // Render only the selected region: a whole long article would exceed canvas size limits.
    const x = r.client.left - box.left;
    const y = r.client.top - box.top;
    const crop = await domToCanvas(el, {
      scale,
      width: r.client.width,
      height: r.client.height,
      backgroundColor: getComputedStyle(el).backgroundColor,
      style: { margin: '0', transform: `translate(${-x}px, ${-y}px)`, transformOrigin: '0 0' },
    });
    const text = textOfRect(el, r.client);
    onCapture({ kind: 'image', image: crop.toDataURL('image/png'), text, anchor: r.anchor });
  };

  if (error) return <div className="viewer-error">Не удалось открыть статью: {error}</div>;

  return (
    <div
      ref={scrollRef}
      className={`html-scroll ${areaMode ? 'area-mode' : ''}`}
      onScroll={report}
      onMouseUp={onMouseUp}
      onMouseDown={() => onCapture(null)}
    >
      {!html && (
        <div className="viewer-loading">
          <Loader2 className="spin" /> Открываю статью…
        </div>
      )}
      {html && (
        <article
          ref={articleRef}
          className="article"
          style={{ '--article-scale': zoom || 1 } as React.CSSProperties}
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest('a');
            if (a?.getAttribute('href')?.startsWith('http')) {
              e.preventDefault();
              window.open(a.href, '_blank', 'noopener');
            }
          }}
        />
      )}
      {areaMode && html && <AreaSelect root={scrollRef} target=".article" onDone={onArea} onCancel={onAreaDone} />}
    </div>
  );
});
