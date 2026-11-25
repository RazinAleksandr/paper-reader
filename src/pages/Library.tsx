import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Coffee, Loader2, Moon, Search, Settings, Sun, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { useTheme } from '../theme.ts';
import { SettingsDialog } from '../components/SettingsDialog.tsx';
import { matchPaper } from '../components/QuickSwitcher.tsx';
import { refreshPapers, tabStore, useActivity } from '../workspace.ts';
import { t } from '../i18n.ts';
import type { Health, PaperMeta } from '../../shared/types.ts';

type Sort = 'recent' | 'added' | 'title';
const SORTS: Sort[] = ['recent', 'added', 'title'];
const sortLabel = (s: Sort) =>
  s === 'recent'
    ? t('Recently opened', 'Недавно открытые', '最近打开')
    : s === 'added'
      ? t('Recently added', 'Недавно добавленные', '最近添加')
      : t('By title', 'По названию', '按标题');

const ACCEPT = '.pdf,.docx,.html,.htm,.md,.markdown,.txt';

function timeAgo(iso?: string) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return t('now', 'сейчас', '刚刚');
  // Compact: the column is narrow.
  if (diff < 3600) {
    const n = Math.floor(diff / 60);
    return t(`${n} min`, `${n} мин`, `${n}分钟前`);
  }
  if (diff < 86400) {
    const n = Math.floor(diff / 3600);
    return t(`${n} hr`, `${n} ч`, `${n}小时前`);
  }
  if (diff < 86400 * 7) {
    const n = Math.floor(diff / 86400);
    return t(`${n} ${n === 1 ? 'day' : 'days'}`, `${n} дн`, `${n}天前`);
  }
  return new Date(iso).toLocaleDateString(t('en-US', 'ru-RU', 'zh-CN'), { day: 'numeric', month: 'short' });
}

function sourceLabel(p: PaperMeta) {
  if (p.source.url) {
    try {
      return new URL(p.source.url).hostname.replace(/^www\./, '');
    } catch {
      return t('link', 'ссылка', '链接');
    }
  }
  return p.source.name?.split('.').pop()?.toUpperCase() || t('file', 'файл', '文件');
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

  const openFile = (file: File) => run(t(`Uploading “${file.name}”…`, `Загружаю «${file.name}»…`, `正在上传“${file.name}”…`), () => api.upload(file));
  const openUrl = (u: string) => {
    const clean = u.trim();
    if (!clean) return;
    run(t('Downloading the paper…', 'Скачиваю статью…', '正在下载论文…'), () => api.importUrl(clean));
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
    if (!confirm(t(`Delete “${p.title}” with its chat and highlights?`, `Удалить «${p.title}» вместе с чатом и выделениями?`, `删除《${p.title}》及其对话和高亮？`))) return;
    await api.deletePaper(p.id);
    tabStore.close(p.id);
    load();
  };

  const importHint = t(
    'Or drop a PDF, DOCX, HTML or Markdown file into the window. {K} works too.',
    'Или перетащи в окно PDF, DOCX, HTML, Markdown. {K} тоже работает.',
    '也可以把 PDF、DOCX、HTML、Markdown 文件拖进窗口，{K} 粘贴同样可以。',
  ).split('{K}');

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
          <button className="icon-btn" title={t('Quick open (⌘K)', 'Быстрый переход (⌘K)', '快速跳转（⌘K）')} onClick={onSwitcher}>
            <Search size={16} />
          </button>
          <button className="icon-btn" title={t('Theme', 'Тема', '主题')} onClick={cycle}>
            {theme === 'dark' ? <Moon size={16} /> : theme === 'sepia' ? <Coffee size={16} /> : <Sun size={16} />}
          </button>
          <button className="icon-btn" title={t('Settings', 'Настройки', '设置')} onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      <main className="lib-main">
        {health && !health.claude.ok && (
          <div className="notice">
            <b>{t('Claude Code not found', 'Claude Code не найден', '未找到 Claude Code')}</b> — {health.claude.error}. {t('Install', 'Установи', '请安装')}{' '}
            <a href="https://docs.claude.com/en/docs/claude-code" target="_blank" rel="noreferrer">
              Claude Code
            </a>
            {t(', run', ', выполни', '，运行')} <code>claude</code> → <code>/login</code>{' '}
            {t('and restart Paper Reader.', 'и перезапусти Paper Reader.', '然后重启 Paper Reader。')}
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
            placeholder={t(
              'Link to a paper — arXiv, PDF, a journal or blog page',
              'Ссылка на статью — arXiv, PDF, страница журнала или блога',
              '论文链接：arXiv、PDF、期刊或博客页面',
            )}
            disabled={!!busy}
            autoFocus
          />
          {busy ? (
            <Loader2 size={16} className="spin muted" />
          ) : url.trim() ? (
            <button className="btn primary small">
              {t('Open', 'Открыть', '打开')} <ArrowRight size={14} />
            </button>
          ) : (
            <button type="button" className="btn small" onClick={() => fileInput.current?.click()}>
              {t('Choose file', 'Выбрать файл', '选择文件')}
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
          {importHint[0]}
          <kbd>⌘V</kbd>
          {importHint[1]}
        </p>
        {error && <div className="notice err">{error}</div>}

        {papers && papers.length === 0 && (
          <div className="empty-lib">
            <p>
              {t(
                'Your library is empty. Open a paper, select anything unclear and ask Claude — each paper gets its own Claude Code session.',
                'Библиотека пустая. Открой статью, выдели непонятное место и спроси Claude — у каждой статьи будет своя сессия Claude Code.',
                '论文库还是空的。打开一篇论文，选中看不懂的地方，然后问 Claude——每篇论文都有自己的 Claude Code 会话。',
              )}
            </p>
            <button className="link" onClick={() => openUrl(EXAMPLE)}>
              {t('Open “Attention Is All You Need” as an example', 'Открыть для примера «Attention Is All You Need»', '打开示例论文《Attention Is All You Need》')}
            </button>
          </div>
        )}

        {papers && papers.length > 0 && (
          <section className="shelf">
            <div className="shelf-head">
              <div className="shelf-title">
                {t('Library', 'Библиотека', '论文库')} <span className="muted">{papers.length}</span>
              </div>
              <div className="row gap-6">
                <div className="shelf-search">
                  <Search size={13} className="muted" />
                  <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('Filter', 'Фильтр', '筛选')} />
                </div>
                <select className="shelf-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  {SORTS.map((k) => (
                    <option key={k} value={k}>
                      {sortLabel(k)}
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
                          {(busyNow || unread) && <span className={`live-dot ${busyNow ? 'busy' : ''}`} title={busyNow ? t('Claude is answering', 'Claude отвечает', 'Claude 正在回答') : t('New answer', 'Новый ответ', '有新回答')} />}
                        </div>
                        <div className="paper-meta">
                          {p.authors && <span className="paper-authors">{p.authors}</span>}
                          <span>{sourceLabel(p)}</span>
                          {p.pages ? <span>{t(`${p.pages} ${p.pages === 1 ? 'page' : 'pages'}`, `${p.pages} стр.`, `${p.pages} 页`)}</span> : null}
                          {p.messageCount ? (
                            <span>{t(`${p.messageCount} ${p.messageCount === 1 ? 'question' : 'questions'}`, `${p.messageCount} вопр.`, `${p.messageCount} 个问题`)}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="paper-progress" title={t(`${pct}% read`, `Прочитано ${pct}%`, `已读 ${pct}%`)}>
                        <div className="bar">
                          <div style={{ width: `${pct}%` }} />
                        </div>
                        <span>{pct ? `${pct}%` : ''}</span>
                      </div>
                      <div className="paper-when">{timeAgo(p.openedAt || p.createdAt)}</div>
                      <button
                        className="icon-btn row-del"
                        title={t('Delete', 'Удалить', '删除')}
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
              {!shown.length && <li className="muted pad">{t('Nothing found', 'Ничего не нашлось', '没有找到')}</li>}
            </ul>
          </section>
        )}
      </main>
      {dragging && <div className="drop-overlay">{t('Drop the file to open it', 'Отпусти файл, чтобы открыть', '松开即可打开文件')}</div>}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
