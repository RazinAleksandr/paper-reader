// Turn the raw captures from shots.mjs into README images: JPEG screenshots, a demo GIF and a banner.
// Usage: node scripts/readme/assets.mjs [en ru zh]   (reads docs/raw/<lang>/, writes docs/)
// Needs ffmpeg. English files have no suffix; others end in -ru / -zh.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DOCS = path.join(ROOT, 'docs');
const langs = process.argv.slice(2).length ? process.argv.slice(2) : ['en', 'ru', 'zh'];
const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });

const TEXT = {
  en: {
    tagline: 'Ask Claude about a research paper<br>while you read it.',
    chips: ['Select text or cut out a formula', 'One Claude Code session per paper', 'Local · no API key'],
    foot: 'PDF · arXiv · OpenReview · blogs  —  free and open source',
  },
  ru: {
    tagline: 'Спрашивайте Claude о научной статье<br>прямо во время чтения.',
    chips: ['Выделите текст или вырежьте формулу', 'Своя сессия Claude Code для каждой статьи', 'Локально · без API-ключа'],
    foot: 'PDF · arXiv · OpenReview · блоги  —  бесплатно и с открытым кодом',
  },
  zh: {
    tagline: '边读论文，边向 Claude 提问。',
    chips: ['选中文字或截取公式', '每篇论文一个 Claude Code 会话', '本地运行 · 无需 API 密钥'],
    foot: 'PDF · arXiv · OpenReview · 博客  —  免费开源',
  },
};

const serif = (f) => `file://${path.join(ROOT, 'node_modules/@fontsource-variable/source-serif-4/files', f)}`;

// The window is the real reader screenshot, scaled down.
const S = 0.52;

function bannerHtml(lang, shot) {
  const t = TEXT[lang];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Serif4'; src: url('${serif('source-serif-4-latin-opsz-normal.woff2')}') format('woff2'); font-weight: 200 900; }
* { box-sizing: border-box; margin: 0; }
body { width: 1280px; height: 600px; overflow: hidden; position: relative;
  font-family: -apple-system, 'SF Pro Text', 'PingFang SC', sans-serif; color: #18181a;
  background: radial-gradient(1200px 600px at 0% 0%, #ffffff 0%, #f6f5f1 55%, #ecebe6 100%); }
.grid { position: absolute; inset: 0; opacity: .5;
  background-image: linear-gradient(#e6e5df 1px, transparent 1px), linear-gradient(90deg, #e6e5df 1px, transparent 1px);
  background-size: 32px 32px; mask-image: linear-gradient(90deg, #000 0%, transparent 55%); }
.left { position: absolute; left: 60px; top: 0; bottom: 0; width: 430px; display: flex; flex-direction: column; justify-content: center; }
.mark { width: 58px; height: 58px; border-radius: 15px; background: #18181a; display: grid; place-items: center; margin-bottom: 26px;
  box-shadow: 0 10px 24px -10px rgb(0 0 0 / .5); }
h1 { font-family: 'Serif4', Georgia, serif; font-size: 60px; font-weight: 620; letter-spacing: -1.2px; line-height: 1; }
.tag { margin-top: 18px; font-size: ${lang === 'zh' ? 26 : 22}px; line-height: 1.38; color: #4a4a48; font-weight: 450; }
.chips { margin-top: 30px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.chip { font-size: 15px; padding: 8px 14px 8px 12px; border-radius: 999px; background: #fff; border: 1px solid #deded8;
  box-shadow: 0 1px 2px rgb(0 0 0 / .04); display: flex; align-items: center; gap: 9px; color: #2a2a28; }
.chip i { width: 7px; height: 7px; border-radius: 50%; background: #2456d6; display: block; }
.chip:nth-child(2) i { background: #1f9d55; } .chip:nth-child(3) i { background: #c27c0e; }
.foot { margin-top: 30px; font-size: 14px; color: #86867f; letter-spacing: .2px; }
.win { position: absolute; left: 505px; top: 71px; width: ${Math.round(1440 * S)}px; height: ${Math.round(880 * S)}px; border-radius: 12px; overflow: hidden;
  background: #fff url('${shot}') no-repeat; background-size: ${1440 * S}px ${880 * S}px; background-position: 0 0;
  box-shadow: 0 0 0 1px rgb(0 0 0 / .08), 0 30px 70px -20px rgb(0 0 0 / .35), 0 12px 24px -12px rgb(0 0 0 / .18); }
</style></head><body><div class="grid"></div>
<div class="left">
  <div class="mark"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h5"/><path d="M14 2v6h6"/><path d="M20 8v3"/><path d="M8 9h2M8 13h5M8 17h2"/>
    <path d="M14.5 15.5a3 3 0 0 1 3-3h1a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3h-.6l-2.4 2v-2.2a3 3 0 0 1-1-2.3z"/></svg></div>
  <h1>Paper Reader</h1>
  <div class="tag">${t.tagline}</div>
  <div class="chips">${t.chips.map((c) => `<div class="chip"><i></i>${c}</div>`).join('')}</div>
  <div class="foot">${t.foot}</div>
</div>
<div class="win"></div>
</body></html>`;
}

function gif(dir, out) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'marks.json'), 'utf8'));
  const a = Math.max(0, m.start - 0.3);
  const b = m.streaming + 3;
  const c = m.top + 0.2;
  const d = m.end;
  const k = Math.max(1, (c - b) / 3.5); // squeeze the long streaming part into ~3.5 s
  const graph = [
    `[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[a]`,
    `[0:v]trim=start=${b}:end=${c},setpts=(PTS-STARTPTS)/${k.toFixed(3)}[b]`,
    `[0:v]trim=start=${c}:end=${d},setpts=PTS-STARTPTS[c]`,
    `[a][b][c]concat=n=3:v=1[v]`,
    `[v]fps=12,scale=1000:-1:flags=lanczos,split[x][y]`,
    `[x]palettegen=max_colors=128:stats_mode=diff[p]`,
    `[y][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  ].join(';');
  ff('-i', path.join(dir, 'session.webm'), '-filter_complex', graph, '-loop', '0', out);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const lang of langs) {
  const dir = path.join(DOCS, 'raw', lang);
  const sfx = lang === 'en' ? '' : `-${lang}`;
  for (const name of ['reader', 'selection', 'citation-preview', 'dark', 'library']) {
    ff('-i', path.join(dir, `${name}.png`), '-vf', 'scale=2400:-1:flags=lanczos', '-q:v', '4', path.join(DOCS, `${name}${sfx}.jpg`));
  }
  gif(dir, path.join(DOCS, `demo${sfx}.gif`));

  const html = path.join(dir, 'banner.html');
  fs.writeFileSync(html, bannerHtml(lang, `file://${path.join(dir, 'reader.png')}`));
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 }, deviceScaleFactor: 2 });
  await page.goto(`file://${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const png = path.join(dir, 'banner.png');
  await page.screenshot({ path: png });
  await page.close();
  ff('-i', png, '-q:v', '3', path.join(DOCS, `banner${sfx}.jpg`));
  console.log(`assets ready: ${lang}`);
}
await browser.close();
