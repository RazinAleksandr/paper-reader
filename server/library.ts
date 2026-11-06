import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PAPERS_DIR } from './config.ts';
import type { ChatMessage, Highlight, PaperMeta } from '../shared/types.ts';

export function newId(prefix = ''): string {
  return prefix + crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x');
}

export function slugify(s: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
    л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
    ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return (
    s
      .toLowerCase()
      .split('')
      .map((c) => map[c] ?? c)
      .join('')
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'paper'
  );
}

export function paperDir(id: string): string {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('bad paper id');
  return path.join(PAPERS_DIR, id);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function listPapers(): PaperMeta[] {
  if (!fs.existsSync(PAPERS_DIR)) return [];
  return fs
    .readdirSync(PAPERS_DIR)
    .map((id) => getPaper(id))
    .filter((p): p is PaperMeta => !!p)
    .sort((a, b) => (b.openedAt || b.createdAt).localeCompare(a.openedAt || a.createdAt));
}

export function getPaper(id: string): PaperMeta | null {
  try {
    const file = path.join(paperDir(id), 'meta.json');
    if (!fs.existsSync(file)) return null;
    return readJson<PaperMeta | null>(file, null);
  } catch {
    return null;
  }
}

export function savePaper(meta: PaperMeta) {
  fs.mkdirSync(paperDir(meta.id), { recursive: true });
  writeJson(path.join(paperDir(meta.id), 'meta.json'), meta);
}

export function updatePaper(id: string, patch: Partial<PaperMeta>): PaperMeta | null {
  const meta = getPaper(id);
  if (!meta) return null;
  if (!fs.existsSync(paperDir(id))) return meta;
  const next = { ...meta, ...patch, id: meta.id };
  savePaper(next);
  return next;
}

export function deletePaper(id: string) {
  fs.rmSync(paperDir(id), { recursive: true, force: true });
}

export function getHighlights(id: string): Highlight[] {
  return readJson<Highlight[]>(path.join(paperDir(id), 'highlights.json'), []);
}

export function saveHighlights(id: string, list: Highlight[]) {
  writeJson(path.join(paperDir(id), 'highlights.json'), list);
}

export function getChat(id: string): ChatMessage[] {
  return readJson<ChatMessage[]>(path.join(paperDir(id), 'chat.json'), []);
}

export function saveChat(id: string, list: ChatMessage[]) {
  if (!fs.existsSync(paperDir(id))) return;
  writeJson(path.join(paperDir(id), 'chat.json'), list);
  updatePaper(id, { messageCount: list.filter((m) => m.role === 'user').length });
}

export function appendChat(id: string, msg: ChatMessage) {
  if (!fs.existsSync(paperDir(id))) return; // paper was deleted meanwhile
  const list = getChat(id);
  list.push(msg);
  saveChat(id, list);
}
