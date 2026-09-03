export type FrameSelector = {
  url?: string;
  name?: string;
};

export type FrameCandidate<T> = {
  value: T;
  url: string;
  name: string;
};

export class FrameTargetError extends Error {
  constructor(
    readonly code: 'frame_not_found' | 'ambiguous_frame',
    readonly candidates: Array<{ url: string; name: string }>,
  ) {
    super(code);
  }
}

function validateFrameSelector(selector: FrameSelector): void {
  if (selector.url === undefined && selector.name === undefined) throw new Error('frame selector requires url or name');
  if (selector.url !== undefined) {
    let parsed: URL;
    try { parsed = new URL(selector.url); }
    catch { throw new Error('frame url must be an absolute URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('frame url must be an http or https URL');
  }
  if (selector.name !== undefined && selector.name === '') throw new Error('frame name must not be empty');
}

export function selectFrame<T>(candidates: FrameCandidate<T>[], selector: FrameSelector): T {
  validateFrameSelector(selector);
  const matches = candidates.filter((candidate) => {
    const urlMatches = selector.url === undefined || frameUrlMatches(candidate.url, selector.url);
    const nameMatches = selector.name === undefined || candidate.name === selector.name;
    return urlMatches && nameMatches;
  });
  if (matches.length === 0) throw new FrameTargetError('frame_not_found', candidates.slice(0, 20));
  if (matches.length > 1) throw new FrameTargetError('ambiguous_frame', matches.slice(0, 20));
  return matches[0]!.value;
}

function frameUrlMatches(candidateUrl: string, selectorUrl: string): boolean {
  let candidate: URL;
  let selector: URL;
  try {
    candidate = new URL(candidateUrl);
    selector = new URL(selectorUrl);
  } catch {
    return false;
  }
  if (candidate.protocol !== selector.protocol || candidate.origin !== selector.origin) return false;
  if (!candidate.href.startsWith(selector.href)) return false;
  const next = candidate.href[selector.href.length];
  return selector.href.endsWith('/') || next === undefined || next === '/' || next === '?' || next === '#';
}
