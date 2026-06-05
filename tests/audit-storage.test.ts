import { describe, it, expect } from 'vitest';
import { toStorageEntries, maskIfSensitive } from '../src/audit/storage';

describe('maskIfSensitive', () => {
  it('masks values for sensitive-looking keys', () => {
    for (const k of ['token', 'accessToken', 'password', 'api_key', 'authorization', 'jwt', 'secret', 'sessionId']) {
      expect(maskIfSensitive(k, 'verysecretvalue').masked).toBe(true);
    }
  });

  it('leaves ordinary keys untouched', () => {
    const r = maskIfSensitive('theme', 'dark');
    expect(r.masked).toBe(false);
    expect(r.value).toBe('dark');
  });

  it('masked value does not expose the original secret', () => {
    const r = maskIfSensitive('token', 'abcdef123456');
    expect(r.value).not.toContain('abcdef123456');
  });
});

describe('toStorageEntries', () => {
  it('sorts localStorage by key', () => {
    const view = toStorageEntries(
      [
        { key: 'zebra', value: '1' },
        { key: 'apple', value: '2' },
      ],
      [],
    );
    expect(view.local.map((e) => e.key)).toEqual(['apple', 'zebra']);
  });

  it('maps cookies preserving httpOnly/secure and masking sensitive names', () => {
    const view = toStorageEntries(
      [],
      [
        { name: 'sessionId', value: 'aaaaaaaa', domain: '.x.test', path: '/', httpOnly: true, secure: true },
        { name: 'lang', value: 'ko', domain: '.x.test', path: '/', httpOnly: false, secure: false },
      ],
    );
    const session = view.cookies.find((c) => c.name === 'sessionId')!;
    expect(session.httpOnly).toBe(true);
    expect(session.secure).toBe(true);
    expect(session.masked).toBe(true);
    expect(session.value).not.toContain('aaaaaaaa');
    const lang = view.cookies.find((c) => c.name === 'lang')!;
    expect(lang.masked).toBe(false);
    expect(lang.value).toBe('ko');
  });

  it('sorts cookies by name', () => {
    const view = toStorageEntries(
      [],
      [
        { name: 'b', value: '1', domain: 'x', path: '/', httpOnly: false, secure: false },
        { name: 'a', value: '2', domain: 'x', path: '/', httpOnly: false, secure: false },
      ],
    );
    expect(view.cookies.map((c) => c.name)).toEqual(['a', 'b']);
  });
});
