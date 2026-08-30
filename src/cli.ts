#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';

import { SharedBrowser } from './browser.js';
import { commandPayload, usage as commandUsage } from './commands.js';
import { loadConfig } from './config.js';
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
    const socket = createConnection(socketPath);
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

function usage(): ControlResponse {
  return { ok: false, error: commandUsage() };
}

async function main(): Promise<void> {
  loadDotEnv();
  const command = process.argv[2];
  if (command === undefined) { print(usage()); process.exitCode = 2; return; }
  if (command === 'start') {
    try {
      const config = loadConfig();
      const current = await request(config.socketPath, { op: 'status' });
      if (current.ok) { print(current); return; }
      const browser = new SharedBrowser(config);
      await browser.start();
      return;
    } catch (cause) {
      print({ ok: false, error: cause instanceof Error ? cause.message : String(cause) });
      process.exitCode = 1;
      return;
    }
  }
  try {
    const config = loadConfig();
    const payload = commandPayload(process.argv.slice(2));
    const response = await request(config.socketPath, payload);
    if (!response.ok && (command === 'stop' || command === 'status') && response.error === 'browser service is not running') {
      print({ ok: true, command, state: 'stopped' });
      return;
    }
    print(response);
    if (!response.ok && command !== 'stop') process.exitCode = 1;
  } catch (cause) {
    print({ ok: false, error: cause instanceof Error ? cause.message : String(cause) });
    process.exitCode = 1;
  }
}

void main();
