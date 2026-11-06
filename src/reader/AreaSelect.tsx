import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { NRect } from '../../shared/types.ts';

export interface AreaResult {
  el: HTMLElement;
  page: number;
  /** normalized to the target element */
  rect: NRect;
  /** client coords of the selection */
  client: { left: number; top: number; width: number; height: number };
  anchor: { x: number; y: number; bottom: number };
}

interface Props {
  root: RefObject<HTMLElement | null>;
  target?: string;
  onDone(r: AreaResult): void;
  onCancel(): void;
}

function rectOf(d: { sx: number; sy: number; x1: number; y1: number }, box: DOMRect) {
  const x0 = box.left + d.sx;
  const y0 = box.top + d.sy;
  return { left: Math.min(x0, d.x1), top: Math.min(y0, d.y1), width: Math.abs(d.x1 - x0), height: Math.abs(d.y1 - y0) };
}

/** Drag a rectangle over one page (or the article) to cut out a screenshot. */
export function AreaSelect({ root, target = '.pdf-page', onDone, onCancel }: Props) {
  // Start point is kept relative to the target so autoscroll does not shift it.
  const [drag, setDrag] = useState<{ el: HTMLElement; sx: number; sy: number; x1: number; y1: number } | null>(null);

  const cbs = useRef({ onDone, onCancel });
  cbs.current = { onDone, onCancel };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let current: typeof drag = null;

    const clampTo = (box: DOMRect, x: number, y: number) => ({
      x: Math.min(box.right, Math.max(box.left, x)),
      y: Math.min(box.bottom, Math.max(box.top, y)),
    });

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const pageEl = (e.target as HTMLElement).closest<HTMLElement>(target);
      if (!pageEl) return;
      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();
      const box = pageEl.getBoundingClientRect();
      current = { el: pageEl, sx: e.clientX - box.left, sy: e.clientY - box.top, x1: e.clientX, y1: e.clientY };
      setDrag(current);
    };
    const onMove = (e: MouseEvent) => {
      if (!current) return;
      const p = clampTo(current.el.getBoundingClientRect(), e.clientX, e.clientY);
      current = { ...current, x1: p.x, y1: p.y };
      setDrag(current);
      // autoscroll near edges
      const box = el.getBoundingClientRect();
      if (e.clientY > box.bottom - 30) el.scrollTop += 14;
      else if (e.clientY < box.top + 30) el.scrollTop -= 14;
    };
    const onUp = () => {
      const d = current;
      current = null;
      setDrag(null);
      if (!d) return;
      const box = d.el.getBoundingClientRect();
      const { left, top, width, height } = rectOf(d, box);
      if (width < 8 || height < 8) return;
      cbs.current.onDone({
        el: d.el,
        page: Number(d.el.dataset.page || 0),
        rect: { x: (left - box.left) / box.width, y: (top - box.top) / box.height, w: width / box.width, h: height / box.height },
        client: { left, top, width, height },
        anchor: { x: left + width / 2, y: top, bottom: top + height },
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cbs.current.onCancel();
    };

    el.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [root, target]);

  return createPortal(
    <>
      {!drag && <div className="area-hint">Выдели область мышкой · Esc — отмена</div>}
      {drag && <div className="area-rect" style={rectOf(drag, drag.el.getBoundingClientRect())} />}
    </>,
    document.body,
  );
}
