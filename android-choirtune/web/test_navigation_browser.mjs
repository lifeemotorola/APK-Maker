/* Optional real-browser check. Serve web/ first; install playwright separately.
 * CHOIR_PREVIEW_URL defaults to http://127.0.0.1:4174.
 * PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE can point to a local test toolchain.
 */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const base = process.env.CHOIR_PREVIEW_URL || 'http://127.0.0.1:4174';
// A short generated A4 WAV exercises the actual file picker / WebAudio pipeline.
const rate = 22050, count = rate * 2;
const wav = Buffer.alloc(44 + count * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
for (let i = 0; i < count; i++) wav.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
try {
  for (const width of [360, 768]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    assert.equal(await page.locator('#screen-home').isVisible(), true);
    assert.equal(await page.locator('#screen-settings').isVisible(), false);
    assert.equal(await page.locator('.tagline').textContent(), 'By Emmanuel Suah');
    await page.locator('#menuBtn').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#menuBtn').getAttribute('aria-expanded') === 'false');
    assert.equal(await page.locator('#menuBtn').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#menuBtn').evaluate(el => el === document.activeElement), true);
    await page.locator('#menuBtn').click();
    // Tab cannot escape a modal drawer into the underlying app.
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.querySelector('#appMenu').contains(document.activeElement)), true);
    }
    for (const name of ['tuner', 'settings', 'library', 'server', 'home']) {
      if (!await page.locator('#appMenu').isVisible()) await page.locator('#menuBtn').click();
      await page.locator('[data-screen="' + name + '"]').click();
      assert.equal(await page.locator('#screen-' + name).isVisible(), true);
      assert.equal(await page.locator('.screen:visible').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' fits viewport');
    }
    await page.locator('#fileInput').setInputFiles({ name: 'Choir test.wav', mimeType: 'audio/wav', buffer: wav });
    await page.waitForFunction(() => !document.querySelector('#results').classList.contains('hidden'), { timeout: 20000 });
    assert.match(await page.locator('.key-stat').textContent(), /source key \(estimate\)/);
    for (const part of ['soprano', 'alto', 'tenor', 'bass']) {
      await page.selectOption('#partSel', part);
      assert.equal(await page.locator('#partSel').inputValue(), part);
    }
    await page.locator('.practice-tools summary').click();
    await page.locator('#saveBtn').click();
    await page.locator('#menuBtn').click();
    await page.locator('[data-screen="library"]').click();
    await page.locator('#library .act-load').first().click();
    assert.equal(await page.locator('#screen-home').isVisible(), true, 'Loading saved tune reveals song results');
    await page.locator('.note-details summary').click();
    assert.equal(await page.locator('#roll').isVisible(), true);
    assert.equal(await page.locator('#sheetBody tr').count() > 0, true);
    assert.deepEqual(errors, []);
    if (process.env.CHOIR_SCREENSHOT_DIR) {
      await page.screenshot({ path: process.env.CHOIR_SCREENSHOT_DIR + '/results-' + width + '.png', fullPage: true });
      await page.reload();
      await page.screenshot({ path: process.env.CHOIR_SCREENSHOT_DIR + '/home-' + width + '.png', fullPage: true });
      await page.locator('#menuBtn').click();
      await page.screenshot({ path: process.env.CHOIR_SCREENSHOT_DIR + '/menu-' + width + '.png' });
    }
    await page.close();
  }
  console.log('CHOIRTUNE BROWSER TEST: responsive home/menu, keyboard focus, all tools, real WAV analysis, key/parts, saved-tune navigation and chart PASSED');
} finally { await browser.close(); }
