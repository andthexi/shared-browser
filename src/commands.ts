const usageMessage = 'usage: shared-browser <start [--local]|stop|status|logs|list-tabs|list-unbound-tabs|open-url|inspect|click|fill|close-tab|rebind-tab>';

function required(args: string[], index: number): string {
  const value = args[index];
  if (value === undefined || value === '') throw new Error(usageMessage);
  return value;
}

export function commandPayload(args: string[]): Record<string, unknown> {
  const command = required(args, 0);
  if (command === 'start') return { op: 'start', local: args.includes('--local') };
  if (['status', 'stop', 'list-tabs', 'list-unbound-tabs'].includes(command)) return { op: command };
  if (command === 'logs') {
    const payload: Record<string, unknown> = { op: 'logs' };
    for (let index = 1; index < args.length; index += 1) {
      if (args[index] === '--follow') payload.follow = true;
      else if (args[index] === '--tail') payload.tail = Number(required(args, index += 1));
      else throw new Error(usageMessage);
    }
    return payload;
  }
  if (command === 'open-url') return { op: command, tabId: required(args, 1), url: required(args, 2) };
  if (command === 'inspect' || command === 'close-tab') return { op: command, tabId: required(args, 1) };
  if (command === 'click') return {
    op: command,
    tabId: required(args, 1),
    expectedOrigin: required(args, 2),
    target: JSON.parse(required(args, 3)) as unknown,
  };
  if (command === 'fill') return {
    op: command,
    tabId: required(args, 1),
    expectedOrigin: required(args, 2),
    fields: JSON.parse(required(args, 3)) as unknown,
  };
  if (command === 'rebind-tab') return {
    op: command,
    tabId: required(args, 1),
    pageHandle: required(args, 2),
    expectedOrigin: required(args, 3),
    expectedEmployer: required(args, 4),
    expectedRole: required(args, 5),
    expectedFormIdentity: required(args, 6),
  };
  throw new Error(usageMessage);
}

export function usage(): string { return usageMessage; }
