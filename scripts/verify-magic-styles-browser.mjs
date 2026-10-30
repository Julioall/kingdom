import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = 'browser-ui-evidence/magic';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1120 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/vfx-preview', route => route.fulfill({ contentType: 'text/html', body: `
    <meta charset="utf-8"><style>body{margin:20px;background:#182721;color:#f1e8ce;font:15px system-ui}
    main{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
    article{background:#243b30;border:1px solid #50634d;padding:8px;text-align:center}
    canvas{width:100%;height:186px}small{display:block;color:#c1cbb4}</style>
    <h2>Selos mágicos — preparo</h2><main></main>` }));
  await page.goto('http://127.0.0.1:5173/vfx-preview');
  const profiles = await page.evaluate(async () => {
    const { createMagicPresentation } = await import('/src/ui/magic/presentation.js');
    const { SPELLS } = await import('/src/simulation/magic/catalog.js');
    const { SPELL_VISUAL_STYLES } = await import('/src/ui/magic/spell-styles.js');
    const evidence = [];
    for (const spell of Object.values(SPELLS)) {
      const profile = SPELL_VISUAL_STYLES[spell.id];
      const card = document.createElement('article');
      card.innerHTML = `<strong>${spell.name}</strong><small>${profile.circleStyle} · ${profile.centerSymbol}</small>`;
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 372;
      card.append(canvas); document.querySelector('main').append(card);
      const tileSize = 67 / (spell.radius || .6), view = createMagicPresentation({ tileSize });
      const person = { id: 1, alive: true, x: 1, y: 1, magicCast: { spellId: spell.id,
        startedAt: 0, completesAt: 2000, targetId: spell.radius ? null : 1, x: 1, y: 1 } };
      const world = { people: [person], magicTimeMs: 1900 };
      view.sync(world); view.prepare(world, 1900, { minX: 0, maxX: 4, minY: 0, maxY: 4 }, () => person);
      const ctx = canvas.getContext('2d'); ctx.scale(2, 2);
      ctx.translate(150 - 1.5 * tileSize, 95 - 2 * tileSize);
      view.drawGround(ctx);
      evidence.push({ id: spell.id, ...profile, particles: view.stats().particles });
    }
    return evidence;
  });
  assert.equal(profiles.length, 16);
  assert.equal(errors.length, 0);
  await page.screenshot({ path: output + '/spell-styles.png', fullPage: true });
  await writeFile(output + '/spell-styles.json', JSON.stringify({ profiles, errors }, null, 2));
  console.log(JSON.stringify({ spells: profiles.length, families: [...new Set(profiles.map(p => p.circleStyle))], errors }));
} finally { await browser.close(); }
