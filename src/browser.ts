import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';

import type { BrowserConfig } from './config.js';
import { classifyClickSafety } from './safety.js';
import { ControlServer, probeTcpPort, type ControlRequest, type ControlResponse } from './socket.js';
import { startXpra, stopXpra, type XpraProcess } from './xpra.js';

declare global {
  interface Window { __sharedBrowserAgentAction?: boolean; }
}


interface Target {
  label?: string;
  placeholder?: string;
  role?: string;
  name?: string;
  css?: string;
  index?: number;
}

const submitGuard = `(() => {
  const blocked = () => Boolean(window.__sharedBrowserAgentAction);
  document.addEventListener('submit', event => {
    if (blocked()) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const originalSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function(...args) {
    if (blocked()) return;
    return originalSubmit.apply(this, args);
  };
  const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  HTMLFormElement.prototype.requestSubmit = function(...args) {
    if (blocked()) return;
    return originalRequestSubmit.apply(this, args);
  };
})();`;

type PageMetadata = {
  url: string;
  title: string;
  text: string;
  elements: Array<Record<string, unknown>>;
};

function error(message: string): ControlResponse { return { ok: false, error: message }; }
function success(command: string, data: Record<string, unknown> = {}): ControlResponse { return { ok: true, command, ...data }; }

function targetValue(request: ControlRequest): Target {
  const target = request.target;
  if (target === null || typeof target !== 'object' || Array.isArray(target)) throw new Error('target must be an object');
  return target as Target;
}

function targetDescription(target: Target): string {
  if (target.label !== undefined) return `label=${target.label}`;
  if (target.placeholder !== undefined) return `placeholder=${target.placeholder}`;
  if (target.role !== undefined) return `role=${target.role}/${target.name ?? ''}`;
  if (target.css !== undefined) return `css=${target.css}`;
  throw new Error('target requires label, placeholder, role, or css');
}

function locator(page: Page, target: Target): Locator {
  if (target.label !== undefined) return page.getByLabel(target.label, { exact: true });
  if (target.placeholder !== undefined) return page.getByPlaceholder(target.placeholder, { exact: true });
  if (target.role !== undefined) {
    if (target.name === undefined) throw new Error('role target requires name');
    return page.getByRole(target.role as Parameters<Page['getByRole']>[0], { name: target.name, exact: true });
  }
  if (target.css !== undefined) return page.locator(target.css).nth(target.index ?? 0);
  throw new Error('target requires label, placeholder, role, or css');
}

async function withAgentGuard<T>(page: Page, action: () => Promise<T>): Promise<T> {
  await page.evaluate(() => { window.__sharedBrowserAgentAction = true; });
  try { return await action(); } finally { await page.evaluate(() => { window.__sharedBrowserAgentAction = false; }); }
}

async function pageMetadata(page: Page): Promise<PageMetadata> {
  const elements = await page.locator('a,button,input,textarea,select,[contenteditable="true"]').evaluateAll((nodes) => nodes
    .filter((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    })
    .map((node) => {
      const element = node as HTMLInputElement;
      const tagName = element.tagName.toLowerCase();
      const role = element.getAttribute('role') ?? (tagName === 'button' ? 'button' : tagName === 'a' ? 'link' : tagName);
      const name = element.getAttribute('aria-label') ?? element.getAttribute('placeholder') ?? element.innerText?.trim() ?? '';
      return {
        tagName,
        role,
        name: name.slice(0, 200),
        type: element.getAttribute('type') ?? '',
        insideForm: element.closest('form') !== null,
        empty: 'value' in element ? (element as HTMLInputElement).value.length === 0 : false,
        disabled: 'disabled' in element ? (element as HTMLInputElement).disabled : false,
      };
    }));
  return { url: page.url(), title: await page.title(), text: (await page.locator('body').innerText()).slice(0, 20_000), elements };
}

export class SharedBrowser {
  private xpra: XpraProcess | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private server: ControlServer | undefined;
  private stopping = false;

  constructor(private readonly config: BrowserConfig) {}

  async start(): Promise<void> {
    await probeTcpPort(this.config.xpraPort);
    await mkdir(this.config.profileDir, { recursive: true });
    try {
      this.xpra = await startXpra(this.config);
      await this.wait(500);
      this.context = await chromium.launchPersistentContext(this.config.profileDir, {
        headless: false,
        viewport: { width: this.config.screenWidth, height: this.config.screenHeight },
        args: ['--no-first-run', '--no-default-browser-check', '--restore-last-session'],
        env: { ...process.env, DISPLAY: this.config.xpraDisplay },
      });
      this.page = this.context.pages()[0] ?? await this.context.newPage();
      await this.context.addInitScript({ content: submitGuard });
      this.server = new ControlServer(this.config.socketPath, (request) => this.handle(request));
      await this.server.start();
      process.stdout.write(`${JSON.stringify(await this.statusResponse())}\n`);
      process.once('SIGINT', () => { void this.stop(); });
      process.once('SIGTERM', () => { void this.stop(); });
      await new Promise<void>((resolve) => { this.resolveStop = resolve; });
    } catch (cause) {
      await this.stopChildren();
      throw cause;
    }

  }

  private resolveStop: (() => void) | undefined;

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    await this.server?.stop().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.stopChildren();
    this.resolveStop?.();
  }

  private async stopChildren(): Promise<void> {
    if (this.xpra !== undefined) {
      stopXpra(this.xpra);
      await new Promise<void>((resolve) => {
        if (this.xpra?.child.exitCode !== null) resolve();
        else this.xpra?.child.once('exit', () => resolve());
      });
      this.xpra = undefined;
    }
  }

  async statusResponse(): Promise<ControlResponse> {
    return success('status', {
      state: this.stopping ? 'stopping' : this.server === undefined ? 'starting' : 'running',
      display: this.config.xpraDisplay,
      xpraPort: this.config.xpraPort,
      xpraBindHost: this.config.xpraBindHost,
      controlSocket: this.config.socketPath,
      xpra: this.xpra?.child.exitCode === null ? 'running' : 'stopped',
      chromium: this.context === undefined ? 'stopped' : 'running',
      page: this.page === undefined ? null : { url: this.page.url(), title: await this.page.title().catch(() => '') },
    });
  }


  private async handle(request: ControlRequest): Promise<ControlResponse> {
    try {
      if (request.op === 'status') return this.statusResponse();
      if (request.op === 'stop') { void this.stop(); return success('stop', { state: 'stopping' }); }
      if (this.page === undefined) return error('browser page is not ready');
      if (request.op === 'open-url') return this.openUrl(request.url);
      if (request.op === 'inspect') return success('inspect', await pageMetadata(this.page));
      if (request.op === 'click') return this.click(request);
      if (request.op === 'fill') return this.fill(request);
      return error(`unsupported operation: ${request.op}`);
    } catch (cause) { return error(cause instanceof Error ? cause.message : String(cause)); }
  }

  private async openUrl(value: unknown): Promise<ControlResponse> {
    if (typeof value !== 'string') return error('url must be a string');
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return error('only http and https URLs are allowed');
    await this.page?.goto(url.href, { waitUntil: 'domcontentloaded', timeout: this.config.pageLoadTimeoutMs });
    return success('open-url', { url: this.page?.url(), title: await this.page?.title() });
  }

  private async click(request: ControlRequest): Promise<ControlResponse> {
    const target = targetValue(request);
    const selected = locator(this.page as Page, target);
    const metadata = await selected.evaluate((node) => {
      const element = node as HTMLElement & { type?: string };
      return { tagName: element.tagName, type: element.getAttribute('type') ?? element.type ?? '', insideForm: element.closest('form') !== null, accessibleName: element.getAttribute('aria-label') ?? element.innerText ?? '' };
    });
    const safety = classifyClickSafety(metadata);
    if (!safety.ok) return error(safety.reason);
    const popup = this.context?.waitForEvent('page', { timeout: this.config.actionTimeoutMs }).catch(() => undefined);
    await withAgentGuard(this.page as Page, () => selected.click({ timeout: this.config.actionTimeoutMs, noWaitAfter: true }));
    const openedPage = await popup;
    if (openedPage !== undefined) {
      this.page = openedPage;
      await openedPage.waitForLoadState('domcontentloaded', { timeout: this.config.pageLoadTimeoutMs }).catch(() => undefined);
    }
    await this.page?.waitForLoadState('domcontentloaded', { timeout: this.config.pageLoadTimeoutMs }).catch(() => undefined);
    return success('click', { target: targetDescription(target), url: this.page?.url(), title: await this.page?.title() });
  }

  private async fill(request: ControlRequest): Promise<ControlResponse> {
    const fields = request.fields;
    if (!Array.isArray(fields)) return error('fields must be an array');
    const completed: string[] = [];
    for (const field of fields) {
      if (field === null || typeof field !== 'object' || Array.isArray(field)) return error('each field must be an object');
      const item = field as Record<string, unknown>;
      const target = item.target as Target;
      const selected = locator(this.page as Page, target);
      await withAgentGuard(this.page as Page, async () => {
        if (typeof item.filePath === 'string') await selected.setInputFiles(item.filePath, { timeout: this.config.actionTimeoutMs });
        else if (item.select === true && typeof item.value === 'string') await selected.selectOption(item.value, { timeout: this.config.actionTimeoutMs });
        else if (typeof item.checked === 'boolean') await selected.setChecked(item.checked, { timeout: this.config.actionTimeoutMs });
        else if (typeof item.value === 'string') await selected.fill(item.value, { timeout: this.config.actionTimeoutMs });
        else throw new Error('field requires value, checked, or filePath');
      });
      completed.push(targetDescription(target));
    }
    return success('fill', { fields: completed });
  }

  private async wait(ms: number): Promise<void> { await new Promise((resolve) => setTimeout(resolve, ms)); }
}
