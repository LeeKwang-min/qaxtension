import { describe, it, expect } from 'vitest';
import { crc32, buildZip } from '../src/report/zip';

const enc = new TextEncoder();

describe('crc32', () => {
  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it('matches the known vector for "123456789" (0xCBF43926)', () => {
    expect(crc32(enc.encode('123456789')) >>> 0).toBe(0xcbf43926);
  });
  it('matches the known vector for "The quick brown fox jumps over the lazy dog"', () => {
    expect(crc32(enc.encode('The quick brown fox jumps over the lazy dog')) >>> 0).toBe(0x414fa339);
  });
});

function u16(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8);
}

describe('buildZip', () => {
  it('starts with a local file header signature PK\\x03\\x04', () => {
    const zip = buildZip([{ name: 'a.txt', bytes: enc.encode('hi') }]);
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('ends with an EOCD record whose entry count matches file count', () => {
    const zip = buildZip([
      { name: 'report.md', bytes: enc.encode('# report') },
      { name: 'screenshot.png', bytes: new Uint8Array([1, 2, 3, 4]) },
    ]);
    // EOCD 시그니처(PK\x05\x06)를 뒤에서부터 탐색 (코멘트 없음 → 마지막 22바이트)
    const eocd = zip.length - 22;
    expect([zip[eocd], zip[eocd + 1], zip[eocd + 2], zip[eocd + 3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(u16(zip, eocd + 8)).toBe(2); // 총 엔트리 수
    expect(u16(zip, eocd + 10)).toBe(2);
  });

  it('contains the UTF-8 encoded file name in the local header', () => {
    const zip = buildZip([{ name: 'résumé.txt', bytes: enc.encode('x') }]);
    const nameBytes = enc.encode('résumé.txt');
    // local header name 은 offset 30 부터
    const slice = zip.slice(30, 30 + nameBytes.length);
    expect(Array.from(slice)).toEqual(Array.from(nameBytes));
  });

  it('handles an empty file list (valid empty archive)', () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22); // EOCD only
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it('stores data uncompressed (method 0) with correct sizes', () => {
    const data = enc.encode('hello world');
    const zip = buildZip([{ name: 'a', bytes: data }]);
    // local header: method @8 (2B), crc @14, compSize @18, uncompSize @22
    expect(u16(zip, 8)).toBe(0); // store
    const compSize = zip[18] | (zip[19] << 8) | (zip[20] << 16) | (zip[21] << 24);
    const uncompSize = zip[22] | (zip[23] << 8) | (zip[24] << 16) | (zip[25] << 24);
    expect(compSize).toBe(data.length);
    expect(uncompSize).toBe(data.length);
  });
});
