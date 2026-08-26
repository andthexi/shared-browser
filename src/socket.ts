import { mkdir, chmod, lstat, rm, stat } from 'node:fs/promises';
import { createConnection, createServer, type Server } from 'node:net';
import { dirname } from 'node:path';

import type { BrowserConfig } from './config.js';

export interface ControlRequest {
  op: string;
  [key: string]: unknown;
}

export interface ControlResponse {
  ok: boolean;
  [key: string]: unknown;
}

export type RequestHandler = (request: ControlRequest) => Promise<ControlResponse>;

async function pathIsSocket(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSocket();
  } catch {
    return false;
  }
}

async function canConnect(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    const finish = (value: boolean): void => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function prepareSocketPath(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  try {
    await stat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  if (!(await pathIsSocket(path))) throw new Error(`control socket path is occupied: ${path}`);
  if (await canConnect(path)) throw new Error(`browser service is already running: ${path}`);
  await rm(path, { force: true });
}

export class ControlServer {
  private server: Server | undefined;

  constructor(private readonly path: string, private readonly handler: RequestHandler) {}

  async start(): Promise<void> {
    await prepareSocketPath(this.path);
    this.server = createServer((socket) => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          void this.handleLine(socket, line);
          newline = buffer.indexOf('\n');
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.path, () => resolve());
    });
    await chmod(this.path, 0o600);
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server !== undefined) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await rm(this.path, { force: true });
  }

  private async handleLine(socket: import('node:net').Socket, line: string): Promise<void> {
    let response: ControlResponse;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('request must be a JSON object');
      response = await this.handler(parsed as ControlRequest);
    } catch (error) {
      response = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    socket.write(`${JSON.stringify(response)}\n`);
  }
}

export async function probeTcpPort(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error) => reject(new Error(`VNC port ${port} is unavailable: ${error.message}`)));
    server.listen(port, '127.0.0.1', () => resolve());
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export function controlAddress(config: BrowserConfig): string {
  return config.socketPath;
}
