import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Globe, Link2, Loader2, Search } from 'lucide-react';
import { api } from '../api.ts';
import { refreshPapers, usePapers } from '../workspace.ts';
import type { PaperMeta } from '../../shared/types.ts';

export function matchPaper(p: PaperMeta, q: string) {
  const hay = `${p.title} ${p.authors || ''} ${p.source.url || p.source.name || ''}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/**
 * ⌘K palette: jump to any paper, or paste a link to open a new one.
 * With `onPick` it becomes a picker (e.g. to attach a paper to a question).
 */
export function QuickSwitcher({
  onClose,
  onPick,
  exclude,
  title,
}: {
  onClose(): void;
  onPick?(p: PaperMeta): void;
  exclude?: string;
  title?: string;
}) {
  const papers = usePapers();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    refreshPapers().catch(() => {});
  }, []);

  const isUrl = /^https?:\/\/\S+$/i.test(q.trim()) || /^(arxiv\.org|www\.)\S+$/i.test(q.trim());
  const items = useMemo(() => papers.filter((p) => p.id !== exclude && matchPaper(p, q)).slice(0, 50), [papers, q, exclude]);
  const total = items.length + (isUrl && !onPick ? 1 : 0);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.qs-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const choose = async (i: number) => {
    if (isUrl && !onPick && i === items.length) {
      setBusy(true);
      setError(null);
      try {
        const url = q.trim().startsWith('http') ? q.trim() : `https://${q.trim()}`;
        const meta = await api.importUrl(url);
        await refreshPapers();
        onClose();
        navigate(`/paper/${meta.id}`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    const p = items[i];
    if (!p) return;
    onClose();
    if (onPick) onPick(p);
    else navigate(`/paper/${p.id}`);
  };

  return (
    <div className="modal-backdrop qs-backdrop" onMouseDown={onClose}>
      <div className="qs" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qs-input">
          {busy ? <Loader2 size={17} className="spin" /> : <Search size={17} />}
          <input
            autoFocus
            value={q}
            placeholder={title || 'Найти статью или вставить ссылку…'}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(total - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(sel);
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        {error && <div className="qs-error">{error}</div>}
        <div className="qs-list" ref={listRef}>
          {items.map((p, i) => (
            <button key={p.id} className={`qs-item ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
              {p.kind === 'pdf' ? <FileText size={15} /> : <Globe size={15} />}
              <span className="qs-title">{p.title}</span>
              {p.authors && <span className="qs-sub">{p.authors}</span>}
            </button>
          ))}
          {isUrl && !onPick && (
            <button className={`qs-item ${sel === items.length ? 'on' : ''}`} onMouseEnter={() => setSel(items.length)} onClick={() => choose(items.length)}>
              <Link2 size={15} />
              <span className="qs-title">Открыть ссылку {q.trim()}</span>
            </button>
          )}
          {!total && <div className="qs-empty">{papers.length ? 'Ничего не нашлось' : 'Библиотека пуста'}</div>}
        </div>
      </div>
    </div>
  );
}
