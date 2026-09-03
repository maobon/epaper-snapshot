import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, appendFile, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = dirname(SCRIPT_DIR);
const SNAPSHOT_DIR = join(PROJECT_DIR, 'snapshot');
const LOG_DIR = join(PROJECT_DIR, 'logs');
const LOCK_FILE = join(SNAPSHOT_DIR, '.hourly-export.lock');
const REPORT_FILE = join(LOG_DIR, 'monitor-report.json');
const INFO_LOG_FILE = join(LOG_DIR, 'hourly-export.log');
const ERROR_LOG_FILE = join(LOG_DIR, 'hourly-export-error.log');
const PORT = process.env.PORT || '3001';
const BASE_URL = process.env.EPAPER_BASE_URL || `http://127.0.0.1:${PORT}`;
const CHROME_TIMEOUT_MS = Math.max(10_000, Number(process.env.EPAPER_CHROME_TIMEOUT_MS) || 120_000);
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
const CURRENCY_PAGE = { name: 'currency', fileName: 'currency-frontend.png', view: 'currency', route: '/currency', width: 800, height: 480, marker: 'USD to CNH Chart' };
const WEATHER_PAGES = [
  { view: 'landscape', route: '/landscape', width: 800, height: 480 },
  { view: 'portrait', route: '/portrait', width: 480, height: 800 },
  { view: 'forecast-15d', route: '/forecast-15d', width: 480, height: 800 },
];

function envFlag(name, fallback) {
  const value = process.env[name];
  return value === undefined ? fallback : !['0', 'false', 'no'].includes(value.trim().toLowerCase());
}

function envInteger(name, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

const REQUIRE_LIVE_DATA = envFlag('EPAPER_REQUIRE_LIVE_DATA', true);
const EXPORT_DELAY_MS = envInteger('EPAPER_EXPORT_DELAY_MS', 2_000, 0);
const CHROME_NICE = envInteger('EPAPER_CHROME_NICE', 10, 0, 19);
const LOWER_CHROME_PRIORITY = process.platform === 'linux' && CHROME_NICE > 0;

async function ensureLogFiles() {
  await mkdir(LOG_DIR, { recursive: true });
  await Promise.all([appendFile(INFO_LOG_FILE, ''), appendFile(ERROR_LOG_FILE, '')]);
}

async function writeLog(path, message) {
  await ensureLogFiles();
  await appendFile(path, `[${new Date().toISOString()}] ${message}\n`);
}

async function logInfo(message) {
  console.log(message);
  await writeLog(INFO_LOG_FILE, message);
}

async function logError(message) {
  console.error(message);
  await writeLog(ERROR_LOG_FILE, message);
}

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

async function expectedAppIsReady() {
  try {
    const response = await fetch(`${BASE_URL}/api/weather?view=snapshot-probe`, { cache: 'no-store' });
    return response.status === 400;
  } catch {
    return false;
  }
}

function configuredWeatherCities() {
  let configured = [{ key: 'beijing', name: 'Beijing' }];
  if (process.env.WEATHER_CITIES?.trim()) {
    try {
      configured = JSON.parse(process.env.WEATHER_CITIES);
    } catch (error) {
      throw new Error(`WEATHER_CITIES must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!Array.isArray(configured) || configured.length === 0) {
    throw new Error('WEATHER_CITIES must be a non-empty JSON array');
  }
  const cities = configured.map((city, index) => {
    const key = typeof city?.key === 'string' ? city.key.trim().toLowerCase() : '';
    const name = typeof city?.name === 'string' ? city.name.trim() : '';
    if (!key || !name) throw new Error(`WEATHER_CITIES[${index}] must contain a valid key and name`);
    return { key, name };
  });
  if (new Set(cities.map((city) => city.key)).size !== cities.length) {
    throw new Error('WEATHER_CITIES contains duplicate keys');
  }
  return cities;
}

function pagesForCities(cities) {
  return [
    CURRENCY_PAGE,
    ...cities.flatMap((city) => {
      const cityFileName = `${city.key.charAt(0).toUpperCase()}${city.key.slice(1)}`;
      return WEATHER_PAGES.map((page) => ({
        ...page,
        city: city.key,
        name: `${page.view}-${cityFileName}`,
        fileName: `${page.view}-${cityFileName}.png`,
        marker: page.view === 'landscape' ? city.name : page.view === 'portrait' ? '>AQI<' : '15-DAY FORECAST',
      }));
    }),
  ];
}

async function removeLegacyWeatherSnapshots() {
  const entries = await readdir(SNAPSHOT_DIR, { withFileTypes: true });
  const legacyNames = entries
    .filter((entry) => entry.isFile() && /^(?:.+-)?(?:landscape|portrait|forecast-15d)-frontend\.png$/.test(entry.name))
    .map((entry) => entry.name);
  await Promise.all(legacyNames.map((fileName) => rm(join(SNAPSHOT_DIR, fileName), { force: true })));
  return legacyNames;
}

async function verifyPng(path, width, height) {
  const image = await readFile(path);
  verifyPngBuffer(image, width, height, path);
}

function verifyPngBuffer(image, width, height, label) {
  const signature = image.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error(`${label} is not a PNG file`);
  const actualWidth = image.readUInt32BE(16);
  const actualHeight = image.readUInt32BE(20);
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error(`${label} is ${actualWidth}x${actualHeight}; expected ${width}x${height}`);
  }
}

function parseRenderManifest(html, label) {
  const match = html.match(/<script\b[^>]*\bid="render-monitor-manifest"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error(`${label} omitted the render monitor manifest`);
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`${label} returned an invalid render monitor manifest: ${error.message}`);
  }
}

function chromeProcessGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    // macOS can return EPERM after Chrome has handed work to a process group
    // that the launcher can no longer signal. Cleanup must not turn an
    // otherwise successful snapshot export into a failure in that case.
    if (error?.code === 'ESRCH' || error?.code === 'EPERM') return false;
    throw error;
  }
}

async function waitForChromeProcessGroup(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!chromeProcessGroupExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !chromeProcessGroupExists(pid);
}

async function stopChromeProcessGroup(child) {
  if (!child.pid || !chromeProcessGroupExists(child.pid)) return;

  try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  if (await waitForChromeProcessGroup(child.pid, 3_000)) return;

  try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  if (!(await waitForChromeProcessGroup(child.pid, 2_000))) {
    throw new Error(`Chrome process group ${child.pid} did not exit after SIGKILL`);
  }
}

async function removeChromeProfile(profileDir) {
  try {
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    await logError(`WARNING: Could not remove Chrome profile ${profileDir}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function capturePage(chromePath, profileDir, temporaryPath, page, targetUrl) {
  const chromeArgs = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-mode',
    '--disable-background-networking',
    '--disable-component-extensions-with-background-pages',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-default-browser-check',
    '--no-pings',
    '--renderer-process-limit=1',
    ...(process.platform === 'linux' ? ['--disable-dev-shm-usage'] : []),
    ...(typeof process.getuid === 'function' && process.getuid() === 0
      ? ['--no-sandbox', '--disable-setuid-sandbox']
      : []),
    '--hide-scrollbars',
    '--no-first-run',
    '--run-all-compositor-stages-before-draw',
    '--force-device-scale-factor=1',
    `--window-size=${page.width},${page.height}`,
    '--dump-dom',
    `--user-data-dir=${profileDir}`,
    `--screenshot=${temporaryPath}`,
    targetUrl,
  ];
  const child = spawn(LOWER_CHROME_PRIORITY ? 'nice' : chromePath, LOWER_CHROME_PRIORITY ? ['-n', String(CHROME_NICE), chromePath, ...chromeArgs] : chromeArgs, {
    cwd: PROJECT_DIR,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let processError;
  let processExit;
  let chromeStdout = '';
  let chromeStderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    chromeStdout = `${chromeStdout}${chunk}`;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    chromeStderr = `${chromeStderr}${chunk}`.slice(-16_384);
  });
  child.once('error', (error) => { processError = error; });
  child.once('exit', (code, signal) => { processExit = { code, signal }; });

  const deadline = Date.now() + CHROME_TIMEOUT_MS;
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
        if (stableReads >= 2 && chromeStdout.includes('render-monitor-manifest')) {
          await verifyPng(temporaryPath, page.width, page.height);
          return chromeStdout;
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
    const screenshotState = stableReads >= 2 ? 'ready' : 'not ready';
    const manifestState = chromeStdout.includes('render-monitor-manifest') ? 'ready' : 'missing';
    const stderrDetail = chromeStderr.trim();
    throw new Error(
      `Chrome did not finish ${page.route} within ${Math.round(CHROME_TIMEOUT_MS / 1_000)} seconds `
      + `(screenshot: ${screenshotState}, manifest: ${manifestState})`
      + (stderrDetail ? `:\n${stderrDetail}` : ''),
    );
  } finally {
    await stopChromeProcessGroup(child);
  }
}

async function exportPage(chromePath, page, refreshKey) {
  const outputPath = join(SNAPSHOT_DIR, page.fileName);
  const temporaryPath = join(SNAPSHOT_DIR, `.${page.name}-${process.pid}.png`);
  const targetUrlObject = new URL(page.route, BASE_URL);
  targetUrlObject.searchParams.set('snapshotHour', refreshKey);
  if (page.city) targetUrlObject.searchParams.set('city', page.city);
  const targetUrl = targetUrlObject.toString();
  const profileDir = await mkdtemp(join(tmpdir(), `weather-epaper-${page.name}-`));
  try {
    const renderedHtml = await capturePage(chromePath, profileDir, temporaryPath, page, targetUrl);
    if (!renderedHtml.includes(page.marker)) {
      throw new Error(`${page.route} did not return the expected front-end page`);
    }
    const manifest = parseRenderManifest(renderedHtml, page.route);
    if (manifest.view !== page.view) {
      throw new Error(`${page.route} manifest identifies itself as ${manifest.view}`);
    }
    if (REQUIRE_LIVE_DATA && manifest.source !== 'live') {
      throw new Error(`${page.name} used fallback data instead of a live server response`);
    }
    await rename(temporaryPath, outputPath);
    return { name: page.name, view: page.view, city: page.city, route: page.route, outputPath, source: manifest.source, fingerprint: manifest.fingerprint, width: page.width, height: page.height, status: 'passed' };
  } finally {
    await rm(temporaryPath, { force: true });
    await removeChromeProfile(profileDir);
  }
}

async function writeReport(report) {
  await mkdir(LOG_DIR, { recursive: true });
  const temporaryPath = join(LOG_DIR, `.monitor-report-${process.pid}.json`);
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporaryPath, REPORT_FILE);
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
  await ensureLogFiles();
  const lock = await acquireLock();
  if (!lock) {
    await logInfo('An hourly snapshot export is already running.');
    return;
  }

  try {
    await lock.writeFile(`${new Date().toISOString()}\n`);
    if (!(await expectedAppIsReady())) {
      throw new Error(`The production app is not available at ${BASE_URL}. Start it before running the scheduled export.`);
    }
    const chromePath = await findChrome();
    await logInfo(`Using Chrome executable: ${chromePath}`);
    const schedulingPriority = LOWER_CHROME_PRIORITY ? `nice ${CHROME_NICE}` : 'operating-system default';
    await logInfo(`Chrome scheduling priority: ${schedulingPriority}.`);
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      await logInfo('WARNING: Running Chrome as root; sandbox is disabled for the snapshot process. Prefer a non-root service user in production.');
    }
    const refreshKey = hourKey();
    const checks = [];
    const reportContext = {
      hour: refreshKey,
      baseUrl: BASE_URL,
      requireLiveData: REQUIRE_LIVE_DATA,
      chromeNice: LOWER_CHROME_PRIORITY ? CHROME_NICE : undefined,
      exportDelayMs: EXPORT_DELAY_MS,
    };
    try {
      const cities = configuredWeatherCities();
      const pages = pagesForCities(cities);
      for (const [index, page] of pages.entries()) {
        checks.push(await exportPage(chromePath, page, refreshKey));
        if (EXPORT_DELAY_MS > 0 && index < pages.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, EXPORT_DELAY_MS));
        }
      }
      const removedLegacyFiles = await removeLegacyWeatherSnapshots();
      await writeReport({ status: 'passed', checkedAt: new Date().toISOString(), ...reportContext, checks });
      if (removedLegacyFiles.length > 0) await logInfo(`Removed ${removedLegacyFiles.length} legacy weather snapshot files.`);
      await logInfo(`Exported and verified ${checks.length} snapshot images for hour ${refreshKey}.`);
    } catch (error) {
      await writeReport({ status: 'failed', checkedAt: new Date().toISOString(), ...reportContext, checks, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  } finally {
    await lock.close();
    await rm(LOCK_FILE, { force: true });
  }
}

main().catch(async (error) => {
  const detail = error instanceof Error ? (error.stack || error.message) : String(error);
  await logError(`Hourly snapshot export failed: ${detail}`);
  process.exitCode = 1;
});
