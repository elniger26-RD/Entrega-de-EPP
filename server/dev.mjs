import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';

const processes = [
  spawn(process.execPath, ['server/sqlite-server.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, API_PORT: process.env.API_PORT || '3001' },
  }),
  spawn(npmCommand, ['run', 'dev:web'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: isWindows,
  }),
];

function shutdown(signal) {
  for (const child of processes) {
    if (!child.killed) child.kill(signal);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

for (const child of processes) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      shutdown('SIGTERM');
      process.exit(code);
    }
  });
}
