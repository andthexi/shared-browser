import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function processIsSharedBrowser(pid: number): boolean {
  try {
    const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
    return command.includes('shared-browser') && command.includes('dist/cli.js') && command.includes('start');
  } catch { return false; }
}

export async function writePidFile(path: string, pid: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${pid}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function readPidFile(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  const value = Number(readFileSync(path, 'utf8').trim());
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function removePidFile(path: string): void {
  try { unlinkSync(path); } catch { /* already gone */ }
}
