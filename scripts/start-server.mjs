import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = dirname(SCRIPT_DIR);
const VINEXT_PATH = join(SITE_DIR, 'node_modules', '.bin', 'vinext');
const SNAPSHOT_SCRIPT = join(SCRIPT_DIR, 'export-hourly-snapshots.mjs');
const MODE = process.argv[2];
const PORT = process.env.PORT || '3001';
const BASE_URL = process.env.EPAPER_BASE_URL || `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 60_000;

if (MODE !== 'dev' && MODE !== 'start') {
  throw new Error('Usage: node scripts/start-server.mjs <dev|start>');
}

async function siteIsReady() {
  try {
    const response = await fetch(`${BASE_URL}/currency?startupProbe=${Date.now()}`, {
      cache: 'no-store',
    });
    return response.ok && (await response.text()).includes('USD to CNH Chart');
  } catch {
    return false;
  }
}

async function refreshAllScreensAfterStartup(server) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) return;
    if (await siteIsReady()) {
      console.log(`[${new Date().toISOString()}] Server is ready; refreshing all four e-paper screens.`);
      const refresh = spawn(process.execPath, [SNAPSHOT_SCRIPT], {
        cwd: SITE_DIR,
        env: { ...process.env, EPAPER_BASE_URL: BASE_URL },
        stdio: 'inherit',
      });

      refresh.once('error', (error) => {
        console.error(`[${new Date().toISOString()}] Initial screen refresh could not start:`, error);
      });
      refresh.once('exit', (code, signal) => {
        if (code !== 0) {
          console.error(`[${new Date().toISOString()}] Initial screen refresh failed with ${code ?? signal}.`);
        }
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.error(`[${new Date().toISOString()}] Initial screen refresh skipped because the server was not ready within 60 seconds.`);
}

await access(VINEXT_PATH);
const server = spawn(VINEXT_PATH, [MODE], {
  cwd: SITE_DIR,
  env: process.env,
  stdio: 'inherit',
});

const signalHandlers = new Map();
for (const signal of ['SIGINT', 'SIGTERM']) {
  const handler = () => {
    if (server.exitCode === null && server.signalCode === null) server.kill(signal);
  };
  signalHandlers.set(signal, handler);
  process.once(signal, handler);
}

server.once('error', (error) => {
  console.error(`[${new Date().toISOString()}] Server failed to start:`, error);
  process.exitCode = 1;
});

void refreshAllScreensAfterStartup(server);

server.once('exit', (code, signal) => {
  for (const [registeredSignal, handler] of signalHandlers) {
    process.off(registeredSignal, handler);
  }
  if (code !== null) process.exitCode = code;
  else if (signal) process.exitCode = 1;
});
