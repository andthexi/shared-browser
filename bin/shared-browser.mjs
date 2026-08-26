#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const child = spawn(process.execPath, [join(root, 'dist', 'cli.js'), ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('error', (error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === null ? 1 : 1);
});
