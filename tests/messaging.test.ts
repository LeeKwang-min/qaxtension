import { describe, it, expect } from 'vitest';
import {
  isInjectEnvelope,
  isCmdEnvelope,
  INJECT_SOURCE,
  CMD_SOURCE,
} from '../src/messaging';

describe('envelope guards', () => {
  it('accepts a valid inject envelope', () => {
    expect(
      isInjectEnvelope({ source: INJECT_SOURCE, payload: { type: 'INJECT_READY' } }),
    ).toBe(true);
  });

  it('rejects foreign or malformed messages', () => {
    expect(isInjectEnvelope({ source: 'other' })).toBe(false);
    expect(isInjectEnvelope(null)).toBe(false);
    expect(isInjectEnvelope('x')).toBe(false);
    expect(isInjectEnvelope({ source: INJECT_SOURCE })).toBe(false); // missing payload
    expect(isInjectEnvelope({ source: INJECT_SOURCE, payload: null })).toBe(false); // null payload
  });

  it('distinguishes a cmd envelope from an inject envelope', () => {
    expect(
      isCmdEnvelope({ source: CMD_SOURCE, payload: { type: 'PING', nonce: 'a' } }),
    ).toBe(true);
    expect(isCmdEnvelope({ source: INJECT_SOURCE, payload: { type: 'INJECT_READY' } })).toBe(false);
  });
});
