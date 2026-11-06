import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Quote,
  RotateCcw,
  Square,
  Terminal,
  X,
  AlertTriangle,
  Sparkles,
  Download,
  Paperclip,
  RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { QuickSwitcher } from '../components/QuickSwitcher.tsx';
import { api, fileUrl } from '../api.ts';
import { Markdown } from './Markdown.tsx';
import type { ChatState } from './useChat.ts';
import { FRAGMENT_ACTIONS, NOTES_PROMPT, STARTERS } from '../prompts.ts';
import type { Attachment, ChatMessage, PaperMeta, ToolUse } from '../../shared/types.ts';

export interface ChatPanelHandle {
  focus(): void;
  scrollToMessage(id: string): void;
}

interface Props {
  paper: PaperMeta;
  chat: ChatState;
  attachments: Attachment[];
  onRemoveAttachment(i: number): void;
  onAddAttachment(a: Attachment): void;
  onClearAttachments(): void;
  onJump(a: Attachment): void;
  onPage(page: number): void;
  onClose(): void;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="icon-btn ghost tiny"
      title="Скопировать"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function Tools({ tools, live }: { tools: ToolUse[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const running = tools.filter((t) => t.status === 'running');
  const last = running[running.length - 1] || tools[tools.length - 1];
  return (
    <div className="tools">
      <button className="tools-head" onClick={() => setOpen(!open)}>
        <ChevronRight size={14} className={open ? 'rot90' : ''} />
        {live && running.length ? <Loader2 size={13} className="spin" /> : <FileText size={13} />}
        <span className="tools-summary">{open || !live ? `${tools.length} ${plural(tools.length, 'действие', 'действия', 'действий')}` : last.summary}</span>
      </button>
      {open && (
        <ul className="tools-list">
          {tools.map((t) => (
            <li key={t.id} className={t.status}>
              {t.status === 'running' ? <Loader2 size={12} className="spin" /> : t.status === 'error' ? <X size={12} /> : <Check size={12} />}
              {t.summary}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function AttachmentView({ a, paperId, onJump }: { a: Attachment; paperId: string; onJump(a: Attachment): void }) {
  const [zoomed, setZoomed] = useState(false);
  const navigate = useNavigate();
  if (a.kind === 'paper')
    return (
      <button className="att-paper" onClick={() => a.paperId && navigate(`/paper/${a.paperId}`)} title="Открыть статью">
        <FileText size={13} /> {a.text}
      </button>
    );
  if (a.kind === 'image' && a.image) {
    const src = a.image.startsWith('data:') ? a.image : fileUrl(paperId, a.image);
    return (
      <>
        <div className="att-image" onClick={() => setZoomed(true)}>
          <img src={src} alt="" />
          {a.page ? (
            <button
              className="att-page"
              onClick={(e) => {
                e.stopPropagation();
                onJump(a);
              }}
            >
              стр. {a.page}
            </button>
          ) : null}
        </div>
        {zoomed && (
          <div className="lightbox" onClick={() => setZoomed(false)}>
            <img src={src} alt="" />
          </div>
        )}
      </>
    );
  }
  return (
    <button className="att-quote" onClick={() => onJump(a)} title="Показать в статье">
      <Quote size={12} />
      <span className="att-quote-text">{a.text}</span>
      {a.page ? <span className="att-page-inline">стр. {a.page}</span> : null}
    </button>
  );
}

function MessageView({
  m,
  paperId,
  onJump,
  onPage,
  onRetry,
}: {
  m: ChatMessage;
  paperId: string;
  onJump(a: Attachment): void;
  onPage(p: number): void;
  onRetry?(): void;
}) {
  if (m.role === 'system')
    return (
      <div className={`sys-msg ${m.error ? 'err' : ''}`}>
        {m.error ? <AlertTriangle size={13} /> : <Sparkles size={13} />}
        {m.text}
      </div>
    );
  if (m.role === 'user')
    return (
      <div className="msg user" data-mid={m.id}>
        {!!m.attachments?.length && (
          <div className="atts">
            {m.attachments.map((a, i) => (
              <AttachmentView key={i} a={a} paperId={paperId} onJump={onJump} />
            ))}
          </div>
        )}
        {m.text && <div className="user-text">{m.text}</div>}
      </div>
    );
  return (
    <div className="msg assistant" data-mid={m.id}>
      <Tools tools={m.tools || []} />
      {m.text && <Markdown text={m.text} onPage={onPage} />}
      {m.error && (
        <div className="msg-error">
          <AlertTriangle size={14} />
          <span className="grow">{m.error}</span>
          {onRetry && (
            <button className="chip" onClick={onRetry}>
              <RefreshCw size={12} /> Повторить
            </button>
          )}
        </div>
      )}
      <div className="msg-foot">
        {m.interrupted && <span className="muted small">остановлено</span>}
        {m.text && <CopyButton text={m.text} />}
      </div>
    </div>
  );
}

function StatusLine({ chat }: { chat: ChatState }) {
  const s = chat.session;
  const label = !chat.connected
    ? 'нет связи'
    : !s || s.status === 'offline'
      ? 'спит'
      : s.status === 'starting'
        ? 'запуск'
        : s.status === 'busy'
          ? s.warming
            ? 'настройка'
            : 'пишет'
          : 'готов';
  const model = s?.model?.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2');
  const skills = s?.skills.map((x) => x.replace(/^\//, '').split(':').pop()).join(', ');
  return (
    <div
      className="status-line"
      title={[model && `Модель: ${model}`, skills && `Скиллы: ${skills}${s?.skillsActive ? '' : ' (включаются)'}`].filter(Boolean).join('\n')}
    >
      <span className={`dot ${chat.connected ? s?.status || 'offline' : 'offline'}`} />
      <span>{label}</span>
      {model && <span className="muted">{model}</span>}
    </div>
  );
}

export const ChatPanel = forwardRef<ChatPanelHandle, Props>(function ChatPanel(props, ref) {
  const { paper, chat, attachments, onRemoveAttachment, onAddAttachment, onClearAttachments, onJump, onPage, onClose } = props;
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'chat' | 'notes'>('chat');
  const [menu, setMenu] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useImperativeHandle(ref, () => ({
    focus: () => {
      setTab('chat');
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    scrollToMessage: (id: string) => {
      setTab('chat');
      setTimeout(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${id}"]`);
        if (!el) return;
        stick.current = false;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.remove('pulse');
        void el.offsetWidth;
        el.classList.add('pulse');
      }, 0);
    },
  }));

  useEffect(() => {
    api.notes(paper.id).then(setNotes);
  }, [paper.id, chat.answerTick]);

  // Follow the conversation unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.partial, tab]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(220, el.scrollHeight) + 'px';
  }, [text]);

  const busy = chat.session?.status === 'busy' && !chat.session.warming;

  const submit = async (override?: string) => {
    const body = (override ?? text).trim();
    if (!body && !attachments.length) return;
    stick.current = true;
    const atts = attachments;
    if (override === undefined) setText('');
    onClearAttachments();
    try {
      await chat.send(body, atts);
    } catch (e) {
      // Give back what was typed so nothing is lost.
      if (override === undefined) setText(body);
      atts.forEach(onAddAttachment);
      alert((e as Error).message);
    }
  };

  const copyResume = () => {
    if (!chat.session?.resumeCommand) return;
    navigator.clipboard.writeText(chat.session.resumeCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    setMenu(false);
  };

  const visible = chat.messages;
  const empty = !visible.some((m) => m.role !== 'system') && !chat.partial;

  return (
    <aside className="chat">
      <div className="chat-head">
        <div className="chat-tabs">
          <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
            Claude
          </button>
          <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>
            Конспект
          </button>
        </div>
        <div className="row gap-2">
          <StatusLine chat={chat} />
          <div className="menu-wrap">
            <button className="icon-btn ghost" onClick={() => setMenu(!menu)}>
              {copied ? <Check size={16} /> : <MoreHorizontal size={16} />}
            </button>
            {menu && (
              <>
                <div className="menu-backdrop" onClick={() => setMenu(false)} />
                <div className="menu">
                  <button disabled={!chat.session?.resumeCommand} onClick={copyResume}>
                    <Terminal size={15} /> Скопировать команду для терминала
                  </button>
                  <a className="menu-link" href={`/api/papers/${paper.id}/export`} onClick={() => setMenu(false)}>
                    <Download size={15} /> Экспорт: выделения, конспект и чат (.md)
                  </a>
                  <button
                    onClick={() => {
                      setMenu(false);
                      if (confirm('Начать новую сессию Claude для этой статьи? Текущий чат уйдёт в архив.')) chat.reset();
                    }}
                  >
                    <RotateCcw size={15} /> Новая сессия
                  </button>
                  {chat.session?.sessionId && <div className="menu-note">session: {chat.session.sessionId}</div>}
                </div>
              </>
            )}
          </div>
          <button className="icon-btn ghost" title="Скрыть чат" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      {tab === 'notes' ? (
        <div className="chat-body notes">
          {notes ? (
            <Markdown text={notes} onPage={onPage} />
          ) : (
            <div className="empty-notes">
              <p>Конспекта пока нет. Claude соберёт его из статьи и твоих вопросов в notes.md.</p>
            </div>
          )}
          <button
            className="btn primary block"
            disabled={busy}
            onClick={() => {
              setTab('chat');
              submit(NOTES_PROMPT);
            }}
          >
            <NotebookPen size={16} /> {notes ? 'Обновить конспект' : 'Собрать конспект'}
          </button>
        </div>
      ) : (
        <div
          className="chat-body"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
        >
          {empty && (
            <div className="chat-empty">
              <p>
                Выдели в статье непонятное место — появится меню с вопросами. <kbd>S</kbd> вырезает формулу, рисунок или таблицу
                скриншотом.
              </p>
              <div className="starters">
                <div className="starters-label">Или начни с</div>
                {STARTERS.map((s) => (
                  <button key={s.id} className="starter" onClick={() => submit(s.prompt)}>
                    <span>{s.label}</span>
                    <ArrowUp size={13} className="starter-arrow" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {visible.map((m, i) => (
            <MessageView
              key={m.id}
              m={m}
              paperId={paper.id}
              onJump={onJump}
              onPage={onPage}
              onRetry={m.error && i === visible.length - 1 && !busy ? () => chat.retry(m.id) : undefined}
            />
          ))}
          {busy && (
            <div className="msg assistant live">
              <Tools tools={chat.partial?.tools || []} live />
              {chat.partial?.text ? (
                <Markdown text={chat.partial.text + ' ▍'} streaming onPage={onPage} />
              ) : (
                <div className="thinking">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
          )}
          {!!chat.session?.queued && <div className="sys-msg">в очереди: {chat.session.queued}</div>}
        </div>
      )}

      {tab === 'chat' && (
        <div className="composer">
          {!!attachments.length && (
            <>
              <div className="pending">
                {attachments.map((a, i) => (
                  <div key={i} className="pending-item">
                    {a.kind === 'image' ? <img src={a.image} alt="" /> : a.kind === 'paper' ? <FileText size={12} /> : <Quote size={12} />}
                    <span>{a.kind === 'image' ? `Скриншот${a.page ? ` · стр. ${a.page}` : ''}` : a.kind === 'paper' ? `Статья: ${a.text}` : a.text}</span>
                    <button className="icon-btn ghost tiny" onClick={() => onRemoveAttachment(i)}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="quick">
                {FRAGMENT_ACTIONS.map((q) => (
                  <button key={q.id} className="chip" onClick={() => submit(q.prompt)}>
                    {q.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="input-row">
            <button className="icon-btn ghost attach-btn" title="Прикрепить другую статью из библиотеки — Claude прочитает её для ответа" onClick={() => setPicking(true)}>
              <Paperclip size={17} />
            </button>
            <textarea
              ref={inputRef}
              value={text}
              rows={1}
              placeholder={attachments.length ? 'Что непонятно в этом фрагменте?' : 'Спроси про статью…  (/ — фокус)'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === 'Escape') inputRef.current?.blur();
              }}
              onPaste={(e) => {
                const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
                if (!file) return;
                e.preventDefault();
                const reader = new FileReader();
                reader.onload = () => onAddAttachment({ kind: 'image', image: String(reader.result) });
                reader.readAsDataURL(file);
              }}
            />
            {busy ? (
              <button className="send stop" title="Остановить" onClick={chat.interrupt}>
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button className="send" title="Отправить (Enter)" disabled={!text.trim() && !attachments.length} onClick={() => submit()}>
                <ArrowUp size={16} />
              </button>
            )}
          </div>
          <div className="composer-hint">Enter — отправить · ⌘V — картинка · скрепка — добавить другую статью</div>
        </div>
      )}
      {picking && (
        <QuickSwitcher
          title="Какую статью прикрепить к вопросу?"
          exclude={paper.id}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            if (!attachments.some((a) => a.paperId === p.id)) onAddAttachment({ kind: 'paper', paperId: p.id, text: p.title });
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        />
      )}
    </aside>
  );
});
