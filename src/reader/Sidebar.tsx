import { useState } from 'react';
import { ChevronRight, Highlighter, ListTree, MessageCircleQuestion } from 'lucide-react';
import type { Highlight } from '../../shared/types.ts';
import { HL_COLORS, type OutlineItem } from './types.ts';

function OutlineTree({ items, onPage, current, depth = 0 }: { items: OutlineItem[]; onPage(p: number): void; current: number; depth?: number }) {
  return (
    <ul className="outline">
      {items.map((it, i) => (
        <OutlineNode key={i} it={it} onPage={onPage} current={current} depth={depth} />
      ))}
    </ul>
  );
}

function OutlineNode({ it, onPage, current, depth }: { it: OutlineItem; onPage(p: number): void; current: number; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  return (
    <li>
      <div className={`outline-row ${it.page === current ? 'cur' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
        {it.children.length ? (
          <button className="twisty" onClick={() => setOpen(!open)}>
            <ChevronRight size={13} className={open ? 'rot90' : ''} />
          </button>
        ) : (
          <span className="twisty" />
        )}
        <button className="outline-title" disabled={it.page === null} onClick={() => it.page !== null && onPage(it.page)}>
          {it.title}
        </button>
        {it.page !== null && it.page > 0 && <span className="outline-page">{it.page}</span>}
      </div>
      {open && it.children.length > 0 && <OutlineTree items={it.children} onPage={onPage} current={current} depth={depth + 1} />}
    </li>
  );
}

export function Sidebar({
  outline,
  highlights,
  current,
  onPage,
  onHighlight,
  onAsk,
}: {
  outline: OutlineItem[];
  highlights: Highlight[];
  current: number;
  onPage(p: number): void;
  onHighlight(h: Highlight): void;
  onAsk(h: Highlight): void;
}) {
  const [picked, setTab] = useState<'outline' | 'highlights' | null>(null);
  const tab = picked ?? (outline.length ? 'outline' : 'highlights');
  const sorted = [...highlights].sort((a, b) => (a.page || 0) - (b.page || 0) || (a.rects?.[0]?.y || 0) - (b.rects?.[0]?.y || 0));
  return (
    <nav className="sidebar">
      <div className="seg full">
        <button className={tab === 'outline' ? 'on' : ''} onClick={() => setTab('outline')}>
          <ListTree size={14} /> Оглавление
        </button>
        <button className={tab === 'highlights' ? 'on' : ''} onClick={() => setTab('highlights')}>
          <Highlighter size={14} /> Выделения {highlights.length ? <span className="count">{highlights.length}</span> : null}
        </button>
      </div>
      <div className="sidebar-body">
        {tab === 'outline' &&
          (outline.length ? (
            <OutlineTree items={outline} onPage={onPage} current={current} />
          ) : (
            <p className="muted small pad">В файле нет оглавления.</p>
          ))}
        {tab === 'highlights' &&
          (sorted.length ? (
            <ul className="hl-list">
              {sorted.map((h) => (
                <li key={h.id} onClick={() => onHighlight(h)}>
                  <span className="hl-bar" style={{ background: HL_COLORS[h.color] }} />
                  <div className="hl-item">
                    <div className="hl-text">{h.text || 'Область'}</div>
                    {h.note && <div className="hl-note">{h.note}</div>}
                    <div className="hl-meta">
                      {h.page ? `стр. ${h.page}` : ''}
                      <button
                        className="icon-btn ghost tiny"
                        title="Спросить Claude"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAsk(h);
                        }}
                      >
                        <MessageCircleQuestion size={14} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small pad">Выдели текст и нажми на цветной кружок — выделение появится здесь.</p>
          ))}
      </div>
    </nav>
  );
}
