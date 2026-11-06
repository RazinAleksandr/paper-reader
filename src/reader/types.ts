import type { Highlight, HighlightColor, NRect } from '../../shared/types.ts';

/** Something the reader picked out of the paper: a text selection or a screenshot. */
export interface Capture {
  kind: 'text' | 'image';
  text: string;
  /** data URL for screenshots */
  image?: string;
  page?: number;
  /** per page rects of a text selection, for highlights */
  parts?: { page: number; rects: NRect[] }[];
  /** html highlights anchor */
  prefix?: string;
  suffix?: string;
  /** viewport rect to place the floating menu */
  anchor: { x: number; y: number; bottom: number };
}

export interface OutlineItem {
  title: string;
  page: number | null;
  children: OutlineItem[];
}

export interface ViewerHandle {
  scrollToPage(page: number, rects?: NRect[]): void;
  scrollToHighlight(h: Pick<Highlight, 'id' | 'text' | 'prefix' | 'suffix' | 'page' | 'rects'>): void;
  clearSelection(): void;
  /** full-text search; results are reported through onFind */
  find(query: string): void;
  findStep(dir: 1 | -1): void;
}

export interface FindState {
  query: string;
  index: number;
  count: number;
  searching: boolean;
}

/** A question asked about a place in the paper, shown on the page margin. */
export interface QuestionMark {
  id: string;
  page: number;
  y: number;
  text: string;
}

export interface ViewerProps {
  paperId: string;
  highlights: Highlight[];
  initialPage?: number;
  initialProgress?: number;
  zoom: number;
  areaMode: boolean;
  onZoom(z: number): void;
  onPosition(page: number, total: number, progress: number): void;
  onCapture(c: Capture | null): void;
  onAreaDone(): void;
  onHighlightClick(h: Highlight, anchor: { x: number; y: number; bottom: number }): void;
  onOutline?(items: OutlineItem[]): void;
  onFind?(state: FindState): void;
  marks?: QuestionMark[];
  onMarkClick?(id: string): void;
  /** open a cited paper (arXiv/DOI/URL found in the reference) */
  onOpenUrl?(url: string): void;
}

export const HL_COLORS: Record<HighlightColor, string> = {
  yellow: 'var(--hl-yellow)',
  green: 'var(--hl-green)',
  blue: 'var(--hl-blue)',
  pink: 'var(--hl-pink)',
};

/** Merge per-line client rects into a few rects relative to a page box. */
export function normalizeRects(rects: DOMRect[], box: DOMRect): NRect[] {
  const sorted = rects
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: { x: number; y: number; w: number; h: number }[] = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    const sameLine = last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) * 0.6;
    if (sameLine && r.x <= last.x + last.w + 12 && r.x + r.w >= last.x - 12) {
      const x1 = Math.min(last.x, r.x);
      const x2 = Math.max(last.x + last.w, r.x + r.w);
      const y1 = Math.min(last.y, r.y);
      const y2 = Math.max(last.y + last.h, r.y + r.h);
      Object.assign(last, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    } else lines.push({ ...r });
  }
  return lines.map((r) => ({ x: r.x / box.width, y: r.y / box.height, w: r.w / box.width, h: r.h / box.height }));
}

export function cleanSelectionText(s: string): string {
  return s
    .replace(/\u00ad/g, '')
    .replace(/-\n(?=[a-zа-я])/g, '')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/([^\n])\n(?!\n)/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
