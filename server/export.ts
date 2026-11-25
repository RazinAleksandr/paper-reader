import fs from 'node:fs';
import path from 'node:path';
import { tr, uiLang } from './config.ts';
import { getChat, getHighlights, paperDir } from './library.ts';
import { pageLabel } from '../shared/i18n.ts';
import type { PaperMeta } from '../shared/types.ts';

const quote = (s: string) => s.split('\n').map((l) => `> ${l}`).join('\n');

/** Everything the reader produced for a paper — highlights, notes, Q&A — as one Markdown file. */
export function exportMarkdown(meta: PaperMeta): string {
  const page = (n: number) => pageLabel(uiLang(), n);
  const out: string[] = [`# ${meta.title}`, ''];
  if (meta.authors) out.push(`_${meta.authors}_`, '');
  if (meta.source.url) out.push(tr(`Source: ${meta.source.url}`, `Источник: ${meta.source.url}`, `来源：${meta.source.url}`), '');

  const highlights = getHighlights(meta.id).sort((a, b) => (a.page || 0) - (b.page || 0) || (a.rects?.[0]?.y || 0) - (b.rects?.[0]?.y || 0));
  if (highlights.length) {
    out.push(tr('## Highlights', '## Выделения', '## 标注'), '');
    for (const h of highlights) {
      out.push(quote(h.text || tr('(area)', '(область)', '(区域)')) + (h.page ? `\n> — ${page(h.page)}` : ''), '');
      if (h.note) out.push(`${tr('**Note:**', '**Заметка:**', '**批注：**')} ${h.note}`, '');
    }
  }

  const notesFile = path.join(paperDir(meta.id), 'notes.md');
  if (fs.existsSync(notesFile)) out.push(tr('## Notes', '## Конспект', '## 笔记'), '', fs.readFileSync(notesFile, 'utf8').trim(), '');

  const chat = getChat(meta.id).filter((m) => m.role !== 'system');
  if (chat.length) {
    out.push(tr('## Questions and answers', '## Вопросы и ответы', '## 问答'), '');
    for (const m of chat) {
      if (m.role === 'user') {
        out.push('### ❓ ' + (m.text.trim().split('\n')[0] || tr('Question about a fragment', 'Вопрос по фрагменту', '关于片段的提问')), '');
        for (const a of m.attachments || []) {
          if (a.kind === 'text' && a.text) out.push(quote(a.text) + (a.page ? `\n> — ${page(a.page)}` : ''), '');
          if (a.kind === 'image') out.push(`_(${tr('screenshot', 'скриншот', '截图')}${a.page ? `, ${page(a.page)}` : ''})_`, '');
        }
        if (m.text.includes('\n')) out.push(m.text, '');
      } else {
        out.push(m.text.replace(/\]\(#page=\d+\)/g, ']'), '');
      }
    }
  }
  return out.join('\n');
}
