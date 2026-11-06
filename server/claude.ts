import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_BIN, DATA_DIR, SESSION_CWD, activeSkills, getConfig } from './config.ts';
import { appendChat, getChat, getPaper, newId, paperDir, saveChat, updatePaper } from './library.ts';
import type { Attachment, ChatEvent, ChatMessage, GlobalEvent, PaperMeta, SessionInfo, SessionStatus, ToolUse } from '../shared/types.ts';

const IDLE_MS = 30 * 60 * 1000;
const INTERRUPT_GRACE_MS = 4000;
/** Each live session is a CLI process; idle ones beyond this are put to sleep (they resume on demand). */
const MAX_LIVE = Number(process.env.PAPER_READER_MAX_SESSIONS || 4);

/** Status changes of all sessions, for tabs and the library. */
export const bus = new EventEmitter();
bus.setMaxListeners(100);
const broadcast = (e: GlobalEvent) => bus.emit('event', e);

/** Sites Claude may open without asking: paper hosts and reference sources, so web content cannot exfiltrate data elsewhere. */
const WEB_DOMAINS = [
  'arxiv.org', 'www.arxiv.org', 'export.arxiv.org', 'alphaxiv.org', 'openreview.net', 'aclanthology.org',
  'semanticscholar.org', 'api.semanticscholar.org', 'www.semanticscholar.org', 'paperswithcode.com',
  'en.wikipedia.org', 'ru.wikipedia.org', 'github.com', 'raw.githubusercontent.com', 'huggingface.co',
  'scholar.google.com', 'doi.org', 'biorxiv.org', 'www.biorxiv.org', 'medrxiv.org', 'www.medrxiv.org',
  'ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov', 'distill.pub', 'proceedings.mlr.press', 'papers.nips.cc',
  'proceedings.neurips.cc', 'openaccess.thecvf.com', 'dl.acm.org', 'ieeexplore.ieee.org', 'nature.com', 'www.nature.com',
  'science.org', 'www.science.org', 'mathworld.wolfram.com', 'stackexchange.com', 'math.stackexchange.com', 'stats.stackexchange.com',
];

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

interface Pending {
  kind: 'user' | 'skill';
  skill?: string;
  content: ContentBlock[];
}

interface Turn extends Pending {
  committed: string;
  current: string;
  tools: ToolUse[];
  interrupted: boolean;
}

function relPath(abs: string) {
  const rel = path.relative(SESSION_CWD, abs);
  return rel.startsWith('..') ? abs : rel || '.';
}

/** Data kept outside the session folder (PAPER_READER_DATA) has to be added explicitly. */
const DATA_OUTSIDE = path.relative(SESSION_CWD, DATA_DIR).startsWith('..');

/** Permission rule path: ./relative inside the session folder, //absolute outside it. */
function rulePath(abs: string) {
  const rel = path.relative(SESSION_CWD, abs);
  return rel.startsWith('..') ? `/${abs}` : `./${rel}`;
}

function systemPrompt(meta: PaperMeta, language: string): string {
  const dir = relPath(paperDir(meta.id));
  const pdf = meta.kind === 'pdf';
  return [
    'Ты работаешь внутри приложения Paper Reader — читалки научных статей. Эта сессия привязана к одной статье: пользователь задаёт вопросы прямо во время чтения.',
    '',
    `Статья: «${meta.title}»${meta.authors ? `, ${meta.authors}` : ''}${meta.pages ? `, ${meta.pages} стр.` : ''}.`,
    'Файлы статьи (пути от текущей папки):',
    pdf
      ? `- ${dir}/paper.md — полный извлечённый текст, разбит по страницам заголовками «## [стр. N]». Начинай с него: Grep по ключевым словам, Read нужных кусков.`
      : `- ${dir}/paper.md — полный текст статьи. Начинай с него: Grep по ключевым словам, Read нужных кусков.`,
    pdf
      ? `- ${dir}/paper.pdf — оригинал. Если нужно увидеть рисунок, таблицу или формулу, которых нет в тексте, — Read этого файла с параметром pages.`
      : `- ${dir}/article.html — оригинальная разметка статьи.`,
    `- ${dir}/snippets/ — скриншоты, которые пользователь вырезал из статьи (они же приходят в сообщениях картинками).`,
    `- ${dir}/notes.md — конспект пользователя. Создавай и дополняй его только когда пользователь просит конспект или заметку.`,
    '',
    'Как приходят вопросы: пользователь выделяет текст или вырезает область скриншотом. Сообщение содержит блоки «Фрагмент · стр. N» с цитатой и/или изображения. Отвечай именно про этот фрагмент, но в контексте всей статьи: при необходимости загляни в paper.md, чтобы понять, откуда взялись обозначения.',
    '',
    'Как отвечать:',
    `- Язык ответа: ${language} (если пользователь пишет на другом языке — отвечай на его языке). Английский термин давай в скобках при первом упоминании.`,
    '- Пользователь не специалист в теме статьи. Сначала интуиция и простая аналогия, потом точный смысл. Расшифровывай каждое обозначение в формуле.',
    '- Формулы — только LaTeX: $...$ внутри строки, $$...$$ отдельным блоком.',
    pdf
      ? '- Ссылаясь на место в статье, ставь ссылку вида [стр. 5](#page=5): в интерфейсе она кликабельна и прокручивает статью к этой странице.'
      : '- Ссылаясь на место в статье, цитируй короткий кусок текста, чтобы его было легко найти.',
    '- Схемы рисуй блоком ```mermaid, если это помогает понять устройство метода.',
    `- Не редактируй никакие файлы, кроме ${dir}/notes.md. Код приложения Paper Reader в этой сессии не трогай.`,
  ].join('\n');
}

function shortPath(p: string) {
  const parts = p.split('/');
  // Files of the paper itself read best as just "paper.md" or "snippets/x.png".
  return parts[parts.length - 2] === 'snippets' ? parts.slice(-2).join('/') : parts[parts.length - 1];
}

function summarizeTool(name: string, input: any): string {
  const i = input || {};
  switch (name) {
    case 'Read': {
      const file = shortPath(String(i.file_path || ''));
      if (i.pages) return `Смотрит ${file}, стр. ${i.pages}`;
      return `Читает ${file}${i.offset ? ` (с строки ${i.offset})` : ''}`;
    }
    case 'Grep': {
      // Regexes read badly: show the words Claude is looking for.
      const words = String(i.pattern || '')
        .replace(/\\[a-z]/gi, ' ')
        .replace(/[\^$.*+?()[\]{}|\\]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1)
        .slice(0, 4)
        .join(', ');
      return words ? `Ищет в тексте: ${words}` : 'Ищет в тексте';
    }
    case 'Glob':
      return `Ищет файлы ${i.pattern}`;
    case 'WebSearch':
      return `Ищет в интернете: ${i.query}`;
    case 'WebFetch':
      return `Открывает ${String(i.url || '').replace(/^https?:\/\//, '').slice(0, 60)}`;
    case 'Write':
    case 'Edit':
      return `Обновляет ${shortPath(String(i.file_path || ''))}`;
    case 'Skill':
      return `Скилл ${i.skill || i.command || ''}`.trim();
    case 'Task':
    case 'Agent':
      return `Подагент: ${i.description || ''}`.trim();
    default:
      return name.replace(/^mcp__/, '').replace(/__/g, ' · ');
  }
}

function attachmentsToContent(text: string, attachments: Attachment[], imageFiles: string[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const lines: string[] = [];
  let imgN = 0;
  attachments.forEach((a, idx) => {
    const where = a.page ? ` · стр. ${a.page}` : '';
    if (a.kind === 'paper' && a.paperId) {
      const other = getPaper(a.paperId);
      if (!other) return;
      lines.push(
        `[Связанная статья: «${other.title}». Полный текст: ${relPath(path.join(paperDir(other.id), 'paper.md'))}${other.kind === 'pdf' ? `, оригинал: ${relPath(path.join(paperDir(other.id), 'paper.pdf'))}` : ''}. Прочитай из неё то, что нужно для ответа.]`,
        '',
      );
    } else if (a.kind === 'text' && a.text) {
      lines.push(`[Фрагмент ${idx + 1}${where}]`, a.text.split('\n').map((l) => `> ${l}`).join('\n'), '');
    } else if (a.kind === 'image' && a.image?.startsWith('data:')) {
      const m = a.image.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
      if (!m) return;
      blocks.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
      const file = imageFiles[imgN++];
      lines.push(`[Скриншот ${idx + 1}${where} — прикреплён изображением${file ? `, файл ${relPath(file)}` : ''}]`);
      if (a.text) lines.push(`Текст в этой области (извлечён из PDF, может быть неточным): ${a.text}`);
      lines.push('');
    }
  });
  const question = text.trim();
  const body = lines.length ? `${lines.join('\n')}\n${question ? `Вопрос: ${question}` : ''}` : question;
  blocks.push({ type: 'text', text: body.trim() || 'Объясни этот фрагмент.' });
  return blocks;
}

class PaperSession {
  readonly paperId: string;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private status: SessionStatus = 'offline';
  private listeners = new Set<(e: ChatEvent) => void>();
  private queue: Pending[] = [];
  private turn: Turn | null = null;
  private stderrBuf = '';
  private sawInit = false;
  private disposed = false;
  private resuming = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private interruptTimer: NodeJS.Timeout | null = null;
  private partialTimer: NodeJS.Timeout | null = null;
  private model?: string;

  constructor(paperId: string) {
    this.paperId = paperId;
  }

  private meta(): PaperMeta {
    const meta = getPaper(this.paperId);
    if (!meta) throw new Error('paper not found');
    return meta;
  }

  info(): SessionInfo {
    const meta = getPaper(this.paperId);
    const skills = activeSkills();
    return {
      status: this.status,
      sessionId: meta?.sessionId,
      model: this.model,
      skills,
      skillsActive: skills.every((s) => meta?.activatedSkills?.includes(s)),
      resumeCommand: meta?.sessionStarted ? `cd ${JSON.stringify(SESSION_CWD)} && claude --resume ${meta.sessionId}` : undefined,
      queued: this.queue.filter((q) => q.kind === 'user').length,
      warming: this.turn?.kind === 'skill',
    };
  }

  subscribe(fn: (e: ChatEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: ChatEvent) {
    for (const fn of this.listeners) fn(e);
  }

  private setStatus(s: SessionStatus) {
    const changed = this.status !== s;
    this.status = s;
    this.emit({ type: 'status', session: this.info() });
    if (changed) broadcast({ type: 'status', paperId: this.paperId, status: s });
  }

  getStatus() {
    return this.status;
  }

  isLive() {
    return !!this.proc;
  }

  lastActive = 0;

  private touch() {
    this.lastActive = Date.now();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.turn && !this.queue.length) this.stop();
    }, IDLE_MS);
  }

  /** Start the CLI process (and queue default skills for a brand new session). */
  start() {
    if (this.proc) return;
    let meta = this.meta();
    const cfg = getConfig();
    if (!meta.sessionId) meta = updatePaper(meta.id, { sessionId: crypto.randomUUID(), sessionStarted: false, activatedSkills: [] })!;

    makeRoom(this);
    this.ensureSkills(meta);

    this.resuming = !!meta.sessionStarted;
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      ...(this.resuming ? ['--resume', meta.sessionId!] : ['--session-id', meta.sessionId!, '-n', `📄 ${meta.title.slice(0, 70)}`]),
      '--append-system-prompt', systemPrompt(meta, cfg.language),
      '--tools', 'Read,Grep,Glob,WebSearch,WebFetch,Write,Edit,Skill,ToolSearch',
      // Reads inside the product folder need no rule; anything outside it is refused,
      // so a prompt injection in a paper cannot reach the reader's files.
      '--allowedTools', 'WebSearch', 'Skill', 'ToolSearch',
      ...WEB_DOMAINS.map((d) => `WebFetch(domain:${d})`),
      `Write(${rulePath(path.join(paperDir(meta.id), 'notes.md'))})`,
      `Edit(${rulePath(path.join(paperDir(meta.id), 'notes.md'))})`,
      ...(DATA_OUTSIDE ? ['--add-dir', DATA_DIR] : []),
      '--permission-prompts', 'none',
      ...(cfg.model ? ['--model', cfg.model] : []),
      ...(cfg.effort ? ['--effort', cfg.effort] : []),
    ];

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    this.sawInit = false;
    this.stderrBuf = '';
    const proc = spawn(CLAUDE_BIN, args, { cwd: SESSION_CWD, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.setStatus('starting');

    // Buffers belong to this process: output of an old process never leaks into a new one.
    let stdoutBuf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk;
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line || this.proc !== proc || this.disposed) continue;
        try {
          this.handle(JSON.parse(line));
        } catch (e) {
          console.warn(`[claude ${this.paperId}] bad line`, line.slice(0, 200), e);
        }
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      if (this.proc === proc) this.stderrBuf = (this.stderrBuf + chunk).slice(-4000);
    });
    proc.on('error', (err) => {
      if (this.proc === proc) this.stderrBuf += `\n${err.message}`;
    });
    // 'close' fires after stdout is drained, so a final result line is never lost.
    proc.on('close', (code) => this.onExit(proc, code));
    proc.stdin.on('error', () => {});

    this.setStatus('ready');
    this.touch();
    this.pump();
  }

  private onExit(proc: ChildProcessWithoutNullStreams, code: number | null) {
    if (this.proc !== proc || this.disposed) return;
    this.proc = null;
    if (this.interruptTimer) clearTimeout(this.interruptTimer);
    const stderr = this.stderrBuf.trim();

    // The stored session vanished (e.g. ~/.claude was cleaned): start over with a fresh one.
    if (this.resuming && !this.sawInit && /no conversation found/i.test(stderr)) {
      const turn = this.turn;
      this.turn = null;
      if (turn) this.queue.unshift({ kind: turn.kind, skill: turn.skill, content: turn.content });
      updatePaper(this.paperId, { sessionId: crypto.randomUUID(), sessionStarted: false, activatedSkills: [] });
      this.queue = this.queue.filter((q) => q.kind !== 'skill');
      this.addSystem('Прежняя сессия Claude не найдена — начата новая.');
      this.start();
      return;
    }

    if (this.turn) {
      const interrupted = this.turn.interrupted;
      this.finishTurn(interrupted ? undefined : explainFailure(stderr, code));
    }
    if (code && code !== 0 && !this.sawInit && this.queue.length) {
      const err = explainFailure(stderr, code);
      this.queue = [];
      this.addSystem(err, true);
    }
    this.setStatus('offline');
    if (this.queue.length) this.start();
  }

  /** Let the process go; the next question resumes the same Claude session in a new one. */
  stop() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    if (this.turn) this.finishTurn(undefined, true);
    proc.stdin.end();
    setTimeout(() => proc.exitCode === null && proc.kill('SIGTERM'), 1500);
    this.setStatus('offline');
  }

  /** The paper is being deleted: stop everything and never touch its files again. */
  dispose() {
    this.disposed = true;
    this.queue = [];
    this.turn = null;
    for (const t of [this.idleTimer, this.interruptTimer, this.partialTimer]) if (t) clearTimeout(t);
    const proc = this.proc;
    this.proc = null;
    proc?.kill('SIGTERM');
    this.listeners.clear();
  }

  /** Queue the start-up slash commands this session has not run yet. */
  private ensureSkills(meta: PaperMeta) {
    const pending = activeSkills().filter(
      (s) => !meta.activatedSkills?.includes(s) && !this.queue.some((q) => q.skill === s) && this.turn?.skill !== s,
    );
    this.queue.unshift(...pending.map((s): Pending => ({ kind: 'skill', skill: s, content: [{ type: 'text', text: s }] })));
  }

  private write(obj: unknown) {
    this.proc?.stdin.write(JSON.stringify(obj) + '\n');
  }

  private pump() {
    if (!this.proc || this.turn || !this.queue.length) return;
    const next = this.queue.shift()!;
    this.turn = { ...next, committed: '', current: '', tools: [], interrupted: false };
    this.write({ type: 'user', message: { role: 'user', content: next.content } });
    this.setStatus('busy');
  }

  send(text: string, attachments: Attachment[]): ChatMessage {
    const meta = this.meta();
    const dir = paperDir(meta.id);
    const msgId = newId('m');
    const imageFiles: string[] = [];
    const stored: Attachment[] = attachments.map((a, i) => {
      if (a.kind !== 'image' || !a.image?.startsWith('data:')) return a;
      const m = a.image.match(/^data:image\/([a-z+]+);base64,(.+)$/);
      if (!m) return a;
      fs.mkdirSync(path.join(dir, 'snippets'), { recursive: true });
      const name = `${msgId}-${i + 1}.${m[1] === 'jpeg' ? 'jpg' : m[1].replace('+xml', '')}`;
      const file = path.join(dir, 'snippets', name);
      fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
      imageFiles.push(file);
      return { ...a, image: `snippets/${name}` };
    });

    const message: ChatMessage = { id: msgId, role: 'user', text, attachments: stored, createdAt: new Date().toISOString() };
    appendChat(meta.id, message);
    this.emit({ type: 'message', message });

    this.queue.push({ kind: 'user', content: attachmentsToContent(text, attachments, imageFiles) });
    if (this.proc) this.ensureSkills(meta);
    if (!this.proc) this.start();
    else {
      this.pump();
      this.emit({ type: 'status', session: this.info() });
    }
    this.touch();
    return message;
  }

  /** Ask again: re-send the question that produced a failed answer. */
  retry(answerId: string): boolean {
    const chat = getChat(this.paperId);
    const at = chat.findIndex((m) => m.id === answerId);
    if (at < 0 || this.turn) return false;
    const question = chat.slice(0, at).reverse().find((m) => m.role === 'user');
    if (!question) return false;
    saveChat(this.paperId, chat.filter((m) => m.id !== answerId));
    this.emit({ type: 'removed', id: answerId });
    const dir = paperDir(this.paperId);
    const attachments = (question.attachments || []).map((a) => {
      if (a.kind !== 'image' || !a.image || a.image.startsWith('data:')) return a;
      const file = path.join(dir, a.image);
      if (!file.startsWith(dir) || !fs.existsSync(file)) return a;
      const ext = path.extname(file).slice(1).replace('jpg', 'jpeg').replace('svg', 'svg+xml');
      return { ...a, image: `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}` };
    });
    const files = (question.attachments || []).filter((a) => a.kind === 'image' && a.image).map((a) => path.join(dir, a.image!));
    this.queue.push({ kind: 'user', content: attachmentsToContent(question.text, attachments, files) });
    if (!this.proc) this.start();
    else this.pump();
    return true;
  }

  interrupt() {
    const dropped = this.queue.filter((q) => q.kind === 'user').length;
    this.queue = this.queue.filter((q) => q.kind === 'skill');
    if (dropped) this.addSystem(`Остановлено. Вопросы в очереди отменены: ${dropped}`);
    if (!this.turn || !this.proc) {
      this.emit({ type: 'status', session: this.info() });
      return;
    }
    this.turn.interrupted = true;
    this.write({ type: 'control_request', request_id: newId('r'), request: { subtype: 'interrupt' } });
    const proc = this.proc;
    this.interruptTimer = setTimeout(() => {
      if (this.proc === proc && this.turn?.interrupted) proc.kill('SIGTERM');
    }, INTERRUPT_GRACE_MS);
  }

  /** Forget the Claude session and chat for this paper and start clean. */
  reset() {
    const proc = this.proc;
    this.proc = null;
    this.turn = null;
    this.queue = [];
    proc?.kill('SIGTERM');
    const meta = this.meta();
    const chat = getChat(meta.id);
    if (chat.length) {
      const dir = paperDir(meta.id);
      fs.writeFileSync(path.join(dir, `chat-${Date.now()}-${meta.sessionId?.slice(0, 8)}.json`), JSON.stringify(chat, null, 2));
    }
    saveChat(meta.id, []);
    updatePaper(meta.id, { sessionId: crypto.randomUUID(), sessionStarted: false, activatedSkills: [] });
    this.status = 'offline';
    this.emit({ type: 'reset' });
    this.start();
  }

  private addSystem(text: string, isError = false) {
    const message: ChatMessage = {
      id: newId('s'),
      role: 'system',
      text,
      error: isError ? text : undefined,
      createdAt: new Date().toISOString(),
    };
    appendChat(this.paperId, message);
    this.emit({ type: 'message', message });
  }

  private partialText(): string {
    const t = this.turn!;
    return [t.committed, t.current].filter(Boolean).join('\n\n');
  }

  private schedulePartial() {
    if (this.partialTimer || !this.turn || this.turn.kind !== 'user') return;
    this.partialTimer = setTimeout(() => {
      this.partialTimer = null;
      if (this.turn) this.emit({ type: 'partial', text: this.partialText(), tools: this.turn.tools });
    }, 40);
  }

  private handle(ev: any) {
    if (ev.parent_tool_use_id) return; // subagent chatter
    const turn = this.turn;
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') {
          this.sawInit = true;
          this.model = ev.model;
          const meta = getPaper(this.paperId);
          if (meta && !meta.sessionStarted) updatePaper(this.paperId, { sessionStarted: true });
          this.emit({ type: 'status', session: this.info() });
        }
        return;
      case 'stream_event': {
        if (!turn) return;
        const e = ev.event;
        if (e.type === 'content_block_start' && e.content_block?.type === 'text') turn.current = '';
        else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          turn.current += e.delta.text;
          this.schedulePartial();
        }
        return;
      }
      case 'assistant': {
        if (!turn) return;
        for (const block of ev.message?.content || []) {
          if (block.type === 'text' && block.text) {
            turn.committed = [turn.committed, block.text].filter(Boolean).join('\n\n');
            turn.current = '';
          } else if (block.type === 'tool_use') {
            turn.tools.push({ id: block.id, name: block.name, summary: summarizeTool(block.name, block.input), status: 'running' });
          }
        }
        this.schedulePartial();
        return;
      }
      case 'user': {
        if (!turn) return;
        const content = ev.message?.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const tool = turn.tools.find((t) => t.id === block.tool_use_id);
          if (tool) tool.status = block.is_error ? 'error' : 'done';
        }
        this.schedulePartial();
        return;
      }
      case 'result': {
        if (!turn) return;
        if (!this.partialText() && typeof ev.result === 'string') turn.committed = ev.result;
        const failed = ev.is_error && !turn.interrupted;
        this.finishTurn(failed ? (typeof ev.result === 'string' && ev.result) || ev.subtype || 'Claude вернул ошибку' : undefined);
        return;
      }
    }
  }

  private finishTurn(error?: string, cutShort = false) {
    const turn = this.turn;
    if (!turn) return;
    if (cutShort) turn.interrupted = true;
    const text = this.partialText();
    this.turn = null;
    if (this.partialTimer) {
      clearTimeout(this.partialTimer);
      this.partialTimer = null;
    }
    if (this.interruptTimer) clearTimeout(this.interruptTimer);

    if (turn.kind === 'skill') {
      // An interrupted skill never ran: leave it pending so it is sent again next time.
      if (turn.interrupted) {
        // nothing to record
      } else if (!error) {
        const meta = this.meta();
        updatePaper(meta.id, { activatedSkills: [...new Set([...(meta.activatedSkills || []), turn.skill!])] });
        this.addSystem(`Скилл ${turn.skill} включён для этой статьи`);
      } else this.addSystem(`Не удалось включить ${turn.skill}: ${error}`, true);
    } else {
      for (const t of turn.tools) if (t.status === 'running') t.status = turn.interrupted ? 'error' : 'done';
      const message: ChatMessage = {
        id: newId('a'),
        role: 'assistant',
        text,
        tools: turn.tools,
        error,
        interrupted: turn.interrupted || undefined,
        createdAt: new Date().toISOString(),
      };
      appendChat(this.paperId, message);
      this.emit({ type: 'message', message });
      broadcast({ type: 'answer', paperId: this.paperId });
    }
    this.setStatus(this.proc ? 'ready' : 'offline');
    this.touch();
    this.pump();
  }

  isBusy() {
    return !!this.turn;
  }
}

function explainFailure(stderr: string, code: number | null): string {
  if (/ENOENT|command not found/i.test(stderr)) return `Не найден Claude CLI (${CLAUDE_BIN}). Установи Claude Code или укажи путь в CLAUDE_BIN.`;
  if (/log ?in|auth|credential|unauthorized|401/i.test(stderr)) return 'Claude CLI не авторизован. Запусти `claude` в терминале и выполни /login.';
  const tail = stderr.split('\n').filter(Boolean).slice(-3).join(' ');
  return `Claude завершился${code !== null ? ` с кодом ${code}` : ''}${tail ? `: ${tail}` : ''}`;
}

const sessions = new Map<string, PaperSession>();

/** Keep at most MAX_LIVE CLI processes: put the least recently used idle ones to sleep. */
function makeRoom(starting: PaperSession) {
  const idle = [...sessions.values()]
    .filter((s) => s !== starting && s.isLive() && !s.isBusy())
    .sort((a, b) => a.lastActive - b.lastActive);
  let live = [...sessions.values()].filter((s) => s.isLive()).length;
  for (const s of idle) {
    if (live < MAX_LIVE) break;
    s.stop();
    live--;
  }
}

export function allStatuses(): Record<string, SessionStatus> {
  return Object.fromEntries([...sessions.entries()].map(([id, s]) => [id, s.getStatus()]));
}

export function getSession(paperId: string): PaperSession {
  let s = sessions.get(paperId);
  if (!s) {
    s = new PaperSession(paperId);
    sessions.set(paperId, s);
  }
  return s;
}

export function dropSession(paperId: string) {
  sessions.get(paperId)?.dispose();
  sessions.delete(paperId);
}

export function stopIdle() {
  for (const s of sessions.values()) if (!s.isBusy()) s.stop();
}

export function stopAll() {
  for (const s of sessions.values()) s.stop();
}

