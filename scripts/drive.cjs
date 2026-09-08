#!/usr/bin/env node
/**
 * Live drive test: load extension into headless Chromium, visit Zillow,
 * report exactly what the extension did (or failed to do).
 *
 * Usage: node scripts/drive.js [url]
 * Env: HEADFUL=1     visible Chromium instead of headless shell
 *      REALCHROME=1  use installed Chrome with your real profile (best bot-score)
 * Env override: PROFILE_DIR=<path> for custom Chrome profile
 */
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const EXT_PATH = path.join(__dirname, '..', 'extension');
const URL = process.argv[2] || 'https://www.zillow.com/new-haven-ct/rentals/';

const CHROME_EXECS = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: 'google-chrome',
  win32: process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
};
const PROFILE_DEFAULTS = {
  darwin: `${os.homedir()}/Library/Application Support/Google/Chrome`,
  linux: `${os.homedir()}/.config/google-chrome`,
};

(async () => {
  const useReal = !!process.env.REALCHROME;
  const headless = useReal ? false : !process.env.HEADFUL;
  const opts = {
    headless,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--disable-blink-features=AutomationControlled',
    ],
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.127 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  };
  let profileDir = '';
  if (useReal) {
    opts.channel = 'chrome'; // use installed Chrome, not headless shell
    const root = process.env.PROFILE_DIR || PROFILE_DEFAULTS[process.platform] || '';
    profileDir = root ? path.join(root, 'Default') : ''; // real profile lives in user-data-dir/Default
    if (!profileDir) console.warn('[drive] REALCHROME on unknown platform; using temp profile');
  }
  const context = await chromium.launchPersistentContext(profileDir, opts);

  if (!useReal) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = window.chrome || { runtime: {} };
    });
  }

  // Persistent context may already have pages (esp. real-profile launches);
  // attach to the last open one, else create.
  const page = context.pages().pop() || (await context.newPage());
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[ZPF]') || m.type() === 'error') console.log(`[page:${m.type()}] ${t}`);
  });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

  console.log(`[drive] opening ${URL}`);
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.log(`[drive] goto failed: ${e.message}`);
  }
  await page.waitForTimeout(4000);
  // let cards load
  await page.mouse.wheel(0, 3000).catch(() => {});
  await page.waitForTimeout(4000);

  const report = await page.evaluate(() => {
    const s = document.getElementById('zpf-status');
    return {
      title: document.title,
      url: location.href,
      statusChip: s ? s.textContent : null,
      zpfGlobal: typeof window.ZPF !== 'undefined' ? Object.keys(window.ZPF).length : 'MISSING',
      cards: document.querySelectorAll('article[data-test="property-card"]').length,
      cardsTestId: document.querySelectorAll('[data-testid="property-card"]').length,
      nextData: !!document.querySelector('script#__NEXT_DATA__'),
      badgeRows: document.querySelectorAll('.zpf-badge-row').length,
      anyChip: document.querySelectorAll('.zpf-chip').length,
      body: document.body ? document.body.innerText.slice(0, 300) : '',
    };
  });

  console.log('\n=== REPORT ===');
  for (const [k, v] of Object.entries(report)) console.log(`${k}: ${v}`);

  const shot = path.join(__dirname, '..', 'drive-report.png');
  await page.screenshot({ path: shot, fullPage: false }).catch((e) => console.log('shot failed', e.message));
  console.log(`screenshot: ${shot}`);

  if (process.env.INSPECT) {
    console.log(
      '\nArticle-element candidates:',
      await page.evaluate(() =>
        [...document.querySelectorAll('article')].slice(0, 10).map((a) => ({
          test: a.getAttribute('data-test'),
          testid: a.getAttribute('data-testid'),
          cls: a.className.slice(0, 60),
        }))
      )
    );
  }

  await context.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
