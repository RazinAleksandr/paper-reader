import fs from 'node:fs';
import path from 'node:path';
import { getChat, getHighlights, paperDir } from './library.ts';
import type { PaperMeta } from '../shared/types.ts';

const quote = (s: string) => s.split('\n').map((l) => `> ${l}`).join('\n');

/** Everything the reader produced for a paper — highlights, notes, Q&A — as one Markdown file. */
export function exportMarkdown(meta: PaperMeta): string {
  const out: string[] = [`# ${meta.title}`, ''];
  if (meta.authors) out.push(`_${meta.authors}_`, '');
  if (meta.source.url) out.push(`Источник: ${meta.source.url}`, '');

  const highlights = getHighlights(meta.id).sort((a, b) => (a.page || 0) - (b.page || 0) || (a.rects?.[0]?.y || 0) - (b.rects?.[0]?.y || 0));
  if (highlights.length) {
    out.push('## Выделения', '');
    for (const h of highlights) {
      out.push(quote(h.text || '(область)') + (h.page ? `\n> — стр. ${h.page}` : ''), '');
      if (h.note) out.push(`**Заметка:** ${h.note}`, '');
    }
  }

  const notesFile = path.join(paperDir(meta.id), 'notes.md');
  if (fs.existsSync(notesFile)) out.push('## Конспект', '', fs.readFileSync(notesFile, 'utf8').trim(), '');

  const chat = getChat(meta.id).filter((m) => m.role !== 'system');
  if (chat.length) {
    out.push('## Вопросы и ответы', '');
    for (const m of chat) {
      if (m.role === 'user') {
        out.push('### ❓ ' + (m.text.trim().split('\n')[0] || 'Вопрос по фрагменту'), '');
        for (const a of m.attachments || []) {
          if (a.kind === 'text' && a.text) out.push(quote(a.text) + (a.page ? `\n> — стр. ${a.page}` : ''), '');
          if (a.kind === 'image') out.push(`_(скриншот${a.page ? `, стр. ${a.page}` : ''})_`, '');
        }
        if (m.text.includes('\n')) out.push(m.text, '');
      } else {
        out.push(m.text.replace(/\]\(#page=\d+\)/g, ']'), '');
      }
    }
  }
  return out.join('\n');
}
