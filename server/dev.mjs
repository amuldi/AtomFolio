import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Server-only secrets (SEC_CONTACT_EMAIL, DART_API_KEY…) live in the git-ignored .env.local;
// Vite only reads it for the browser side, so load it for the backend here.
try {
  process.loadEnvFile(path.join(projectRoot, '.env.local'));
} catch {
  // no .env.local: lookups that need a key say so in the UI
}
const viteArgs = process.argv.slice(2);

const backend = spawn(process.execPath, ['--watch', path.join(projectRoot, 'server', 'index.mjs')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: process.env.PORT ?? '8787',
  },
});

const vite = spawn(
  process.execPath,
  [path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), ...viteArgs],
  {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  },
);

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  backend.kill('SIGTERM');
  vite.kill('SIGTERM');
  process.exit(code);
}

backend.on('exit', (code) => {
  shutdown(code ?? 0);
});

vite.on('exit', (code) => {
  shutdown(code ?? 0);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
