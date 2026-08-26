import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = dirname(SCRIPT_DIR);
const SNAPSHOT_DIR = join(SITE_DIR, 'snapshot');
const LOCK_FILE = join(SNAPSHOT_DIR, '.hourly-export.lock');
const PORT = process.env.PORT || '3001';
const BASE_URL = process.env.EPAPER_BASE_URL || `http://127.0.0.1:${PORT}`;
const PATH_DIRS = (process.env.PATH || '').split(delimiter).filter(Boolean);
const CHROME_NAMES = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];
const CHROME_CANDIDATES = [...new Set([
  process.env.EPAPER_CHROME_PATH,
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  ...PATH_DIRS.flatMap((directory) => CHROME_NAMES.map((name) => join(directory, name))),
].filter(Boolean))];
const PAGES = [
  { name: 'currency', route: '/currency', width: 800, height: 480, marker: 'USD to CNH Chart' },
  { name: 'landscape', route: '/landscape', width: 800, height: 480, marker: 'Beijing' },
  { name: 'portrait', route: '/portrait', width: 480, height: 800, marker: 'HOURLY AQI FORECAST' },
  { name: 'forecast-15d', route: '/forecast-15d', width: 480, height: 800, marker: '15-DAY FORECAST' },
];

function hourKey(date = new Date()) {
  return date.toISOString().slice(0, 13).replaceAll(/[-T:]/g, '');
}

async function findExecutable(candidates, errorMessage) {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next supported executable path.
    }
  }
  throw new Error(errorMessage);
}

async function findChrome() {
  return findExecutable(
    CHROME_CANDIDATES,
    'Chrome was not found. Install Chrome/Chromium or set EPAPER_CHROME_PATH to its executable.',
  );
}

async function expectedSiteIsReady() {
  try {
    const response = await fetch(`${BASE_URL}/currency?snapshotProbe=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return false;
    return (await response.text()).includes('USD to CNH Chart');
  } catch {
    return false;
  }
}

async function verifyPng(path, width, height) {
  const image = await readFile(path);
  const signature = image.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error(`${path} is not a PNG file`);
  const actualWidth = image.readUInt32BE(16);
  const actualHeight = image.readUInt32BE(20);
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error(`${path} is ${actualWidth}x${actualHeight}; expected ${width}x${height}`);
  }
}

async function capturePage(chromePath, profileDir, temporaryPath, page, targetUrl) {
  const chromeArgs = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    ...(process.platform === 'linux' ? ['--disable-dev-shm-usage'] : []),
    ...(typeof process.getuid === 'function' && process.getuid() === 0
      ? ['--no-sandbox', '--disable-setuid-sandbox']
      : []),
    '--hide-scrollbars',
    '--no-first-run',
    '--run-all-compositor-stages-before-draw',
    '--force-device-scale-factor=1',
    `--window-size=${page.width},${page.height}`,
    '--virtual-time-budget=3000',
    `--user-data-dir=${profileDir}`,
    `--screenshot=${temporaryPath}`,
    targetUrl,
  ];
  const child = spawn(chromePath, chromeArgs, {
    cwd: SITE_DIR,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let processError;
  let processExit;
  let chromeStderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    chromeStderr = `${chromeStderr}${chunk}`.slice(-16_384);
  });
  child.once('error', (error) => { processError = error; });
  child.once('exit', (code, signal) => { processExit = { code, signal }; });

  const deadline = Date.now() + 25_000;
  let previousSize = -1;
  let stableReads = 0;
  try {
    while (Date.now() < deadline) {
      if (processError) throw processError;
      try {
        const fileStat = await stat(temporaryPath);
        if (fileStat.size > 24 && fileStat.size === previousSize) stableReads += 1;
        else stableReads = 0;
        previousSize = fileStat.size;
        if (stableReads >= 2) {
          await verifyPng(temporaryPath, page.width, page.height);
          return;
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (processExit && processExit.code !== 0) {
        const detail = chromeStderr.trim();
        throw new Error(`Chrome exited with ${processExit.code ?? processExit.signal}${detail ? `:\n${detail}` : ''}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Chrome did not finish ${page.route} within 25 seconds`);
  } finally {
    if (child.pid && !processExit) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* browser already stopped */ }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

async function exportPage(chromePath, page, refreshKey) {
  const outputPath = join(SNAPSHOT_DIR, `${page.name}-frontend.png`);
  const temporaryPath = join(SNAPSHOT_DIR, `.${page.name}-frontend-${process.pid}.png`);
  const targetUrl = `${BASE_URL}${page.route}?snapshotHour=${refreshKey}`;
  const response = await fetch(targetUrl, { cache: 'no-store' });
  if (!response.ok || !(await response.text()).includes(page.marker)) {
    throw new Error(`${page.route} did not return the expected front-end page`);
  }

  const profileDir = await mkdtemp(join(tmpdir(), `weather-epaper-${page.name}-`));
  try {
    await capturePage(chromePath, profileDir, temporaryPath, page, targetUrl);
    await rename(temporaryPath, outputPath);
    return outputPath;
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
}

async function acquireLock() {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  try {
    return await open(LOCK_FILE, 'wx');
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const lockStat = await stat(LOCK_FILE);
    if (Date.now() - lockStat.mtimeMs < 15 * 60 * 1000) return undefined;
    await rm(LOCK_FILE, { force: true });
    return open(LOCK_FILE, 'wx');
  }
}

async function main() {
  const lock = await acquireLock();
  if (!lock) {
    console.log('An hourly snapshot export is already running.');
    return;
  }

  try {
    await lock.writeFile(`${new Date().toISOString()}\n`);
    if (!(await expectedSiteIsReady())) {
      throw new Error(`The production site is not available at ${BASE_URL}. Start it before running the scheduled export.`);
    }
    const chromePath = await findChrome();
    console.log(`Using Chrome executable: ${chromePath}`);
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      console.warn('Running Chrome as root; sandbox is disabled for the snapshot process. Prefer a non-root service user in production.');
    }
    const refreshKey = hourKey();
    const exported = [];
    for (const page of PAGES) exported.push(await exportPage(chromePath, page, refreshKey));
    console.log(`[${new Date().toISOString()}] Exported ${exported.length} front-end images for hour ${refreshKey}.`);
  } finally {
    await lock.close();
    await rm(LOCK_FILE, { force: true });
  }
}

main().catch((error) => {
  console.error(`[${new Date().toISOString()}] Hourly snapshot export failed:`, error);
  process.exitCode = 1;
});
