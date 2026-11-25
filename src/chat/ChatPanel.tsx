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
import { fragmentActions, notesPrompt, starters } from '../prompts.ts';
import { pageRef, t } from '../i18n.ts';
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
      title={t('Copy', 'Скопировать', '复制')}
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
        <span className="tools-summary">{open || !live ? actionCount(tools.length) : last.summary}</span>
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

const actionCount = (n: number) =>
  t(`${n} ${n === 1 ? 'action' : 'actions'}`, `${n} ${plural(n, 'действие', 'действия', 'действий')}`, `${n} 个操作`);

function AttachmentView({ a, paperId, onJump }: { a: Attachment; paperId: string; onJump(a: Attachment): void }) {
  const [zoomed, setZoomed] = useState(false);
  const navigate = useNavigate();
  if (a.kind === 'paper')
    return (
      <button className="att-paper" onClick={() => a.paperId && navigate(`/paper/${a.paperId}`)} title={t('Open paper', 'Открыть статью', '打开论文')}>
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
              {pageRef(a.page)}
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
    <button className="att-quote" onClick={() => onJump(a)} title={t('Show in paper', 'Показать в статье', '在论文中显示')}>
      <Quote size={12} />
      <span className="att-quote-text">{a.text}</span>
      {a.page ? <span className="att-page-inline">{pageRef(a.page)}</span> : null}
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
              <RefreshCw size={12} /> {t('Retry', 'Повторить', '重试')}
            </button>
          )}
        </div>
      )}
      <div className="msg-foot">
        {m.interrupted && <span className="muted small">{t('stopped', 'остановлено', '已停止')}</span>}
        {m.text && <CopyButton text={m.text} />}
      </div>
    </div>
  );
}

function StatusLine({ chat }: { chat: ChatState }) {
  const s = chat.session;
  const label = !chat.connected
    ? t('disconnected', 'нет связи', '未连接')
    : !s || s.status === 'offline'
      ? t('asleep', 'спит', '休眠')
      : s.status === 'starting'
        ? t('starting', 'запуск', '启动中')
        : s.status === 'busy'
          ? s.warming
            ? t('setting up', 'настройка', '准备中')
            : t('writing', 'пишет', '回答中')
          : t('ready', 'готов', '就绪');
  const model = s?.model?.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2');
  const skills = s?.skills.map((x) => x.replace(/^\//, '').split(':').pop()).join(', ');
  return (
    <div
      className="status-line"
      title={[
        model && t(`Model: ${model}`, `Модель: ${model}`, `模型：${model}`),
        skills && t(`Skills: ${skills}`, `Скиллы: ${skills}`, `技能：${skills}`) + (s?.skillsActive ? '' : t(' (activating)', ' (включаются)', '（启用中）')),
      ]
        .filter(Boolean)
        .join('\n')}
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
  const emptyHint = t(
    'Select anything unclear in the paper and a menu with questions appears. {S} cuts out a formula, figure or table as a screenshot.',
    'Выдели в статье непонятное место — появится меню с вопросами. {S} вырезает формулу, рисунок или таблицу скриншотом.',
    '在论文中选中看不懂的地方，就会弹出提问菜单。按 {S} 可截取公式、图片或表格。',
  ).split('{S}');

  return (
    <aside className="chat">
      <div className="chat-head">
        <div className="chat-tabs">
          <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
            Claude
          </button>
          <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>
            {t('Notes', 'Конспект', '笔记')}
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
                    <Terminal size={15} /> {t('Copy command for Terminal', 'Скопировать команду для терминала', '复制终端命令')}
                  </button>
                  <a className="menu-link" href={`/api/papers/${paper.id}/export`} onClick={() => setMenu(false)}>
                    <Download size={15} /> {t('Export highlights, notes and chat (.md)', 'Экспорт: выделения, конспект и чат (.md)', '导出：高亮、笔记和对话（.md）')}
                  </a>
                  <button
                    onClick={() => {
                      setMenu(false);
                      if (
                        confirm(
                          t(
                            'Start a new Claude session for this paper? The current chat will be archived.',
                            'Начать новую сессию Claude для этой статьи? Текущий чат уйдёт в архив.',
                            '要为这篇论文开始新的 Claude 会话吗？当前对话将被归档。',
                          ),
                        )
                      )
                        chat.reset();
                    }}
                  >
                    <RotateCcw size={15} /> {t('New session', 'Новая сессия', '新会话')}
                  </button>
                  {chat.session?.sessionId && <div className="menu-note">session: {chat.session.sessionId}</div>}
                </div>
              </>
            )}
          </div>
          <button className="icon-btn ghost" title={t('Hide chat', 'Скрыть чат', '隐藏对话')} onClick={onClose}>
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
              <p>
                {t(
                  'No notes yet. Claude will put them together in notes.md from the paper and your questions.',
                  'Конспекта пока нет. Claude соберёт его из статьи и твоих вопросов в notes.md.',
                  '还没有笔记。Claude 会根据论文和你的提问整理到 notes.md 中。',
                )}
              </p>
            </div>
          )}
          <button
            className="btn primary block"
            disabled={busy}
            onClick={() => {
              setTab('chat');
              submit(notesPrompt());
            }}
          >
            <NotebookPen size={16} /> {notes ? t('Update notes', 'Обновить конспект', '更新笔记') : t('Write notes', 'Собрать конспект', '生成笔记')}
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
                {emptyHint[0]}
                <kbd>S</kbd>
                {emptyHint[1]}
              </p>
              <div className="starters">
                <div className="starters-label">{t('Or start with', 'Или начни с', '或者从这里开始')}</div>
                {starters().map((s) => (
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
          {!!chat.session?.queued && <div className="sys-msg">{t(`queued: ${chat.session.queued}`, `в очереди: ${chat.session.queued}`, `排队中：${chat.session.queued}`)}</div>}
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
                    <span>
                      {a.kind === 'image'
                        ? t('Screenshot', 'Скриншот', '截图') + (a.page ? ` · ${pageRef(a.page)}` : '')
                        : a.kind === 'paper'
                          ? t(`Paper: ${a.text}`, `Статья: ${a.text}`, `论文：${a.text}`)
                          : a.text}
                    </span>
                    <button className="icon-btn ghost tiny" onClick={() => onRemoveAttachment(i)}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="quick">
                {fragmentActions().map((q) => (
                  <button key={q.id} className="chip" onClick={() => submit(q.prompt)}>
                    {q.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="input-row">
            <button className="icon-btn ghost attach-btn" title={t(
                'Attach another paper from your library — Claude will read it to answer',
                'Прикрепить другую статью из библиотеки — Claude прочитает её для ответа',
                '从论文库附加另一篇论文——Claude 会读完它再回答',
              )} onClick={() => setPicking(true)}>
              <Paperclip size={17} />
            </button>
            <textarea
              ref={inputRef}
              value={text}
              rows={1}
              placeholder={
                attachments.length
                  ? t("What's unclear in this passage?", 'Что непонятно в этом фрагменте?', '这段内容哪里没看懂？')
                  : t('Ask about the paper…  (/ to focus)', 'Спроси про статью…  (/ — фокус)', '就这篇论文提问…  （按 / 聚焦）')
              }
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
              <button className="send stop" title={t('Stop', 'Остановить', '停止')} onClick={chat.interrupt}>
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button className="send" title={t('Send (Enter)', 'Отправить (Enter)', '发送（Enter）')} disabled={!text.trim() && !attachments.length} onClick={() => submit()}>
                <ArrowUp size={16} />
              </button>
            )}
          </div>
          <div className="composer-hint">
            {t(
              'Enter to send · ⌘V to paste an image · paper clip to add another paper',
              'Enter — отправить · ⌘V — картинка · скрепка — добавить другую статью',
              'Enter 发送 · ⌘V 粘贴图片 · 回形针添加其他论文',
            )}
          </div>
        </div>
      )}
      {picking && (
        <QuickSwitcher
          title={t('Which paper to attach to your question?', 'Какую статью прикрепить к вопросу?', '要附加哪篇论文到你的问题中？')}
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
