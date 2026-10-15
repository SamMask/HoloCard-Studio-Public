import { describe, expect, it } from 'vitest';
import { hashBytes } from '../../src/images/hash';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('hashBytes', () => {
  it('"abc" 的 SHA-256 前 16 碼（已知向量）', async () => {
    // 完整：ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(await hashBytes(utf8('abc'))).toBe('ba7816bf8f01cfea');
  });

  it('空內容的 SHA-256 前 16 碼', async () => {
    // 完整：e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(await hashBytes(new Uint8Array(0))).toBe('e3b0c44298fc1c14');
    expect(await hashBytes(new ArrayBuffer(0))).toBe('e3b0c44298fc1c14');
  });

  it('Uint8Array 與 ArrayBuffer 結果一致', async () => {
    const bytes = utf8('abc');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(await hashBytes(buffer)).toBe(await hashBytes(bytes));
  });

  it('Uint8Array 只是大 buffer 的一小段時，只算那一段', async () => {
    const big = new Uint8Array([1, 2, 3, 97, 98, 99, 4, 5]);
    const view = big.subarray(3, 6); // "abc"
    expect(await hashBytes(view)).toBe('ba7816bf8f01cfea');
  });

  it('回傳 16 碼小寫十六進位', async () => {
    const h = await hashBytes(utf8('HoloCard'));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('不同內容雜湊不同', async () => {
    expect(await hashBytes(utf8('a'))).not.toBe(await hashBytes(utf8('b')));
  });
});
