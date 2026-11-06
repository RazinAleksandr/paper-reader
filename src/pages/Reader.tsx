import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Coffee,
  Keyboard,
  Search,
  MessageSquare,
  Minus,
  Moon,
  PanelLeft,
  Plus,
  Scissors,
  Sun,
  Loader2,
} from 'lucide-react';
import { api } from '../api.ts';
import { useLocalState, useTheme } from '../theme.ts';
import { PdfView } from '../reader/PdfView.tsx';
import { HtmlView } from '../reader/HtmlView.tsx';
import { Sidebar } from '../reader/Sidebar.tsx';
import { HighlightPopover, SelectionMenu } from '../reader/Popovers.tsx';
import { ChatPanel, type ChatPanelHandle } from '../chat/ChatPanel.tsx';
import { useChat } from '../chat/useChat.ts';
import { FRAGMENT_ACTIONS } from '../prompts.ts';
import type { Capture, FindState, OutlineItem, QuestionMark, ViewerHandle } from '../reader/types.ts';
import { TabBar } from '../components/TabBar.tsx';
import { SearchBar } from '../reader/SearchBar.tsx';
import { ShortcutsHelp } from '../components/ShortcutsHelp.tsx';
import { refreshPapers, setActivePaper, tabStore } from '../workspace.ts';
import type { Attachment, Highlight, HighlightColor, PaperMeta } from '../../shared/types.ts';

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function captureToAttachment(c: Capture): Attachment {
  if (c.kind === 'image') return { kind: 'image', image: c.image, text: c.text || undefined, page: c.page, rects: c.parts?.[0]?.rects };
  return { kind: 'text', text: c.text, page: c.page, rects: c.parts?.[0]?.rects };
}

/** Fragments picked for the next question survive switching between papers. */
const pendingByPaper = new Map<string, Attachment[]>();

const isTyping = (e: KeyboardEvent) => !!(e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]');

export function Reader({ onSwitcher }: { onSwitcher(): void }) {
  const { id = '' } = useParams();
  const [paper, setPaper] = useState<PaperMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [zoom, setZoom] = useState(0);
  const [areaMode, setAreaMode] = useState(false);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [hlPop, setHlPop] = useState<{ h: Highlight; anchor: Capture['anchor'] } | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>(() => pendingByPaper.get(id) || []);
  useEffect(() => {
    if (attachments.length) pendingByPaper.set(id, attachments);
    else pendingByPaper.delete(id);
  }, [id, attachments]);
  const [pos, setPos] = useState({ page: 1, total: 0, progress: 0 });
  const [pageInput, setPageInput] = useState('');
  const [sidebar, setSidebar] = useLocalState('pr-sidebar', false);
  const [chatOpen, setChatOpen] = useLocalState('pr-chat-open', true);
  const [chatWidth, setChatWidth] = useLocalState('pr-chat-width', 440);
  const { theme, cycle } = useTheme();
  const [find, setFind] = useState<FindState | null>(null);
  const [help, setHelp] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const viewer = useRef<ViewerHandle>(null);
  const chatRef = useRef<ChatPanelHandle>(null);
  const chat = useChat(id);

  useEffect(() => {
    api
      .paper(id)
      .then((p) => {
        setPaper(p);
        setZoom(p.zoom || 0);
        tabStore.open(id);
        api.updatePaper(id, { openedAt: true });
        api.startSession(id).catch(() => {});
      })
      .catch((e) => setError(e.message));
    api.highlights(id).then(setHighlights);
    setActivePaper(id);
    return () => setActivePaper(null);
  }, [id]);

  useEffect(() => {
    if (paper) document.title = `${paper.title} — Paper Reader`;
    return () => {
      document.title = 'Paper Reader';
    };
  }, [paper]);

  // Persist reading position and zoom, debounced.
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingPos = useRef<{ lastPage: number; progress: number } | null>(null);
  const onPosition = useCallback(
    (page: number, total: number, progress: number) => {
      setPos({ page, total, progress });
      pendingPos.current = { lastPage: page, progress };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        if (pendingPos.current) api.updatePaper(id, pendingPos.current);
        pendingPos.current = null;
      }, 800);
    },
    [id],
  );
  // Switching tabs unmounts the reader: save the position right away.
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      if (pendingPos.current) api.updatePaper(id, pendingPos.current);
    },
    [id],
  );
  const zoomTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const changeZoom = useCallback(
    (z: number) => {
      setZoom(z);
      clearTimeout(zoomTimer.current);
      zoomTimer.current = setTimeout(() => api.updatePaper(id, { zoom: z }), 600);
    },
    [id],
  );

  const currentZoom = () => {
    if (zoom) return zoom;
    const canvas = document.querySelector<HTMLElement>('.pdf-page');
    return canvas ? Number(getComputedStyle(canvas).getPropertyValue('--total-scale-factor')) || 1 : 1;
  };
  const stepZoom = (dir: 1 | -1) => {
    const z = currentZoom();
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.01) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.01);
    changeZoom(next ?? z);
  };

  const onCapture = useCallback((c: Capture | null) => {
    setCapture(c);
    if (c) setHlPop(null);
  }, []);
  const onAreaDone = useCallback(() => setAreaMode(false), []);
  const onHighlightClick = useCallback((h: Highlight, anchor: Capture['anchor']) => {
    setCapture(null);
    setHlPop({ h, anchor });
  }, []);

  const openChat = () => {
    setChatOpen(true);
    setTimeout(() => chatRef.current?.focus(), 0);
  };

  const ask = (c: Capture) => {
    setAttachments((list) => [...list, captureToAttachment(c)]);
    setCapture(null);
    viewer.current?.clearSelection();
    openChat();
  };

  const quickAction = (c: Capture, prompt: string) => {
    const atts = [...attachments, captureToAttachment(c)];
    setAttachments([]);
    setCapture(null);
    viewer.current?.clearSelection();
    setChatOpen(true);
    chat.send(prompt, atts).catch((e) => alert(e.message));
  };

  const addHighlight = async (c: Capture, color: HighlightColor) => {
    setCapture(null);
    viewer.current?.clearSelection();
    // The same passage highlighted again just changes its color.
    const same = highlights.find((h) => h.text === c.text && h.page === c.page);
    if (same) {
      const h = await api.updateHighlight(id, same.id, { color });
      setHighlights((list) => list.map((x) => (x.id === h.id ? h : x)));
      return;
    }
    const first = c.parts?.[0];
    const created = await api.addHighlight(id, {
      color,
      text: c.text,
      page: first?.page,
      rects: first?.rects,
      parts: c.parts && c.parts.length > 1 ? c.parts : undefined,
      prefix: c.prefix,
      suffix: c.suffix,
    });
    setHighlights((list) => [...list, created]);
  };

  const highlightToAttachment = (h: Highlight): Attachment => ({ kind: 'text', text: h.text, page: h.page, rects: h.rects });

  // Questions asked about a place in the PDF become marks on the page margin.
  const marks = useMemo(() => {
    const list: QuestionMark[] = [];
    for (const m of chat.messages) {
      if (m.role !== 'user') continue;
      const a = m.attachments?.find((x) => x.page && x.rects?.length);
      if (a) list.push({ id: m.id, page: a.page!, y: Math.min(...a.rects!.map((r) => r.y)), text: m.text || a.text || 'Вопрос' });
    }
    return list;
  }, [chat.messages]);
  const onMarkClick = useCallback((mid: string) => {
    setChatOpen(true);
    setTimeout(() => chatRef.current?.scrollToMessage(mid), 0);
  }, [setChatOpen]);

  const navigate = useNavigate();
  const [opening, setOpening] = useState<string | null>(null);
  const openCited = useCallback(
    async (url: string) => {
      setOpening(url);
      try {
        const meta = await api.importUrl(url);
        refreshPapers();
        navigate(`/paper/${meta.id}`);
      } catch (e) {
        alert(`Не получилось открыть ${url}: ${(e as Error).message}`);
      } finally {
        setOpening(null);
      }
    },
    [navigate],
  );

  const rename = async (title: string) => {
    setRenaming(false);
    if (!title.trim() || title.trim() === paper?.title) return;
    setPaper(await api.updatePaper(id, { title: title.trim() }));
    refreshPapers();
  };

  const jumpTo = (a: Attachment) => {
    if (paper?.kind === 'pdf' && a.page) viewer.current?.scrollToPage(a.page, a.rects);
    else if (a.text) viewer.current?.scrollToHighlight({ id: '', text: a.text });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'f' || e.key === 'а')) {
        e.preventDefault();
        setFind((f) => f || { query: '', index: 0, count: 0, searching: false });
        setTimeout(() => document.querySelector<HTMLInputElement>('.searchbar input')?.select(), 0);
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        stepZoom(1);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        stepZoom(-1);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        changeZoom(0);
        return;
      }
      if (isTyping(e) || mod || e.altKey) return;
      if (e.key === 'Escape') {
        setCapture(null);
        setHlPop(null);
        setAreaMode(false);
        setHelp(false);
      } else if (e.key === '?') {
        setHelp((v) => !v);
      } else if (e.key === 's' || e.key === 'ы') {
        e.preventDefault();
        setCapture(null);
        setAreaMode((v) => !v);
      } else if (e.key === '/') {
        e.preventDefault();
        openChat();
      } else if (capture && (e.key === 'a' || e.key === 'ф')) {
        e.preventDefault();
        ask(capture);
      } else if (capture && (e.key === 'e' || e.key === 'у')) {
        e.preventDefault();
        quickAction(capture, FRAGMENT_ACTIONS[0].prompt);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Drag the splitter to resize the chat.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = chatWidth;
    const move = (ev: MouseEvent) => setChatWidth(Math.min(900, Math.max(320, startW + startX - ev.clientX)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (error)
    return (
      <div className="center-screen">
        <p>{error}</p>
        <Link to="/" className="btn">
          В библиотеку
        </Link>
      </div>
    );
  if (!paper)
    return (
      <div className="center-screen">
        <Loader2 className="spin" />
      </div>
    );

  const isPdf = paper.kind === 'pdf';
  const Viewer = isPdf ? PdfView : HtmlView;
  const zoomLabel = zoom ? `${Math.round(zoom * 100)}%` : 'по ширине';

  return (
    <div className="reader" style={{ '--chat-w': `${chatWidth}px` } as React.CSSProperties}>
      <TabBar current={id} onNew={onSwitcher} />
      <header className="topbar">
        <div className="row gap-4 grow min0">
          <button className={`icon-btn ghost ${sidebar ? 'active' : ''}`} title="Оглавление и выделения" onClick={() => setSidebar(!sidebar)}>
            <PanelLeft size={16} />
          </button>
          {renaming ? (
            <input
              className="title-input"
              autoFocus
              defaultValue={paper.title}
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') rename(e.currentTarget.value);
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <div className="doc-title" title={`${paper.title}\nДвойной клик — переименовать`} onDoubleClick={() => setRenaming(true)}>
              {paper.title}
            </div>
          )}
        </div>

        <div className="row gap-4 toolbar">
          {isPdf && pos.total > 0 && (
            <form
              className="page-box"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(pageInput);
                if (n >= 1 && n <= pos.total) viewer.current?.scrollToPage(n);
                setPageInput('');
                (document.activeElement as HTMLElement)?.blur();
              }}
            >
              <input value={pageInput} placeholder={String(pos.page)} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))} />
              <span className="muted">/ {pos.total}</span>
            </form>
          )}
          <div className="zoom">
            <button className="icon-btn ghost" title="Уменьшить (⌘−)" onClick={() => stepZoom(-1)}>
              <Minus size={16} />
            </button>
            <button className="zoom-label" title="По ширине (⌘0)" onClick={() => changeZoom(0)}>
              {zoomLabel}
            </button>
            <button className="icon-btn ghost" title="Увеличить (⌘+)" onClick={() => stepZoom(1)}>
              <Plus size={16} />
            </button>
          </div>
          <button
            className={`tool-btn ${areaMode ? 'active' : ''}`}
            title="Вырезать область скриншотом (S)"
            onClick={() => {
              setCapture(null);
              setAreaMode(!areaMode);
            }}
          >
            <Scissors size={14} /> Область <kbd>S</kbd>
          </button>
        </div>

        <div className="row gap-4 grow end">
          <button
            className={`icon-btn ghost ${find ? 'active' : ''}`}
            title="Поиск по статье (⌘F)"
            onClick={() => setFind((f) => (f ? null : { query: '', index: 0, count: 0, searching: false }))}
          >
            <Search size={16} />
          </button>
          <button className="icon-btn ghost" title="Горячие клавиши (?)" onClick={() => setHelp(true)}>
            <Keyboard size={16} />
          </button>
          <button className="icon-btn ghost" title="Тема: светлая / сепия / тёмная" onClick={cycle}>
            {theme === 'dark' ? <Moon size={16} /> : theme === 'sepia' ? <Coffee size={16} /> : <Sun size={16} />}
          </button>
          {!chatOpen && (
            <button className="btn primary small" onClick={openChat}>
              <MessageSquare size={15} /> Claude
            </button>
          )}
        </div>
        <div className="read-progress" style={{ width: `${pos.progress * 100}%` }} />
        {find && (
          <SearchBar
            state={find}
            onQuery={(q) => viewer.current?.find(q)}
            onStep={(d) => viewer.current?.findStep(d)}
            onClose={() => {
              viewer.current?.find('');
              setFind(null);
            }}
          />
        )}
      </header>

      <div className={`reader-body ${chatOpen ? 'with-chat' : ''} ${sidebar ? 'with-sidebar' : ''}`}>
        {sidebar && (
          <Sidebar
            outline={outline}
            highlights={highlights}
            current={pos.page}
            onPage={(p) => viewer.current?.scrollToPage(p)}
            onHighlight={(h) => viewer.current?.scrollToHighlight(h)}
            onAsk={(h) => {
              setAttachments((l) => [...l, highlightToAttachment(h)]);
              openChat();
            }}
          />
        )}
        <main className="viewer">
          <Viewer
            ref={viewer}
            paperId={paper.id}
            highlights={highlights}
            initialPage={paper.lastPage}
            initialProgress={paper.progress}
            zoom={zoom}
            areaMode={areaMode}
            onZoom={changeZoom}
            onPosition={onPosition}
            onCapture={onCapture}
            onAreaDone={onAreaDone}
            onHighlightClick={onHighlightClick}
            onOutline={setOutline}
            onFind={(f) => setFind((cur) => (cur ? { ...f, query: f.query || cur.query } : cur))}
            marks={marks}
            onMarkClick={onMarkClick}
            onOpenUrl={openCited}
          />
        </main>
        {chatOpen && (
          <>
            <div className="splitter" onMouseDown={startResize} />
            <ChatPanel
              ref={chatRef}
              paper={paper}
              chat={chat}
              attachments={attachments}
              onAddAttachment={(a) => setAttachments((l) => [...l, a])}
              onRemoveAttachment={(i) => setAttachments((l) => l.filter((_, j) => j !== i))}
              onClearAttachments={() => setAttachments([])}
              onJump={jumpTo}
              onPage={(p) => viewer.current?.scrollToPage(p)}
              onClose={() => setChatOpen(false)}
            />
          </>
        )}
      </div>

      {capture && (
        <SelectionMenu
          capture={capture}
          onAsk={() => ask(capture)}
          onAction={(prompt) => quickAction(capture, prompt)}
          onHighlight={(c) => addHighlight(capture, c)}
        />
      )}
      {hlPop && (
        <HighlightPopover
          key={hlPop.h.id}
          h={hlPop.h}
          anchor={hlPop.anchor}
          onAsk={() => {
            setAttachments((l) => [...l, highlightToAttachment(hlPop.h)]);
            setHlPop(null);
            openChat();
          }}
          onColor={async (color) => {
            const h = await api.updateHighlight(id, hlPop.h.id, { color });
            setHighlights((l) => l.map((x) => (x.id === h.id ? h : x)));
            setHlPop({ ...hlPop, h });
          }}
          onNote={async (note) => {
            const h = await api.updateHighlight(id, hlPop.h.id, { note });
            setHighlights((l) => l.map((x) => (x.id === h.id ? h : x)));
            setHlPop(null);
          }}
          onDelete={async () => {
            await api.deleteHighlight(id, hlPop.h.id);
            setHighlights((l) => l.filter((x) => x.id !== hlPop.h.id));
            setHlPop(null);
          }}
        />
      )}
      {hlPop && <div className="click-away" onMouseDown={() => setHlPop(null)} />}
      {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
      {opening && (
        <div className="toast">
          <Loader2 size={15} className="spin" /> Открываю {opening.replace(/^https?:\/\//, '')}…
        </div>
      )}
    </div>
  );
}
