// 從檔頭讀圖片格式、長寬、有沒有宣告透明（不解碼）。SCHEMA §4 第 4 條、T-402。
import { describe, expect, it } from 'vitest';
import { readImageHeader } from '../src/file/image-header';
import { ascii, concat, makePng, makeWebp, pngChunk, repeat, riff, riffChunk, u32be, u32le, vp8, vp8l, vp8x, withPngChunks } from './file-fixtures';

describe('readImageHeader：PNG', () => {
  it('讀出長寬與類型', () => {
    expect(readImageHeader(makePng({ width: 300, height: 2048, colorType: 2 }))).toEqual({
      type: 'image/png',
      width: 300,
      height: 2048,
      hasAlpha: false,
    });
  });

  it('color type 4、6 有透明；0、2、3 沒有', () => {
    expect(readImageHeader(makePng({ colorType: 6 }))?.hasAlpha).toBe(true);
    expect(readImageHeader(makePng({ colorType: 4 }))?.hasAlpha).toBe(true);
    expect(readImageHeader(makePng({ colorType: 0 }))?.hasAlpha).toBe(false);
    expect(readImageHeader(makePng({ colorType: 2 }))?.hasAlpha).toBe(false);
    expect(readImageHeader(makePng({ colorType: 3 }))?.hasAlpha).toBe(false);
  });

  it('有 tRNS 區塊就算有透明（調色盤、RGB 都一樣）', () => {
    expect(readImageHeader(makePng({ colorType: 3, trns: true }))?.hasAlpha).toBe(true);
    expect(readImageHeader(makePng({ colorType: 2, trns: true }))?.hasAlpha).toBe(true);
  });

  it('很大的長寬照實讀出（由呼叫端判斷上限），不會變成負數', () => {
    const header = readImageHeader(makePng({ width: 0xffffffff, height: 3000 }));
    expect(header?.width).toBe(0xffffffff);
    expect(header?.height).toBe(3000);
  });

  it('簽名不對、IHDR 不在第一個、長度不是 13、不合法的 color type → null', () => {
    const png = makePng();
    const badSignature = png.slice();
    badSignature[1] = 0x51;
    expect(readImageHeader(badSignature)).toBeNull();

    const notIhdr = png.slice();
    notIhdr.set(ascii('IHDQ'), 12);
    expect(readImageHeader(notIhdr)).toBeNull();

    const badLength = png.slice();
    badLength.set(u32be(14), 8);
    expect(readImageHeader(badLength)).toBeNull();

    const badColor = png.slice();
    badColor[25] = 5;
    expect(readImageHeader(badColor)).toBeNull();
  });

  it('只有簽名、IHDR 被截斷 → null', () => {
    const png = makePng();
    expect(readImageHeader(png.slice(0, 8))).toBeNull();
    expect(readImageHeader(png.slice(0, 30))).toBeNull();
  });

  it('區塊長度造假（超大）不會當掉，照樣回答', () => {
    const png = makePng({ colorType: 2 });
    // IHDR 之後接一個宣告 4GB 的區塊
    const evil = concat([png.subarray(0, 33), u32be(0xfffffff0), ascii('teXt'), [1, 2, 3]]);
    expect(readImageHeader(evil)).toEqual({ type: 'image/png', width: 4, height: 4, hasAlpha: false });
  });
});

describe('readImageHeader：PNG 檔頭掃描（T-406）', () => {
  const actl = pngChunk('acTL', concat([u32be(2), u32be(0)]));
  const filler = pngChunk('aaAa', []);

  it.each([6, 2, 4, 0] as const)('有 acTL 區塊（動畫 PNG）→ null（color type %i，透明的也要掃）', (colorType) => {
    expect(readImageHeader(makePng({ colorType }))).not.toBeNull();
    expect(readImageHeader(withPngChunks(makePng({ colorType }), actl))).toBeNull();
  });

  it('acTL 排在別的區塊後面也看得到', () => {
    expect(readImageHeader(withPngChunks(makePng({ colorType: 6 }), filler, filler, actl))).toBeNull();
  });

  it('acTL 寫在 IDAT 之後不算（規格上 acTL 一定在 IDAT 之前）', () => {
    const png = makePng({ colorType: 6 });
    const iend = png.length - 12;
    expect(readImageHeader(concat([png.subarray(0, iend), actl, png.subarray(iend)]))).not.toBeNull();
  });

  it('IHDR 之後最多看 64 個區塊（含停下來的 IDAT）：63 個空區塊＋IDAT 可以，64 個就拒絕', () => {
    for (const colorType of [2, 6] as const) {
      expect(readImageHeader(withPngChunks(makePng({ colorType }), repeat(filler, 63))), `color type ${colorType}`).not.toBeNull();
      expect(readImageHeader(withPngChunks(makePng({ colorType }), repeat(filler, 64))), `color type ${colorType}`).toBeNull();
    }
  });

  it('幾百萬個空區塊 → null（color type 6 也一樣）', () => {
    for (const colorType of [2, 6] as const) {
      const bomb = withPngChunks(makePng({ colorType }), repeat(filler, 2_000_000));
      expect(readImageHeader(bomb), `color type ${colorType}`).toBeNull();
    }
  });

  it('上限之內的 tRNS 照樣算有透明', () => {
    const png = withPngChunks(makePng({ colorType: 2 }), repeat(filler, 10), pngChunk('tRNS', [0]));
    expect(readImageHeader(png)?.hasAlpha).toBe(true);
  });
});

describe('readImageHeader：WebP', () => {
  it('VP8（有損）：長寬、沒有透明', () => {
    expect(readImageHeader(makeWebp({ kind: 'lossy', width: 1000, height: 1400 }))).toEqual({
      type: 'image/webp',
      width: 1000,
      height: 1400,
      hasAlpha: false,
    });
  });

  it('VP8 不是關鍵幀、起始碼不對 → null', () => {
    const notKey = vp8(4, 4);
    notKey[0] |= 1;
    expect(readImageHeader(riff(riffChunk('VP8 ', notKey)))).toBeNull();
    const badStart = vp8(4, 4);
    badStart[4] = 0x02;
    expect(readImageHeader(riff(riffChunk('VP8 ', badStart)))).toBeNull();
  });

  it('VP8L（無損）：alpha 位元決定透明', () => {
    expect(readImageHeader(makeWebp({ kind: 'lossless', width: 2048, height: 17, alpha: true }))).toEqual({
      type: 'image/webp',
      width: 2048,
      height: 17,
      hasAlpha: true,
    });
    expect(readImageHeader(makeWebp({ kind: 'lossless', alpha: false }))?.hasAlpha).toBe(false);
  });

  it('VP8L 簽名不對、版本不是 0 → null', () => {
    const badSig = vp8l(4, 4, true);
    badSig[0] = 0x2e;
    expect(readImageHeader(riff(riffChunk('VP8L', badSig)))).toBeNull();
    expect(readImageHeader(riff(riffChunk('VP8L', vp8l(4, 4, true, 0, 1))))).toBeNull();
  });

  it('VP8X（延伸）：畫布長寬、alpha 旗標決定透明', () => {
    expect(readImageHeader(makeWebp({ kind: 'extended', width: 1500, height: 2000, alpha: true }))).toEqual({
      type: 'image/webp',
      width: 1500,
      height: 2000,
      hasAlpha: true,
    });
    expect(readImageHeader(makeWebp({ kind: 'extended', alpha: false }))?.hasAlpha).toBe(false);
    expect(readImageHeader(makeWebp({ kind: 'extended', alpha: true, inner: 'lossless' }))?.hasAlpha).toBe(true);
  });

  it('VP8X 畫布很大（24 位元）照實讀出', () => {
    expect(readImageHeader(makeWebp({ kind: 'extended', width: 5000, height: 5000 }))?.width).toBe(5000);
  });

  it('VP8X 畫布和內層圖的長寬不同 → null（不讓小畫布藏大圖）', () => {
    expect(readImageHeader(makeWebp({ kind: 'extended', width: 100, height: 100, innerWidth: 4000, innerHeight: 100 }))).toBeNull();
    expect(
      readImageHeader(makeWebp({ kind: 'extended', width: 100, height: 100, inner: 'lossless', innerWidth: 100, innerHeight: 3000 })),
    ).toBeNull();
  });

  it('VP8X 動畫、沒有內層圖 → null', () => {
    expect(readImageHeader(makeWebp({ kind: 'extended', animated: true }))).toBeNull();
    expect(readImageHeader(makeWebp({ kind: 'extended', noInner: true }))).toBeNull();
  });

  it('RIFF 大小或區塊大小超出檔案 → null', () => {
    const webp = makeWebp();
    const riffTooBig = webp.slice();
    riffTooBig.set(u32le(webp.length), 4);
    expect(readImageHeader(riffTooBig)).toBeNull();

    const chunkTooBig = webp.slice();
    chunkTooBig.set(u32le(1000), 16);
    expect(readImageHeader(chunkTooBig)).toBeNull();
  });

  it('不認得的第一個區塊、被截斷 → null', () => {
    expect(readImageHeader(riff(riffChunk('VP9 ', vp8(4, 4))))).toBeNull();
    expect(readImageHeader(makeWebp().slice(0, 25))).toBeNull();
  });
});

describe('readImageHeader：WebP 檔頭掃描（T-406）', () => {
  const junk = riffChunk('JUNK', []);

  it('VP8X 之後出現 ANIM／ANMF 區塊（動畫旗標沒開也一樣）→ null', () => {
    for (const type of ['ANIM', 'ANMF']) {
      const webp = riff(concat([vp8x(0x10, 4, 4), riffChunk(type, [0, 0, 0, 0, 0, 0]), riffChunk('VP8 ', vp8(4, 4))]));
      expect(readImageHeader(webp), type).toBeNull();
    }
    // 對照組：沒有 ANIM／ANMF 就讀得出來
    expect(readImageHeader(riff(concat([vp8x(0x10, 4, 4), riffChunk('VP8 ', vp8(4, 4))])))).not.toBeNull();
  });

  it('VP8X 區塊資料不到 10 位元組 → null（不讓後面的位元組被當成長寬）', () => {
    // 資料 9 位元組＋1 個補齊位元組：沒有長度檢查的話，高會讀到補齊位元組而剛好變成 4
    const short = riffChunk('VP8X', [0, 0, 0, 0, 3, 0, 0, 3, 0]);
    expect(readImageHeader(riff(concat([short, riffChunk('VP8 ', vp8(4, 4))])))).toBeNull();
    expect(readImageHeader(riff(concat([riffChunk('VP8X', []), riffChunk('VP8 ', vp8(4, 4))])))).toBeNull();
  });

  it('VP8X 之後最多看 64 個區塊（含停下來的圖）：63 個空區塊可以，64 個就拒絕', () => {
    const make = (n: number): Uint8Array => riff(concat([vp8x(0x10, 4, 4), repeat(junk, n), riffChunk('VP8 ', vp8(4, 4))]));
    expect(readImageHeader(make(63))).not.toBeNull();
    expect(readImageHeader(make(64))).toBeNull();
  });

  it('幾百萬個空區塊 → null', () => {
    const bomb = riff(concat([vp8x(0x10, 4, 4), repeat(junk, 3_000_000), riffChunk('VP8 ', vp8(4, 4))]));
    expect(readImageHeader(bomb)).toBeNull();
  });
});

describe('readImageHeader：其他', () => {
  it('JPEG、GIF、文字、空的 → null', () => {
    expect(readImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]))).toBeNull();
    expect(readImageHeader(new Uint8Array(ascii('GIF89a\x04\x00\x04\x00\x00\x00\x00;')))).toBeNull();
    expect(readImageHeader(new Uint8Array(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBeNull();
    expect(readImageHeader(new Uint8Array(0))).toBeNull();
  });

  it('RIFF 但不是 WEBP（例如 WAVE）→ null', () => {
    const wave = makeWebp().slice();
    wave.set(ascii('WAVE'), 8);
    expect(readImageHeader(wave)).toBeNull();
  });

  it('多餘的區塊（ICCP、EXIF）在 VP8X 與內層圖之間 → 照樣讀', () => {
    const header = riffChunk('VP8X', [0x30, 0, 0, 0, 3, 0, 0, 3, 0, 0]);
    const webp = riff(concat([header, riffChunk('ICCP', [1, 2, 3]), riffChunk('ALPH', [0]), riffChunk('VP8 ', vp8(4, 4))]));
    expect(readImageHeader(webp)).toEqual({ type: 'image/webp', width: 4, height: 4, hasAlpha: true });
  });

  it('PNG 的 tRNS 寫在 IDAT 之後不算（規格上 tRNS 一定在 IDAT 之前）', () => {
    const png = makePng({ colorType: 2 });
    const iend = png.length - 12;
    const late = concat([png.subarray(0, iend), pngChunk('tRNS', [0]), png.subarray(iend)]);
    expect(readImageHeader(late)?.hasAlpha).toBe(false);
  });
});
