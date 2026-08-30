export const MAX_TAB_ID_LENGTH = 128;

export interface TabPage {
  readonly handle: string;
  url(): string;
  goto(url: string): Promise<unknown>;
  title(): Promise<string>;
  close(): Promise<void>;
  bringToFront(): Promise<void>;
  inspectIdentity(): Promise<{
    title: string;
    text: string;
    forms: Array<{ id: string; name: string; action: string; ariaLabel: string; text: string }>;
  }>;
}

export type TabFailure = {
  ok: false;
  error: 'invalid_tab_id' | 'tab_not_found' | 'tab_conflict' | 'invalid_rebind'
    | 'unbound_tab_not_found' | 'rebind_mismatch' | 'ambiguous_rebind';
  [key: string]: unknown;
};

export type TabSuccess<T extends object = object> = { ok: true } & T;
export type TabResult<T extends object = object> = TabSuccess<T> | TabFailure;

type BoundTab = { page: TabPage };

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}

function validTabId(tabId: unknown): tabId is string {
  return typeof tabId === 'string'
    && tabId.length >= 1
    && tabId.length <= MAX_TAB_ID_LENGTH
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(tabId);
}

function normalizedHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function origin(value: string): string | undefined {
  try { return new URL(value).origin; } catch { return undefined; }
}

export class OpportunityTabs {
  private readonly bound = new Map<string, BoundTab>();
  private readonly locks = new Map<string, Mutex>();

  constructor(
    private readonly unbound: TabPage[],
    private readonly createPage: () => Promise<TabPage>,
  ) {}

  async open(tabIdValue: unknown, urlValue: unknown): Promise<TabResult<{ tabId: string; pageHandle: string; url: string; title: string; reused: boolean }>> {
    if (!validTabId(tabIdValue)) return { ok: false, error: 'invalid_tab_id' };
    const tabId = tabIdValue;
    const url = normalizedHttpUrl(urlValue);
    if (url === undefined) return { ok: false, error: 'tab_conflict', tabId, reason: 'url must be an http or https URL' };
    return this.lock(tabId).run(async () => {
      const existing = this.bound.get(tabId);
      if (existing !== undefined) {
        const currentUrl = existing.page.url();
        if (currentUrl !== url) return { ok: false, error: 'tab_conflict', tabId, url: currentUrl };
        return { ok: true, reused: true, tabId, pageHandle: existing.page.handle, url: currentUrl, title: await existing.page.title() };
      }
      const page = await this.createPage();
      try {
        await page.goto(url);
      } catch (cause) {
        await page.close().catch(() => undefined);
        throw cause;
      }
      this.bound.set(tabId, { page });
      return { ok: true, reused: false, tabId, pageHandle: page.handle, url: page.url(), title: await page.title() };
    });
  }

  async list(): Promise<Array<{ tabId: string; pageHandle: string; url: string; title: string }>> {
    return Promise.all([...this.bound.entries()].map(async ([tabId, { page }]) => ({
      tabId,
      pageHandle: page.handle,
      url: page.url(),
      title: await page.title().catch(() => ''),
    })));
  }

  async listUnbound(): Promise<Array<{ pageHandle: string; url: string; title: string }>> {
    return Promise.all(this.unbound.map(async (page) => ({
      pageHandle: page.handle,
      url: page.url(),
      title: await page.title().catch(() => ''),
    })));
  }

  async rebind(request: Record<string, unknown>): Promise<TabResult<{ tabId: string; pageHandle: string; url: string; title: string }>> {
    const { tabId: tabIdValue, pageHandle, expectedOrigin, expectedEmployer, expectedRole, expectedFormIdentity } = request;
    if (!validTabId(tabIdValue)) return { ok: false, error: 'invalid_tab_id' };
    const tabId = tabIdValue;
    if (![pageHandle, expectedOrigin, expectedEmployer, expectedRole, expectedFormIdentity]
      .every((value) => typeof value === 'string' && value.length > 0)) {
      return { ok: false, error: 'invalid_rebind', tabId };
    }
    if (origin(expectedOrigin as string) !== expectedOrigin) return { ok: false, error: 'invalid_rebind', tabId };
    return this.lock(tabId).run(async () => {
      if (this.bound.has(tabId)) return { ok: false, error: 'tab_conflict', tabId };
      const index = this.unbound.findIndex((page) => page.handle === pageHandle);
      if (index < 0) return { ok: false, error: 'unbound_tab_not_found', tabId, pageHandle };
      const page = this.unbound[index] as TabPage;
      const actualOrigin = origin(page.url());
      const inspected = await page.inspectIdentity();
      const documentText = `${inspected.title}\n${inspected.text}`.toLocaleLowerCase();
      const employerMatches = documentText.includes((expectedEmployer as string).toLocaleLowerCase());
      const roleMatches = documentText.includes((expectedRole as string).toLocaleLowerCase());
      const identity = (expectedFormIdentity as string).toLocaleLowerCase();
      const formMatches = inspected.forms.filter((form) =>
        [form.id, form.name, form.action, form.ariaLabel, form.text]
          .some((value) => value.toLocaleLowerCase().includes(identity)));
      if (actualOrigin !== expectedOrigin || !employerMatches || !roleMatches || formMatches.length === 0) {
        return { ok: false, error: 'rebind_mismatch', tabId, pageHandle };
      }
      if (formMatches.length !== 1) return { ok: false, error: 'ambiguous_rebind', tabId, pageHandle };
      this.bound.set(tabId, { page });
      this.unbound.splice(index, 1);
      return { ok: true, tabId, pageHandle: page.handle, url: page.url(), title: inspected.title };
    });
  }

  async close(tabIdValue: unknown): Promise<TabResult<{ tabId: string }>> {
    if (!validTabId(tabIdValue)) return { ok: false, error: 'invalid_tab_id' };
    const tabId = tabIdValue;
    return this.lock(tabId).run(async () => {
      const entry = this.bound.get(tabId);
      if (entry === undefined) return { ok: false, error: 'tab_not_found', tabId };
      await entry.page.close();
      this.bound.delete(tabId);
      return { ok: true, tabId };
    });
  }

  async require(tabIdValue: unknown, expectedOrigin?: unknown): Promise<TabResult<{ tabId: string; page: TabPage }>> {
    if (!validTabId(tabIdValue)) return { ok: false, error: 'invalid_tab_id' };
    const tabId = tabIdValue;
    const entry = this.bound.get(tabId);
    if (entry === undefined) return { ok: false, error: 'tab_not_found', tabId };
    if (expectedOrigin !== undefined) {
      if (typeof expectedOrigin !== 'string' || origin(expectedOrigin) !== expectedOrigin) {
        return { ok: false, error: 'tab_conflict', tabId, reason: 'expectedOrigin must be an exact http or https origin' };
      }
      const actualOrigin = origin(entry.page.url());
      if (actualOrigin !== expectedOrigin) return { ok: false, error: 'tab_conflict', tabId, expectedOrigin, actualOrigin };
    }
    return { ok: true, tabId, page: entry.page };
  }

  async run<T>(tabIdValue: unknown, expectedOrigin: unknown, action: (page: TabPage) => Promise<T>): Promise<TabResult<{ value: T }>> {
    if (!validTabId(tabIdValue)) return { ok: false, error: 'invalid_tab_id' };
    const tabId = tabIdValue;
    return this.lock(tabId).run(async () => {
      const result = await this.require(tabId, expectedOrigin);
      if (!result.ok) return result;
      await result.page.bringToFront();
      return { ok: true, value: await action(result.page) };
    });
  }

  private lock(tabId: string): Mutex {
    let lock = this.locks.get(tabId);
    if (lock === undefined) {
      lock = new Mutex();
      this.locks.set(tabId, lock);
    }
    return lock;
  }
}
