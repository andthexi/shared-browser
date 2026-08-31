#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createConnection as connectSocket } from 'node:net';

import { SharedBrowser } from './browser.js';
import { commandPayload, usage as commandUsage } from './commands.js';
import { loadConfig } from './config.js';
import { RuntimeLogger } from './logger.js';
import { processIsSharedBrowser, readPidFile, removePidFile } from './process-identity.js';
import type { ControlResponse } from './socket.js';

function loadDotEnv(): void {
  const path = resolve('.env');
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/u, '$2');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function print(response: ControlResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function request(socketPath: string, payload: Record<string, unknown>): Promise<ControlResponse> {
  return new Promise((resolveResponse) => {
    const socket = connectSocket(socketPath);
    let buffer = '';
    let settled = false;
    const finish = (response: ControlResponse): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveResponse(response);
    };
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try { finish(JSON.parse(buffer.slice(0, newline)) as ControlResponse); }
      catch { finish({ ok: false, error: 'invalid response from browser service' }); }
    });
    socket.once('error', () => finish({ ok: false, error: 'browser service is not running' }));
    socket.write(`${JSON.stringify(payload)}\n`);
  });
}

function sleep(ms: number): Promise<void> { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }

async function waitForStatus(socketPath: string, predicate: (response: ControlResponse) => boolean, timeoutMs: number): Promise<ControlResponse | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await request(socketPath, { op: 'status' });
    if (predicate(response)) return response;
    await sleep(100);
  }
  return undefined;
}

function usage(): ControlResponse { return { ok: false, error: commandUsage() }; }

async function runSupervisor(): Promise<void> {
  const browser = new SharedBrowser(loadConfig());
  await browser.start();
}

async function startBackground(): Promise<void> {
  const config = loadConfig();
  const current = await request(config.socketPath, { op: 'status' });
  if (current.ok) { print(current); return; }

  const pid = readPidFile(config.pidFile);
  if (pid !== undefined) {
    if (processIsSharedBrowser(pid)) {
      print({ ok: false, error: `shared-browser supervisor ${pid} exists but is not ready` });
      process.exitCode = 1;
      return;
    }
    removePidFile(config.pidFile);
  }

  const child = spawn(process.execPath, [process.argv[1]!, 'start', '--supervisor'], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: process.env,
  });
  child.unref();

  const ready = await waitForStatus(config.socketPath, (response) => response.ok && response.state === 'running'
    && response.xvfb === 'running' && response.chromium === 'running' && response.x11vnc === 'running', 15_000);
  if (ready !== undefined) { print(ready); return; }
  const log = new RuntimeLogger(config.logFile);
  print({ ok: false, error: `shared-browser did not become ready within 15 seconds; inspect ${config.logFile}`, log: log.readTail(20) });
  process.exitCode = 1;
}

async function stopService(): Promise<void> {
  const config = loadConfig();
  const response = await request(config.socketPath, { op: 'stop' });
  if (!response.ok && response.error !== 'browser service is not running') { print(response); process.exitCode = 1; return; }
  const stopped = await waitForStatus(config.socketPath, (candidate) => !candidate.ok && candidate.error === 'browser service is not running', 10_000);
  if (stopped !== undefined || response.ok) {
    removePidFile(config.pidFile);
    print({ ok: true, command: 'stop', state: 'stopped' });
    return;
  }
  print({ ok: false, command: 'stop', error: 'browser service did not stop within 10 seconds' });
  process.exitCode = 1;
}

async function showLogs(args: string[]): Promise<void> {
  const config = loadConfig();
  const payload = commandPayload(args);
  const tail = typeof payload.tail === 'number' ? payload.tail : undefined;
  const logger = new RuntimeLogger(config.logFile);
  if (payload.follow === true) {
    let offset = logger.readTail().length;
    process.stdout.write(logger.readTail().join('\n') + (offset > 0 ? '\n' : ''));
    while (true) {
      await sleep(250);
      const lines = logger.readTail();
      if (lines.length <= offset) continue;
      process.stdout.write(lines.slice(offset).join('\n') + '\n');
      offset = lines.length;
    }
  }
  print({ ok: true, command: 'logs', logFile: config.logFile, lines: logger.readTail(tail) });
}

async function main(): Promise<void> {
  loadDotEnv();
  const command = process.argv[2];
  if (command === undefined) { print(usage()); process.exitCode = 2; return; }
  if (command === 'start' && process.argv[3] === '--supervisor') {
    try { await runSupervisor(); }
    catch (cause) { process.exitCode = 1; }
    return;
  }
  if (command === 'start') {
    try { await startBackground(); }
    catch (cause) { print({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }); process.exitCode = 1; }
    return;
  }
  try {
    const config = loadConfig();
    if (command === 'logs') { await showLogs(process.argv.slice(2)); return; }
    if (command === 'stop') { await stopService(); return; }
    const payload = commandPayload(process.argv.slice(2));
    const response = await request(config.socketPath, payload);
    if (!response.ok && command === 'status' && response.error === 'browser service is not running') {
      print({ ok: true, command, state: 'stopped' });
      return;
    }
    print(response);
    if (!response.ok) process.exitCode = 1;
  } catch (cause) {
    print({ ok: false, error: cause instanceof Error ? cause.message : String(cause) });
    process.exitCode = 1;
  }
}

void main();
