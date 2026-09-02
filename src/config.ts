import { resolve } from 'node:path';

export interface BrowserConfig {
  vncPort: number;
  display: string | null;
  profileDir: string;
  socketPath: string;
  logFile: string;
  pidFile: string;
  screenWidth: number;
  screenHeight: number;
  screenDepth: number;
  pageLoadTimeoutMs: number;
  actionTimeoutMs: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') throw new Error(`missing environment variable: ${name}`);
  return value;
}

function integer(env: NodeJS.ProcessEnv, name: string, defaultValue: number, minimum: number): number {
  const raw = env[name] ?? String(defaultValue);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`invalid environment variable: ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, options: { localMode?: boolean; rootDir?: string } = {}): BrowserConfig {
  const rootDir = options.rootDir ?? process.cwd();
  const pathValue = (name: string, fallback?: string): string => {
    const value = env[name] ?? fallback;
    if (value === undefined || value.trim() === '') throw new Error(`missing environment variable: ${name}`);
    return resolve(rootDir, value);
  };
  return {
    vncPort: integer(env, 'VNC_PORT', 5900, 1),
    display: options.localMode === true ? null : required(env, 'DISPLAY'),
    profileDir: pathValue('BROWSER_PROFILE_DIR'),
    socketPath: pathValue('BROWSER_CONTROL_SOCKET'),
    logFile: pathValue('LOG_FILE', './runtime/shared-browser.log'),
    pidFile: pathValue('PID_FILE', './runtime/shared-browser.pid'),
    screenWidth: integer(env, 'SCREEN_WIDTH', 1680, 320),
    screenHeight: integer(env, 'SCREEN_HEIGHT', 945, 240),
    screenDepth: integer(env, 'SCREEN_DEPTH', 24, 24),
    pageLoadTimeoutMs: integer(env, 'PAGE_LOAD_TIMEOUT_MS', 30_000, 1),
    actionTimeoutMs: integer(env, 'ACTION_TIMEOUT_MS', 10_000, 1),
  };
}

export function displayNumber(display: string): string {
  const match = /^:(\d+)$/.exec(display);
  if (match === null) throw new Error('DISPLAY must use the form :<number>');
  const number = match[1];
  if (number === undefined) throw new Error('DISPLAY must use the form :<number>');
  return number;
}
