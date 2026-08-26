import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';

import type { BrowserConfig } from './config.js';

export type XpraConfig = Pick<BrowserConfig, 'xpraPort' | 'xpraBindHost' | 'xpraDisplay' | 'xpraHtml' | 'xpraSocketDir' | 'screenWidth' | 'screenHeight' | 'screenDepth'>;

export function xpraArguments(config: XpraConfig): string[] {
  return [
    'start-desktop', config.xpraDisplay,
    '--daemon=no',
    `--bind-tcp=${config.xpraBindHost}:${config.xpraPort}`,
    `--html=${config.xpraHtml}`,
    '--mdns=no',
    `--socket-dir=${config.xpraSocketDir}`,
    `--resize-display=${config.screenWidth}x${config.screenHeight}`,
    `--pixel-depth=${config.screenDepth}`,
  ];
}

export interface XpraProcess {
  child: ChildProcess;
  args: string[];
}

export async function startXpra(config: XpraConfig): Promise<XpraProcess> {
  await mkdir(config.xpraSocketDir, { recursive: true, mode: 0o700 });
  await chmod(config.xpraSocketDir, 0o700);
  const args = xpraArguments(config);
  const child = spawn('xpra', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      callback();
    };
    const inspect = (chunk: string): void => {
      if (chunk.includes('xpra is ready.')) finish(resolve);
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', inspect);
    child.stderr?.on('data', inspect);
    child.once('error', (cause) => finish(() => reject(cause)));
    child.once('exit', (code) => finish(() => reject(new Error(`xpra exited before becoming ready (code ${code ?? 'unknown'})`))));
    setTimeout(() => finish(() => reject(new Error('xpra did not become ready within 15 seconds'))), 15_000).unref();
  });
  await ready;
  return { child, args };
}

export function stopXpra(process: XpraProcess): void {
  if (process.child.exitCode === null) process.child.kill('SIGTERM');
}
