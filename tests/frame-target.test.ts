import { describe, expect, it } from 'vitest';

import { selectFrame, type FrameCandidate } from '../src/frame-target.js';

type Candidate = FrameCandidate<string>;

const frames: Candidate[] = [
  { value: 'checkout', url: 'https://payments.example.com/checkout', name: 'payment-frame' },
  { value: 'nested', url: 'https://payments.example.com/checkout/card', name: 'card-frame' },
  { value: 'other', url: 'https://other.example.com/widget', name: 'other-frame' },
];

describe('frame target selection', () => {
  it('matches URL prefixes only within the exact origin', () => {
    expect(selectFrame(frames, { url: 'https://payments.example.com/checkout/' })).toBe('nested');
    expect(() => selectFrame(frames, { url: 'https://payments.example.com/checkout' })).toThrow('ambiguous_frame');
    expect(() => selectFrame([{ value: 'other', url: 'https://payments.example.com/checkout-old', name: 'other' }], { url: 'https://payments.example.com/checkout' })).toThrow('frame_not_found');
    expect(() => selectFrame(frames, { url: 'https://evil.example.com/' })).toThrow('frame_not_found');
  });

  it('requires exact frame names and supports combined URL/name selectors', () => {
    expect(selectFrame(frames, { name: 'payment-frame' })).toBe('checkout');
    expect(selectFrame(frames, { url: 'https://payments.example.com/', name: 'card-frame' })).toBe('nested');
    expect(() => selectFrame(frames, { name: 'payment' })).toThrow('frame_not_found');
  });

  it('includes candidate details for a failed frame selection', () => {
    try {
      selectFrame(frames, { name: 'missing' });
      throw new Error('expected frame_not_found');
    } catch (error) {
      expect(error).toMatchObject({ message: 'frame_not_found', candidates: frames });
    }
  });
  it('fails closed when a selector matches multiple frames', () => {
    const duplicateNames = frames.map((frame) => ({ ...frame, name: 'shared' }));
    expect(() => selectFrame(duplicateNames, { name: 'shared' })).toThrow('ambiguous_frame');
  });
});
