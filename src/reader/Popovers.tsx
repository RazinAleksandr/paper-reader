import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Copy, MessageCircleQuestion, StickyNote, Trash2 } from 'lucide-react';
import type { Highlight, HighlightColor } from '../../shared/types.ts';
import { FRAGMENT_ACTIONS } from '../prompts.ts';
import { HL_COLORS, type Capture } from './types.ts';

const COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];

/** Fixed-position bubble above (or below) an anchor point, kept inside the window. */
function Floating({ anchor, children, className = '' }: { anchor: Capture['anchor']; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, anchor.x - w / 2));
    const above = anchor.y - h - 10;
    const top = above > 56 ? above : Math.min(window.innerHeight - h - 8, anchor.bottom + 10);
    setPos({ left, top });
  }, [anchor.x, anchor.y, anchor.bottom]);
  return createPortal(
    <div
      ref={ref}
      className={`floating ${className}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function SelectionMenu({
  capture,
  onAsk,
  onAction,
  onHighlight,
}: {
  capture: Capture;
  onAsk(): void;
  onAction(prompt: string): void;
  onHighlight(c: HighlightColor): void;
}) {
  return (
    <Floating anchor={capture.anchor} className="sel-menu">
      {capture.kind === 'image' && capture.image && <img className="sel-thumb" src={capture.image} alt="" />}
      <button className="sel-primary" onClick={onAsk} title="Добавить в вопрос (A)">
        <MessageCircleQuestion size={16} /> Спросить
      </button>
      {FRAGMENT_ACTIONS.map((a) => (
        <button key={a.id} onClick={() => onAction(a.prompt)} title={a.prompt}>
          {a.label}
        </button>
      ))}
      <span className="sel-sep" />
      {COLORS.map((c) => (
        <button key={c} className="swatch" style={{ background: HL_COLORS[c] }} title="Выделить цветом" onClick={() => onHighlight(c)} />
      ))}
      {capture.kind === 'text' && (
        <button title="Копировать" onClick={() => navigator.clipboard.writeText(capture.text)}>
          <Copy size={14} />
        </button>
      )}
    </Floating>
  );
}

export function HighlightPopover({
  h,
  anchor,
  onAsk,
  onColor,
  onNote,
  onDelete,
}: {
  h: Highlight;
  anchor: Capture['anchor'];
  onAsk(): void;
  onColor(c: HighlightColor): void;
  onNote(note: string): void;
  onDelete(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(h.note || '');
  return (
    <Floating anchor={anchor} className="hl-pop">
      <div className="row gap-4">
        <button className="sel-primary" onClick={onAsk}>
          <MessageCircleQuestion size={16} /> Спросить
        </button>
        {COLORS.map((c) => (
          <button key={c} className={`swatch ${h.color === c ? 'on' : ''}`} style={{ background: HL_COLORS[c] }} onClick={() => onColor(c)} />
        ))}
        <button title="Заметка" onClick={() => setEditing(!editing)}>
          <StickyNote size={15} />
        </button>
        <button title="Удалить выделение" onClick={onDelete}>
          <Trash2 size={15} />
        </button>
      </div>
      {editing ? (
        <div className="note-edit" onMouseDown={(e) => e.stopPropagation()}>
          <textarea autoFocus rows={3} value={note} placeholder="Заметка к выделению" onChange={(e) => setNote(e.target.value)} />
          <button className="btn primary small" onClick={() => onNote(note)}>
            Сохранить
          </button>
        </div>
      ) : (
        h.note && <div className="note-view">{h.note}</div>
      )}
    </Floating>
  );
}
