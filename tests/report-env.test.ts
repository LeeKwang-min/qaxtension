import { describe, it, expect } from 'vitest';
import { parseCookies } from '../src/report/env';

describe('parseCookies', () => {
  it('returns [] for empty string', () => {
    expect(parseCookies('')).toEqual([]);
    expect(parseCookies('   ')).toEqual([]);
  });
  it('parses a single pair', () => {
    expect(parseCookies('token=abc')).toEqual([{ key: 'token', value: 'abc' }]);
  });
  it('parses multiple "; "-separated pairs', () => {
    expect(parseCookies('a=1; b=2; theme=dark')).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'theme', value: 'dark' },
    ]);
  });
  it('keeps "=" inside the value (splits on first only)', () => {
    expect(parseCookies('jwt=ab=cd=ef')).toEqual([{ key: 'jwt', value: 'ab=cd=ef' }]);
  });
  it('handles empty values and skips malformed segments', () => {
    expect(parseCookies('empty=; =novalue; valid=ok')).toEqual([
      { key: 'empty', value: '' },
      { key: 'valid', value: 'ok' },
    ]);
  });
});
