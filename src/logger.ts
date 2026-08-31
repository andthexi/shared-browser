import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class RuntimeLogger {
  constructor(private readonly path: string) {}

  async reset(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, '', { encoding: 'utf8', mode: 0o600 });
  }

  write(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
      const fd = openSync(this.path, 'a', 0o600);
      try { writeFileSync(fd, line, 'utf8'); } finally { closeSync(fd); }
    } catch { /* logging must never take down the service */ }
  }

  readTail(lines?: number): string[] {
    if (!existsSync(this.path)) return [];
    const content = readFileSync(this.path, 'utf8');
    const all = content.split(/\r?\n/u).filter((line) => line !== '');
    return lines === undefined ? all : all.slice(-lines);
  }
}
