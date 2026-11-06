import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Coffee, Loader2, Moon, Search, Settings, Sun, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { useTheme } from '../theme.ts';
import { SettingsDialog } from '../components/SettingsDialog.tsx';
import { matchPaper } from '../components/QuickSwitcher.tsx';
import { refreshPapers, tabStore, useActivity } from '../workspace.ts';
import type { Health, PaperMeta } from '../../shared/types.ts';

type Sort = 'recent' | 'added' | 'title';
const SORTS: Record<Sort, string> = { recent: 'Недавно открытые', added: 'Недавно добавленные', title: 'По названию' };

const ACCEPT = '.pdf,.docx,.html,.htm,.md,.markdown,.txt';

function timeAgo(iso?: string) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'сейчас';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} дн`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function sourceLabel(p: PaperMeta) {
  if (p.source.url) {
    try {
      return new URL(p.source.url).hostname.replace(/^www\./, '');
    } catch {
      return 'ссылка';
    }
  }
  return p.source.name?.split('.').pop()?.toUpperCase() || 'файл';
}

const EXAMPLE = 'https://arxiv.org/abs/1706.03762';

export function Library({ onSwitcher }: { onSwitcher(): void }) {
  const navigate = useNavigate();
  const { theme, cycle } = useTheme();
  const [papers, setPapers] = useState<PaperMeta[] | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('pr-sort') as Sort) || 'recent');
  const [health, setHealth] = useState<Health | null>(null);
  const activity = useActivity();
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const load = useCallback(() => refreshPapers().then(setPapers).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
    api.health().then(setHealth).catch(() => {});
  }, [load]);
  useEffect(() => localStorage.setItem('pr-sort', sort), [sort]);

  // ./paper-reader <url> lands here with ?open=
  const opened = useRef(false);
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get('open');
    if (!target || opened.current) return;
    opened.current = true;
    window.history.replaceState(null, '', '/');
    openUrl(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (label: string, fn: () => Promise<PaperMeta>) => {
    setBusy(label);
    setError(null);
    try {
      const meta = await fn();
      navigate(`/paper/${meta.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openFile = (file: File) => run(`Загружаю «${file.name}»…`, () => api.upload(file));
  const openUrl = (u: string) => {
    const clean = u.trim();
    if (!clean) return;
    run('Скачиваю статью…', () => api.importUrl(clean));
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea')) return;
      const file = e.clipboardData?.files?.[0];
      if (file) return void openFile(file);
      const text = e.clipboardData?.getData('text') || '';
      if (/^https?:\/\//.test(text.trim())) openUrl(text);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const remove = async (p: PaperMeta) => {
    if (!confirm(`Удалить «${p.title}» вместе с чатом и выделениями?`)) return;
    await api.deletePaper(p.id);
    tabStore.close(p.id);
    load();
  };

  const shown = (papers || [])
    .filter((p) => matchPaper(p, filter))
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'added'
          ? b.createdAt.localeCompare(a.createdAt)
          : (b.openedAt || b.createdAt).localeCompare(a.openedAt || a.createdAt),
    );

  return (
    <div
      className={`library ${dragging ? 'dragging' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) return openFile(file);
        const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text');
        if (text) openUrl(text);
      }}
    >
      <header className="lib-header">
        <div className="wordmark">Paper Reader</div>
        <div className="row gap-2">
          <button className="icon-btn" title="Быстрый переход (⌘K)" onClick={onSwitcher}>
            <Search size={16} />
          </button>
          <button className="icon-btn" title="Тема" onClick={cycle}>
            {theme === 'dark' ? <Moon size={16} /> : theme === 'sepia' ? <Coffee size={16} /> : <Sun size={16} />}
          </button>
          <button className="icon-btn" title="Настройки Claude" onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      <main className="lib-main">
        {health && !health.claude.ok && (
          <div className="notice">
            <b>Claude Code не найден</b> — {health.claude.error}. Установи{' '}
            <a href="https://docs.claude.com/en/docs/claude-code" target="_blank" rel="noreferrer">
              Claude Code
            </a>
            , выполни <code>claude</code> → <code>/login</code> и перезапусти Paper Reader.
          </div>
        )}

        <form
          className={`import-bar ${busy ? 'busy' : ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            openUrl(url);
          }}
        >
          <input
            value={busy || url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Ссылка на статью — arXiv, PDF, страница журнала или блога"
            disabled={!!busy}
            autoFocus
          />
          {busy ? (
            <Loader2 size={16} className="spin muted" />
          ) : url.trim() ? (
            <button className="btn primary small">
              Открыть <ArrowRight size={14} />
            </button>
          ) : (
            <button type="button" className="btn small" onClick={() => fileInput.current?.click()}>
              Выбрать файл
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) openFile(f);
            }}
          />
        </form>
        <p className="import-hint">
          Или перетащи в окно PDF, DOCX, HTML, Markdown. <kbd>⌘V</kbd> тоже работает.
        </p>
        {error && <div className="notice err">{error}</div>}

        {papers && papers.length === 0 && (
          <div className="empty-lib">
            <p>
              Библиотека пустая. Открой статью, выдели непонятное место и спроси Claude — у каждой статьи будет своя сессия Claude Code.
            </p>
            <button className="link" onClick={() => openUrl(EXAMPLE)}>
              Открыть для примера «Attention Is All You Need»
            </button>
          </div>
        )}

        {papers && papers.length > 0 && (
          <section className="shelf">
            <div className="shelf-head">
              <div className="shelf-title">
                Библиотека <span className="muted">{papers.length}</span>
              </div>
              <div className="row gap-6">
                <div className="shelf-search">
                  <Search size={13} className="muted" />
                  <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Фильтр" />
                </div>
                <select className="shelf-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  {(Object.keys(SORTS) as Sort[]).map((k) => (
                    <option key={k} value={k}>
                      {SORTS[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <ul className="paper-list">
              {shown.map((p) => {
                const busyNow = activity.status[p.id] === 'busy';
                const unread = activity.unread.has(p.id);
                const pct = Math.round((p.progress || 0) * 100);
                return (
                  <li key={p.id}>
                    <Link to={`/paper/${p.id}`} className="paper-row">
                      <div className="paper-main">
                        <div className="paper-title">
                          {p.title}
                          {(busyNow || unread) && <span className={`live-dot ${busyNow ? 'busy' : ''}`} title={busyNow ? 'Claude отвечает' : 'Новый ответ'} />}
                        </div>
                        <div className="paper-meta">
                          {p.authors && <span className="paper-authors">{p.authors}</span>}
                          <span>{sourceLabel(p)}</span>
                          {p.pages ? <span>{p.pages} стр.</span> : null}
                          {p.messageCount ? <span>{p.messageCount} вопр.</span> : null}
                        </div>
                      </div>
                      <div className="paper-progress" title={`Прочитано ${pct}%`}>
                        <div className="bar">
                          <div style={{ width: `${pct}%` }} />
                        </div>
                        <span>{pct ? `${pct}%` : ''}</span>
                      </div>
                      <div className="paper-when">{timeAgo(p.openedAt || p.createdAt)}</div>
                      <button
                        className="icon-btn row-del"
                        title="Удалить"
                        onClick={(e) => {
                          e.preventDefault();
                          remove(p);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </Link>
                  </li>
                );
              })}
              {!shown.length && <li className="muted pad">Ничего не нашлось</li>}
            </ul>
          </section>
        )}
      </main>
      {dragging && <div className="drop-overlay">Отпусти файл, чтобы открыть</div>}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
