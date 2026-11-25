// Real screenshots and a screen recording of a running Paper Reader, for the README.
// Usage: BASE=http://localhost:4318 LANG_ID=en OUT=docs/raw/en node scripts/readme/shots.mjs
// The server must run with PAPER_READER_DATA pointing at a library made by prepare.mjs.
// Claude answers for real, so the run takes a few minutes.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:4318';
const LANG = process.env.LANG_ID || 'en';
const OUT = path.resolve(process.env.OUT || `docs/raw/${LANG}`);
fs.mkdirSync(OUT, { recursive: true });
const W = 1440;
const H = 880;

const papers = await (await fetch(BASE + '/api/papers')).json();
const idOf = (prefix) => papers.find((x) => x.title.startsWith(prefix)).id;
const att = idOf('Attention');
const bert = idOf('BERT');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  locale: { en: 'en-US', ru: 'ru-RU', zh: 'zh-CN' }[LANG],
  recordVideo: { dir: OUT, size: { width: W, height: H } },
});
const p = await ctx.newPage();
const t0 = Date.now();
const marks = {};
const mark = (name) => (marks[name] = (Date.now() - t0) / 1000);
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

// Headless Chrome draws no mouse pointer; show one in the recording, hide it for screenshots.
await p.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11.5-6.4.9 3.7 7.3-2.9 1.4-3.6-7.4L4 20z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;left:-40px;top:-40px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px)';
    document.body.appendChild(c);
    addEventListener('mousemove', (e) => ((c.style.left = e.clientX + 'px'), (c.style.top = e.clientY + 'px')), true);
  });
});
const cursor = (show) => p.evaluate((s) => document.getElementById('demo-cursor')?.style.setProperty('display', s ? 'block' : 'none'), show);
const shot = async (name) => {
  await cursor(false);
  await p.screenshot({ path: path.join(OUT, name + '.png') });
  await cursor(true);
};
const goPage = async (n) => {
  await p.fill('.page-box input', String(n));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1500);
};
const formulaBox = (page, needle) =>
  p.evaluate(
    ([page, needle]) => {
      const s = [...document.querySelectorAll(`.pdf-page[data-page="${page}"] .textLayer span`)].find((x) => x.textContent.includes(needle));
      const pg = s.closest('.pdf-page').getBoundingClientRect();
      const b = s.getBoundingClientRect();
      return { x: pg.left + pg.width * 0.3, y: b.top - 24, w: pg.width * 0.42, h: b.height + 50 };
    },
    [page, needle],
  );

// Two tabs: BERT, then "Attention Is All You Need".
await p.goto(`${BASE}/paper/${bert}`);
await p.waitForSelector('.pdf-page .textLayer span');
await p.goto(`${BASE}/paper/${att}`);
await p.waitForSelector('.pdf-page[data-page="1"] .textLayer span');
await p.waitForSelector('.status-line .dot.ready', { timeout: 180_000 });

// Equation (1) on page 4, centred.
await goPage(4);
await p.evaluate(() => {
  const s = [...document.querySelectorAll('.pdf-page[data-page="4"] .textLayer span')].find((x) => x.textContent.includes('Attention('));
  s.scrollIntoView({ block: 'center' });
});
await p.waitForTimeout(800);
const r = await formulaBox(4, 'Attention(');
await p.mouse.move(r.x - 120, r.y + 160);
await p.waitForTimeout(600);

// Recording: S → drag over the formula → "Break down" → the answer streams in.
mark('start');
await p.mouse.move(r.x, r.y, { steps: 12 });
await p.waitForTimeout(400);
await p.keyboard.press('s');
await p.waitForTimeout(300);
await p.mouse.down();
await p.mouse.move(r.x + r.w, r.y + r.h, { steps: 40 });
await p.mouse.up();
await p.waitForSelector('.sel-menu .sel-thumb');
await p.waitForTimeout(900);
const before = await p.locator('.msg.assistant:not(.live)').count();
// Order in the menu: Ask, Explain, Break down, Example — "Break down" is the second preset.
const breakDown = p.locator('.sel-menu button:not(.sel-primary):not(.swatch)').nth(1);
const bb = await breakDown.boundingBox();
await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 15 });
await p.waitForTimeout(500);
await breakDown.click();
await p.waitForSelector('.msg.assistant.live');
mark('streaming');
await p.mouse.move(W - 420, H - 160, { steps: 20 });
await p.waitForFunction((n) => document.querySelectorAll('.msg.assistant:not(.live)').length > n, before, { timeout: 300_000 });
mark('answered');
await p.waitForTimeout(800);
await p.evaluate(() => (document.querySelector('.chat-body').scrollTop = 0));
mark('top');
await p.waitForTimeout(3000);
mark('end');
await shot('reader');

// Text selection toolbar.
await p.evaluate(() => {
  const s = [...document.querySelectorAll('.pdf-page[data-page="4"] .textLayer span')].find((x) => x.textContent.includes('We call our particular attention'));
  s.scrollIntoView({ block: 'center' });
  const range = document.createRange();
  range.selectNodeContents(s);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  s.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
await p.waitForSelector('.sel-menu');
await p.waitForTimeout(400);
await shot('selection');
await p.keyboard.press('Escape');
await p.evaluate(() => getSelection().removeAllRanges());

// Citation preview.
await goPage(2);
const link = p.locator('.pdf-page[data-page="2"] .pdf-link').nth(3);
await link.scrollIntoViewIfNeeded();
await link.hover();
await p.waitForSelector('.link-peek img', { timeout: 15_000 });
await p.waitForTimeout(400);
await shot('citation-preview');
await p.mouse.move(5, 500);

// Dark theme: the theme button is the last one in the top bar (light → sepia → dark).
const themeBtn = p.locator('.topbar button.icon-btn').last();
await themeBtn.click();
await themeBtn.click();
await goPage(4);
await shot('dark');
await themeBtn.click();

// Library.
await p.goto(BASE);
await p.waitForSelector('.paper-row');
await p.waitForTimeout(500);
await shot('library');

const video = await p.video().path();
await ctx.close();
await browser.close();
fs.renameSync(video, path.join(OUT, 'session.webm'));
fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 2));
console.log(JSON.stringify({ lang: LANG, marks, errors }));
