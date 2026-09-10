const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const DIR = __dirname;
const FRAMES = path.join(DIR, 'frames');
const MODE = process.argv[2] || 'smoke';
const FPS = 30;

const SMOKE_TS = [0.6, 2.0, 3.2, 4.4, 6.3, 8.5, 11.0, 13.5, 16.2, 20.5, 24.0, 28.5, 32.0, 34.5, 37.6, 41.0, 43.0, 47.8, 50.2, 52.4, 54.6, 57.2, 59.2];

(async () => {
  if (!fs.existsSync(FRAMES)) fs.mkdirSync(FRAMES, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('file:///' + path.join(DIR, 'film.html').replace(/\\/g, '/'));
  await page.waitForTimeout(700);

  const t0 = Date.now();
  if (MODE === 'smoke') {
    for (let i = 0; i < SMOKE_TS.length; i++) {
      const t = SMOKE_TS[i];
      await page.evaluate(tt => window.__seek(tt), t);
      await page.screenshot({ path: path.join(FRAMES, 'smoke_' + String(i).padStart(2, '0') + '_t' + t.toFixed(1) + '.jpg'), type: 'jpeg', quality: 88 });
    }
  } else {
    const N = 60 * FPS;
    for (let i = 0; i < N; i++) {
      await page.evaluate(tt => window.__seek(tt), i / FPS);
      await page.screenshot({ path: path.join(FRAMES, 'f' + String(i).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 90 });
      if (i % 300 === 0) console.log('frame', i, ((Date.now() - t0) / 1000).toFixed(0) + 's');
    }
  }
  console.log('done', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'errors:', errs.length);
  if (errs.length) console.log(errs.slice(0, 8).join('\n'));
  await browser.close();
})();
