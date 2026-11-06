import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react';
import type { FindState } from './types.ts';

export function SearchBar({
  state,
  onQuery,
  onStep,
  onClose,
}: {
  state: FindState;
  onQuery(q: string): void;
  onStep(dir: 1 | -1): void;
  onClose(): void;
}) {
  const [q, setQ] = useState(state.query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search as you type, a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => onQuery(q), 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="searchbar">
      {state.searching ? <Loader2 size={15} className="spin muted" /> : <Search size={15} className="muted" />}
      <input
        ref={inputRef}
        value={q}
        placeholder="Найти в статье"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') onClose();
        }}
      />
      <span className="search-count">{q.trim() && !state.searching ? (state.count ? `${state.index} из ${state.count}` : 'нет') : ''}</span>
      <button className="icon-btn tiny ghost" title="Предыдущее (Shift+Enter)" onClick={() => onStep(-1)} disabled={!state.count}>
        <ChevronUp size={15} />
      </button>
      <button className="icon-btn tiny ghost" title="Следующее (Enter)" onClick={() => onStep(1)} disabled={!state.count}>
        <ChevronDown size={15} />
      </button>
      <button className="icon-btn tiny ghost" title="Закрыть (Esc)" onClick={onClose}>
        <X size={15} />
      </button>
    </div>
  );
}
