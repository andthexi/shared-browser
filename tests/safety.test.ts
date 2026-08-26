import { describe, expect, it } from 'vitest';

import { classifyClickSafety } from '../src/safety.js';

describe('click safety', () => {
  it('allows explicit non-submit controls', () => {
    expect(classifyClickSafety({ tagName: 'BUTTON', type: 'button', insideForm: true, accessibleName: 'Show form' })).toEqual({ ok: true });
    expect(classifyClickSafety({ tagName: 'A', type: '', insideForm: true, accessibleName: 'Next page' })).toEqual({ ok: true });
  });

  it('rejects submit-like and ambiguous controls', () => {
    expect(classifyClickSafety({ tagName: 'BUTTON', type: 'submit', insideForm: true, accessibleName: 'Continue' })).toMatchObject({ ok: false });
    expect(classifyClickSafety({ tagName: 'BUTTON', type: '', insideForm: true, accessibleName: 'Open' })).toMatchObject({ ok: false });
    expect(classifyClickSafety({ tagName: 'BUTTON', type: 'button', insideForm: false, accessibleName: 'Submit application' })).toMatchObject({ ok: false });
  });
});
