import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = dirname(SCRIPT_DIR);
const NEXT_PATH = join(PROJECT_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
const MODE = process.argv[2];
const PORT = process.env.PORT || '3001';
const HOST = process.env.EPAPER_HOST || '0.0.0.0';

if (MODE !== 'dev' && MODE !== 'start') {
  throw new Error('Usage: node scripts/start-server.mjs <dev|start>');
}

if (!/^\d+$/.test(PORT) || Number(PORT) < 1 || Number(PORT) > 65535) {
  throw new Error(`Invalid PORT: ${PORT}`);
}

await access(NEXT_PATH);
console.log(`Starting Next.js ${MODE} server at http://${HOST}:${PORT}`);

const server = spawn(process.execPath, [NEXT_PATH, MODE, '--port', PORT, '--hostname', HOST], {
  cwd: PROJECT_DIR,
  env: process.env,
  stdio: 'inherit',
});

let forwardedSignal;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    forwardedSignal = signal;
    if (server.exitCode === null && server.signalCode === null) server.kill(signal);
  });
}

server.once('error', (error) => {
  console.error(`[${new Date().toISOString()}] Server failed to start:`, error);
  process.exitCode = 1;
});

server.once('exit', (code, signal) => {
  process.exitCode = forwardedSignal ? 0 : code ?? (signal ? 1 : 0);
});
