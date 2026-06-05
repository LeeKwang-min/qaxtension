// 의존성 없는 store-only(무압축) ZIP writer.
// PNG/마크다운 번들용. PNG 는 이미 압축돼 있어 deflate 이득이 작고,
// 무압축은 구현이 단순하고 결정적이라 단위 테스트가 쉽다.

/** CRC32 룩업 테이블 (지연 생성) */
let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

/** 표준 CRC-32 (IEEE 802.3). 부호 없는 32비트 값. */
export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = t[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFile {
  name: string;
  bytes: Uint8Array;
}

/** 가변 바이트 버퍼에 LE 정수/바이트를 순차 기록 */
class ByteWriter {
  private chunks: number[] = [];
  u16(v: number): void {
    this.chunks.push(v & 0xff, (v >>> 8) & 0xff);
  }
  u32(v: number): void {
    this.chunks.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }
  bytes(b: Uint8Array): void {
    for (let i = 0; i < b.length; i++) this.chunks.push(b[i]);
  }
  get length(): number {
    return this.chunks.length;
  }
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
// 일반 목적 플래그 비트 11: 파일명이 UTF-8 임을 표시
const FLAG_UTF8 = 0x0800;

/** ZipFile[] → store-only ZIP 아카이브 바이트 */
export function buildZip(files: ZipFile[]): Uint8Array {
  const enc = new TextEncoder();
  const out = new ByteWriter();
  const central = new ByteWriter();

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const size = f.bytes.length;
    const offset = out.length;

    // ── 로컬 파일 헤더 ──
    out.u32(LOCAL_SIG);
    out.u16(20); // version needed
    out.u16(FLAG_UTF8); // general purpose flag
    out.u16(0); // method 0 = store
    out.u16(0); // mod time
    out.u16(0); // mod date
    out.u32(crc);
    out.u32(size); // compressed size
    out.u32(size); // uncompressed size
    out.u16(name.length);
    out.u16(0); // extra len
    out.bytes(name);
    out.bytes(f.bytes);

    // ── 중앙 디렉터리 레코드 ──
    central.u32(CENTRAL_SIG);
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(FLAG_UTF8);
    central.u16(0); // method
    central.u16(0); // mod time
    central.u16(0); // mod date
    central.u32(crc);
    central.u32(size);
    central.u32(size);
    central.u16(name.length);
    central.u16(0); // extra len
    central.u16(0); // comment len
    central.u16(0); // disk number start
    central.u16(0); // internal attrs
    central.u32(0); // external attrs
    central.u32(offset); // local header offset
    central.bytes(name);
  }

  const cdOffset = out.length;
  const cdBytes = central.toUint8Array();
  out.bytes(cdBytes);

  // ── EOCD ──
  out.u32(EOCD_SIG);
  out.u16(0); // disk number
  out.u16(0); // cd start disk
  out.u16(files.length); // entries on this disk
  out.u16(files.length); // total entries
  out.u32(cdBytes.length); // cd size
  out.u32(cdOffset); // cd offset
  out.u16(0); // comment len

  return out.toUint8Array();
}
