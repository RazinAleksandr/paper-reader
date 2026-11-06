import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { CLAUDE_BIN, PORT, ROOT, getConfig, saveConfig, skillAvailable } from './config.ts';
import {
  deletePaper,
  getChat,
  getHighlights,
  getPaper,
  listPapers,
  newId,
  paperDir,
  saveHighlights,
  updatePaper,
} from './library.ts';
import { ImportError, importFile, importUrl } from './importers.ts';
import { allStatuses, bus, dropSession, getSession, stopAll, stopIdle } from './claude.ts';
import { exportMarkdown } from './export.ts';
import { extractPdf } from './pdftext.ts';
import type { Attachment, GlobalEvent, Health, Highlight, PaperMeta } from '../shared/types.ts';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
app.use(express.json({ limit: '40mb' }));

// Only this machine's browser tabs may talk to the API: reject other sites (CSRF) and rebinding hosts.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!LOCAL_HOST.test(req.headers.host || '')) return res.status(403).json({ error: 'forbidden host' });
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return res.status(403).json({ error: 'forbidden origin' });
  next();
});

type Handler = (req: Request, res: Response) => unknown;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

function paperOr404(req: Request, res: Response): PaperMeta | null {
  const meta = getPaper(String(req.params.id));
  if (!meta) res.status(404).json({ error: 'Статья не найдена' });
  return meta;
}

// pdf.js assets for the browser viewer (CJK cmaps, standard fonts, image decoders)
const pdfjsRoot = path.join(ROOT, 'node_modules', 'pdfjs-dist');
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  app.use(`/api/pdfjs/${dir}`, express.static(path.join(pdfjsRoot, dir), { maxAge: '7d' }));
}

let healthCache: { at: number; value: Health['claude'] } | null = null;
app.get('/api/health', (_req, res) => {
  const reply = (claude: Health['claude']) =>
    res.json({ claude, missingSkills: getConfig().skills.filter((s) => !skillAvailable(s)) } satisfies Health);
  if (healthCache && Date.now() - healthCache.at < 60_000) return reply(healthCache.value);
  execFile(CLAUDE_BIN, ['--version'], { timeout: 10_000 }, (err, stdout) => {
    const value = err
      ? { ok: false, error: (err as NodeJS.ErrnoException).code === 'ENOENT' ? `Не найден Claude CLI (${CLAUDE_BIN})` : err.message }
      : { ok: true, version: stdout.trim() };
    healthCache = { at: Date.now(), value };
    reply(value);
  });
});

/** Live status of every paper session: tabs show which papers are being answered. */
app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  for (const [paperId, status] of Object.entries(allStatuses())) res.write(`data: ${JSON.stringify({ type: 'status', paperId, status })}\n\n`);
  const send = (e: GlobalEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  bus.on('event', send);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    bus.off('event', send);
    clearInterval(ping);
  });
});

app.get('/api/config', (_req, res) => {
  res.json(getConfig());
});
app.put('/api/config', (req, res) => {
  const cfg = saveConfig(req.body || {});
  // Model and effort are launch flags: idle sessions restart with them on the next question.
  stopIdle();
  res.json(cfg);
});

app.get('/api/papers', (_req, res) => {
  res.json(listPapers());
});

app.post(
  '/api/papers/upload',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    res.json(await importFile(req.file.buffer, name));
  }),
);

app.post(
  '/api/papers/url',
  wrap(async (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (!url) return res.status(400).json({ error: 'Пустая ссылка' });
    res.json(await importUrl(url));
  }),
);

app.get('/api/papers/:id', (req, res) => {
  const meta = paperOr404(req, res);
  if (meta) res.json(meta);
});

app.patch('/api/papers/:id', (req, res) => {
  if (!paperOr404(req, res)) return;
  const { title, lastPage, progress, zoom, openedAt } = req.body || {};
  const patch: Partial<PaperMeta> = {};
  if (typeof title === 'string' && title.trim()) patch.title = title.trim();
  if (typeof lastPage === 'number') patch.lastPage = lastPage;
  if (typeof progress === 'number') patch.progress = Math.max(0, Math.min(1, progress));
  if (typeof zoom === 'number') patch.zoom = zoom;
  if (openedAt) patch.openedAt = new Date().toISOString();
  res.json(updatePaper(String(req.params.id), patch));
});

app.delete('/api/papers/:id', (req, res) => {
  if (!paperOr404(req, res)) return;
  dropSession(String(req.params.id));
  deletePaper(String(req.params.id));
  res.json({ ok: true });
});

// Paper files: paper.pdf, article.html, assets/*, snippets/*, notes.md
app.get('/api/papers/:id/files/*file', (req, res) => {
  const meta = paperOr404(req, res);
  if (!meta) return;
  const rel = ([] as string[]).concat(req.params.file as unknown as string[]).join('/');
  if (!/^(paper\.pdf|paper\.md|article\.html|notes\.md|(assets|snippets)\/[\w.-]+)$/.test(rel)) return res.status(404).end();
  const file = path.join(paperDir(meta.id), rel);
  // No notes yet is a normal state, not an error.
  if (!fs.existsSync(file)) return rel === 'notes.md' ? res.status(204).end() : res.status(404).end();
  res.setHeader('Cache-Control', rel.endsWith('.md') ? 'no-cache' : 'private, max-age=3600');
  // The path is whitelisted above; the data folder itself may live under a dot-directory.
  res.sendFile(file, { dotfiles: 'allow' });
});

/** Headings guessed from the text, for PDFs without bookmarks (computed once, then cached). */
app.get(
  '/api/papers/:id/outline',
  wrap(async (req, res) => {
    const meta = paperOr404(req, res);
    if (!meta) return;
    const file = path.join(paperDir(meta.id), 'outline.json');
    if (!fs.existsSync(file)) {
      const pdf = path.join(paperDir(meta.id), 'paper.pdf');
      if (!fs.existsSync(pdf)) return res.json([]);
      const info = await extractPdf(new Uint8Array(fs.readFileSync(pdf)));
      fs.writeFileSync(file, JSON.stringify(info.outline));
    }
    res.type('json').send(fs.readFileSync(file, 'utf8'));
  }),
);

app.get('/api/papers/:id/highlights', (req, res) => {
  if (paperOr404(req, res)) res.json(getHighlights(String(req.params.id)));
});

app.post('/api/papers/:id/highlights', (req, res) => {
  if (!paperOr404(req, res)) return;
  const id = String(req.params.id);
  const h: Highlight = { ...req.body, id: newId('h'), createdAt: new Date().toISOString() };
  saveHighlights(id, [...getHighlights(id), h]);
  res.json(h);
});

app.patch('/api/papers/:id/highlights/:hid', (req, res) => {
  if (!paperOr404(req, res)) return;
  const id = String(req.params.id);
  const list = getHighlights(id).map((h) => (h.id === req.params.hid ? { ...h, ...req.body, id: h.id } : h));
  saveHighlights(id, list);
  res.json(list.find((h) => h.id === req.params.hid));
});

app.delete('/api/papers/:id/highlights/:hid', (req, res) => {
  if (!paperOr404(req, res)) return;
  const id = String(req.params.id);
  saveHighlights(id, getHighlights(id).filter((h) => h.id !== req.params.hid));
  res.json({ ok: true });
});

app.get('/api/papers/:id/chat', (req, res) => {
  if (!paperOr404(req, res)) return;
  res.json({ messages: getChat(String(req.params.id)), session: getSession(String(req.params.id)).info() });
});

app.post('/api/papers/:id/chat', (req, res) => {
  if (!paperOr404(req, res)) return;
  const { text = '' } = req.body || {};
  const attachments: Attachment[] = (Array.isArray(req.body?.attachments) ? req.body.attachments : [])
    .filter((a: Attachment) => a && ['text', 'image', 'paper'].includes(a.kind))
    .map((a: Attachment) => ({
      kind: a.kind,
      text: typeof a.text === 'string' ? a.text.slice(0, 20000) : undefined,
      image: typeof a.image === 'string' ? a.image : undefined,
      page: Number.isFinite(a.page) ? a.page : undefined,
      rects: Array.isArray(a.rects) ? a.rects.slice(0, 50) : undefined,
      paperId: typeof a.paperId === 'string' && getPaper(a.paperId) ? a.paperId : undefined,
    }));
  if (!String(text).trim() && !attachments.length) return res.status(400).json({ error: 'Пустое сообщение' });
  res.json(getSession(String(req.params.id)).send(String(text), attachments));
});

app.post('/api/papers/:id/chat/retry', (req, res) => {
  if (!paperOr404(req, res)) return;
  const ok = getSession(String(req.params.id)).retry(String(req.body?.messageId || ''));
  res.status(ok ? 200 : 409).json({ ok });
});

app.get('/api/papers/:id/export', (req, res) => {
  const meta = paperOr404(req, res);
  if (!meta) return;
  const name = `${meta.id}.md`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(exportMarkdown(meta));
});

app.post('/api/papers/:id/chat/interrupt', (req, res) => {
  if (!paperOr404(req, res)) return;
  getSession(String(req.params.id)).interrupt();
  res.json({ ok: true });
});

app.post('/api/papers/:id/chat/reset', (req, res) => {
  if (!paperOr404(req, res)) return;
  getSession(String(req.params.id)).reset();
  res.json({ ok: true });
});

/** Warm the session up when the reader opens, so the first answer is fast. */
app.post('/api/papers/:id/session/start', (req, res) => {
  if (!paperOr404(req, res)) return;
  const s = getSession(String(req.params.id));
  s.start();
  res.json(s.info());
});

app.get('/api/papers/:id/events', (req, res) => {
  if (!paperOr404(req, res)) return;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const session = getSession(String(req.params.id));
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'status', session: session.info() });
  const off = session.subscribe(send);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    off();
    clearInterval(ping);
  });
});

// Built client
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (!(err instanceof ImportError)) console.error(err);
  res.status(err instanceof ImportError ? 422 : 500).json({ error: err.message || 'Ошибка сервера' });
});

// A failure in one paper's session must not take the whole reader down.
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Paper Reader API: http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stopAll();
    server.close();
    setTimeout(() => process.exit(0), 300);
  });
}
