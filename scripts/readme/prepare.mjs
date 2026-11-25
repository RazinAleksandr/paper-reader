// Copy a demo library into a fresh data folder for one interface language.
// Usage: node scripts/readme/prepare.mjs <demo-data> <out-dir> <en|ru|zh>
// Chats, highlights and Claude sessions are dropped, so every screenshot run asks Claude for real.
import fs from 'node:fs';
import path from 'node:path';

const [src, out, lang] = process.argv.slice(2);
if (!src || !out || !['en', 'ru', 'zh'].includes(lang)) {
  console.error('usage: prepare.mjs <demo-data> <out-dir> <en|ru|zh>');
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

const etAl = { en: ' et al.', ru: ' и др.', zh: ' 等' }[lang];
const papers = path.join(out, 'papers');
// Library order (most recently opened first) and how long ago each paper was opened, in minutes.
const ago = { attention: 1, bert: 2, 'the-illustrated': 23, 'language-models': 24, lora: 25 };

for (const id of fs.readdirSync(papers)) {
  const dir = path.join(papers, id);
  const metaFile = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaFile)) continue;
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  for (const k of ['sessionId', 'sessionStarted', 'activatedSkills', 'messageCount']) delete meta[k];
  if (meta.authors) meta.authors = meta.authors.replace(/ (и др\.|et al\.|等)$/, etAl);
  const key = Object.keys(ago).find((k) => id.startsWith(k));
  if (key) meta.openedAt = new Date(Date.now() - ago[key] * 60_000).toISOString();
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));

  for (const f of ['chat.json', 'highlights.json', 'notes.md']) fs.rmSync(path.join(dir, f), { force: true });
  fs.rmSync(path.join(dir, 'snippets'), { recursive: true, force: true });

  const md = path.join(dir, 'paper.md');
  if (fs.existsSync(md)) fs.writeFileSync(md, fs.readFileSync(md, 'utf8').replace(/^## \[стр\. (\d+)\]$/gm, '## [p. $1]'));
}

fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify({ model: '', effort: '', skills: ['/i-have-adhd:i-have-adhd'], language: '', uiLang: lang }, null, 2),
);
console.log(`prepared ${out} (${lang})`);
