// 讀不可信的 zip：中央目錄、本地檔頭、邊解邊數。上限用小數字測（實際的 SCHEMA 上限在 file-holocard.test.ts）。
import { Zip, ZipDeflate, ZipPassThrough, deflateSync, inflateSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ZipError, crc32, extractZip, listZip, type ZipLimits } from '../src/file/zip-read';
import { buildZip, concat, u16le, u32le, utf8, zeroBomb, zeroBombSize, type ZipItem } from './file-fixtures';

const SMALL: ZipLimits = { maxEntries: 5, maxEntryBytes: 1000, maxTotalBytes: 2500 };
const ROOMY: ZipLimits = { maxEntries: 50, maxEntryBytes: 1 << 24, maxTotalBytes: 1 << 26 };

/** 執行 fn，回傳丟出的 ZipError 的 reason；沒丟錯就回 'ok'。 */
function reasonOf(fn: () => unknown): string {
  try {
    fn();
    return 'ok';
  } catch (e) {
    if (e instanceof ZipError) return e.reason;
    throw e;
  }
}

/** 執行 fn，回傳丟出的 ZipError（沒丟錯就回 null）；要確認「是因為這個原因被擋」時看 message。 */
function errorOf(fn: () => unknown): ZipError | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof ZipError) return e;
    throw e;
  }
}

function readAll(zip: Uint8Array, limits: ZipLimits = ROOMY): Map<string, Uint8Array> {
  const listing = listZip(zip, limits);
  const contents = extractZip(zip, listing, limits);
  return new Map(listing.entries.map((e, i) => [e.name, contents[i]!]));
}

const bytes = (n: number, fill = 7): Uint8Array => new Uint8Array(n).fill(fill);

describe('crc32', () => {
  it('標準測試向量', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('測試工具本身', () => {
  it('zeroBomb 真的是合法的 DEFLATE、解出全 0', () => {
    const out = inflateSync(zeroBomb(10_000));
    expect(out.length).toBe(zeroBombSize(10_000));
    expect(out.every((b) => b === 0)).toBe(true);
  });

  it('buildZip 做的 zip 讀得回來', () => {
    const files = readAll(
      buildZip([
        { name: 'a.txt', data: utf8('hello') },
        { name: 'b.bin', data: bytes(300), method: 0 },
      ]),
    );
    expect(new TextDecoder().decode(files.get('a.txt'))).toBe('hello');
    expect(files.get('b.bin')).toEqual(bytes(300));
  });
});

describe('listZip／extractZip：正常的 zip', () => {
  it('fflate zipSync 的輸出（壓縮與不壓縮混合）', () => {
    const zip = zipSync({ 'card.json': [utf8('{"a":1}'), { level: 6 }], 'images/x.png': [bytes(500, 3), { level: 0 }] });
    const listing = listZip(zip, ROOMY);
    expect(listing.entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ['card.json', 8, 7],
      ['images/x.png', 0, 500],
    ]);
    const files = readAll(zip);
    expect(new TextDecoder().decode(files.get('card.json'))).toBe('{"a":1}');
    expect(files.get('images/x.png')).toEqual(bytes(500, 3));
  });

  it('串流寫出的 zip（大小寫在資料後面，本地檔頭是 0）', () => {
    const parts: Uint8Array[] = [];
    const zip = new Zip((err, chunk) => {
      if (err) throw err;
      parts.push(chunk);
    });
    const a = new ZipDeflate('card.json', { level: 6 });
    zip.add(a);
    a.push(utf8('{"b":2}'), true);
    const b = new ZipPassThrough('preview.png');
    zip.add(b);
    b.push(bytes(200, 9), true);
    zip.end();
    const files = readAll(concat(parts));
    expect(new TextDecoder().decode(files.get('card.json'))).toBe('{"b":2}');
    expect(files.get('preview.png')).toEqual(bytes(200, 9));
  });

  it('空的 zip（0 個檔）', () => {
    expect(listZip(zipSync({}), ROOMY).entries).toEqual([]);
  });

  it('檔名用原始位元組逐一轉字元（非 ASCII 不會變成別的 ASCII 名字）', () => {
    const listing = listZip(buildZip([{ name: utf8('card.jsoné'), data: utf8('x') }]), ROOMY);
    expect(listing.entries[0]!.name).toBe('card.jsonÃ©');
  });
});

describe('解壓前（只看中央目錄的宣告）', () => {
  it('檔案數超過上限 → too-large（不用讀每一筆）', () => {
    const items: ZipItem[] = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, data: bytes(1) }));
    expect(reasonOf(() => listZip(buildZip(items), SMALL))).toBe('too-large');
    expect(reasonOf(() => listZip(buildZip(items.slice(0, 5)), SMALL))).toBe('ok');
  });

  it('EOCD 宣告 65535 個檔 → too-large', () => {
    expect(reasonOf(() => listZip(buildZip([{ name: 'a', data: bytes(1) }], { count: 0xffff }), SMALL))).toBe('too-large');
  });

  it('單檔宣告大小超過上限 → too-large（剛好等於上限可以）', () => {
    expect(reasonOf(() => listZip(buildZip([{ name: 'a', data: bytes(1), size: 1001 }]), SMALL))).toBe('too-large');
    expect(reasonOf(() => listZip(buildZip([{ name: 'a', data: bytes(1), size: 1000 }]), SMALL))).toBe('ok');
  });

  it('宣告總量超過上限 → too-large', () => {
    const items: ZipItem[] = [0, 1, 2].map((i) => ({ name: `f${i}`, data: bytes(1), size: 900 }));
    expect(reasonOf(() => listZip(buildZip(items), SMALL))).toBe('too-large');
  });

  it('宣告 4GB（0xffffffff）→ too-large', () => {
    expect(reasonOf(() => listZip(buildZip([{ name: 'a', data: bytes(1), size: 0xffffffff }]), SMALL))).toBe('too-large');
  });
});

describe('解壓時一邊解一邊數（宣告的大小是假的）', () => {
  it('DEFLATE：宣告 10 位元組、實際 1 GB → 解到上限就停，too-large', () => {
    const bomb = zeroBomb(1 << 30);
    const zip = buildZip([{ name: 'a', compressed: bomb, size: 10, crc: 0 }]);
    const limits: ZipLimits = { maxEntries: 5, maxEntryBytes: 1 << 20, maxTotalBytes: 1 << 21 };
    const listing = listZip(zip, limits);
    const started = performance.now();
    expect(reasonOf(() => extractZip(zip, listing, limits))).toBe('too-large');
    // 1 GB 全解要好幾秒；解到 1 MB 就停只要一下子
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('DEFLATE：每個檔都沒超過、加起來超過總量 → too-large', () => {
    // 前兩個照實宣告 900，第三個宣告 10、實際 900：宣告總量 1810 沒超過，實際 2700 超過 2500
    const items: ZipItem[] = [0, 1, 2].map((i) => ({ name: `f${i}`, data: bytes(900, i), size: i === 2 ? 10 : 900 }));
    const zip = buildZip(items);
    expect(reasonOf(() => extractZip(zip, listZip(zip, SMALL), SMALL))).toBe('too-large');
  });

  it('不壓縮：宣告 10、實際 1200 → too-large', () => {
    const zip = buildZip([{ name: 'a', data: bytes(1200), method: 0, size: 10 }]);
    expect(reasonOf(() => extractZip(zip, listZip(zip, SMALL), SMALL))).toBe('too-large');
  });

  it('實際比宣告大但沒超過上限 → bad-zip（大小對不上＝壞掉）', () => {
    const zip = buildZip([{ name: 'a', data: bytes(500), size: 10 }]);
    expect(reasonOf(() => extractZip(zip, listZip(zip, SMALL), SMALL))).toBe('bad-zip');
  });

  it('實際比宣告小 → bad-zip', () => {
    const zip = buildZip([{ name: 'a', data: bytes(50), size: 60 }]);
    expect(reasonOf(() => extractZip(zip, listZip(zip, SMALL), SMALL))).toBe('bad-zip');
  });
});

describe('壞掉或不支援的 zip → bad-zip', () => {
  const good = (): Uint8Array<ArrayBuffer> => buildZip([{ name: 'card.json', data: utf8('{"a":1}') }]);
  const read = (zip: Uint8Array): string => reasonOf(() => readAll(zip));

  it('不是 zip、空的、太短', () => {
    expect(read(utf8('hello, this is not a zip file at all'))).toBe('bad-zip');
    expect(read(new Uint8Array(0))).toBe('bad-zip');
    expect(read(new Uint8Array(21))).toBe('bad-zip');
  });

  it('尾巴被截斷', () => {
    const zip = good();
    expect(read(zip.subarray(0, zip.length - 5))).toBe('bad-zip');
  });

  it('EOCD 之後多了東西（註解長度對不上）', () => {
    expect(read(buildZip([{ name: 'a', data: bytes(3) }], { trailing: bytes(4) }))).toBe('bad-zip');
  });

  it('分割壓縮檔', () => {
    expect(read(buildZip([{ name: 'a', data: bytes(3) }], { disk: 1 }))).toBe('bad-zip');
  });

  it('EOCD 的檔案數比實際的多', () => {
    expect(read(buildZip([{ name: 'a', data: bytes(3) }], { count: 2 }))).toBe('bad-zip');
  });

  it('中央目錄位置超出檔案', () => {
    const zip = good();
    zip.set(u32le(zip.length), zip.length - 6);
    expect(read(zip)).toBe('bad-zip');
  });

  it('加密的檔', () => {
    expect(read(buildZip([{ name: 'a', data: bytes(3), flags: 0x0801 }]))).toBe('bad-zip');
  });

  it('不支援的壓縮法（例如 12＝bzip2）', () => {
    expect(read(buildZip([{ name: 'a', data: bytes(3), method: 12, compressed: bytes(3) }]))).toBe('bad-zip');
  });

  it('DEFLATE 資料壞掉', () => {
    expect(read(buildZip([{ name: 'a', data: bytes(30), compressed: new Uint8Array([0xff, 0xff, 0xff, 0xff]) }]))).toBe('bad-zip');
  });

  it('DEFLATE 資料被截斷', () => {
    const data = utf8('x'.repeat(5000) + 'y'.repeat(5000));
    expect(read(buildZip([{ name: 'a', data, compressed: concat([[0x00, 0x00, 0x10, 0xff, 0xef], data.subarray(0, 100)]) }]))).toBe('bad-zip');
  });

  it('CRC 不符', () => {
    expect(read(buildZip([{ name: 'a', data: bytes(30), crc: 1234 }]))).toBe('bad-zip');
  });

  it('本地檔頭的檔名和中央目錄不同', () => {
    expect(read(buildZip([{ name: 'card.json', localName: 'evil.exe', data: utf8('{}') }]))).toBe('bad-zip');
  });

  it('本地檔頭的大小、CRC 和中央目錄不同（沒有 data descriptor 旗標時）', () => {
    for (const field of [14, 18, 22]) {
      const zip = buildZip([{ name: 'a', data: bytes(30) }]);
      zip[field] ^= 0x01;
      expect(read(zip), `local header offset ${field}`).toBe('bad-zip');
    }
  });

  it('本地檔頭位置不對（不是本地檔頭簽名）', () => {
    expect(read(buildZip([{ name: 'a', data: bytes(30), offset: 3 }]))).toBe('bad-zip');
  });

  it('兩個檔指到同一份資料（重疊）', () => {
    // 兩筆同名、內容一樣、都指到第 0 個位元組：本地檔頭的檔名與大小都對得上，只有「重疊」會擋
    const zip = buildZip([
      { name: 'a', data: bytes(30) },
      { name: 'a', data: bytes(30), offset: 0 },
    ]);
    expect(read(zip)).toBe('bad-zip');
  });

  it('壓縮後大小超出檔案範圍', () => {
    const zip = good();
    // 中央目錄第一筆的壓縮後大小（中央目錄起點＋20）
    const directory = zip.length - 22 - (46 + 'card.json'.length);
    zip.set(u32le(0x7fffffff), directory + 20);
    expect(read(zip)).toBe('bad-zip');
  });

  it('中央目錄簽名不對', () => {
    const zip = good();
    const directory = zip.length - 22 - (46 + 'card.json'.length);
    zip.set(u16le(0), directory);
    expect(read(zip)).toBe('bad-zip');
  });
});

describe('檔名長度上限（maxNameBytes，T-406）', () => {
  const NAMED: ZipLimits = { ...ROOMY, maxNameBytes: 64 };

  it('剛好 64 位元組照常讀；更長的在轉成字串之前就換成短的代號（不會有 65000 字的字串）', () => {
    const ok = listZip(buildZip([{ name: 'n'.repeat(64), data: bytes(1) }]), NAMED);
    expect(ok.entries[0]!.name).toBe('n'.repeat(64));
    for (const length of [65, 65_000]) {
      const long = listZip(buildZip([{ name: 'n'.repeat(length), data: bytes(1) }]), NAMED);
      expect(long.entries[0]!.name.length, `name of ${length} bytes`).toBeLessThan(65);
      expect(long.entries[0]!.name).not.toMatch(/^n+$/);
    }
  });

  it('代號不會被當成合法檔名解壓出來（本地檔頭的名字對不上）', () => {
    const zip = buildZip([{ name: 'n'.repeat(70), data: bytes(1) }]);
    expect(reasonOf(() => extractZip(zip, listZip(zip, NAMED), NAMED))).toBe('bad-zip');
  });

  it('沒給 maxNameBytes 就不限（別的呼叫端不受影響）', () => {
    expect(listZip(buildZip([{ name: 'n'.repeat(200), data: bytes(1) }]), ROOMY).entries[0]!.name).toBe('n'.repeat(200));
  });
});

describe('個別檔名的大小上限（entryMaxBytes，T-406）', () => {
  const CAPPED: ZipLimits = {
    maxEntries: 5,
    maxEntryBytes: 1 << 24,
    maxTotalBytes: 1 << 26,
    entryMaxBytes: (name) => (name === 'card.json' ? 1000 : undefined),
  };

  it('宣告超過這個檔的上限 → too-large（剛好等於可以；別的檔不受影響）', () => {
    expect(reasonOf(() => listZip(buildZip([{ name: 'card.json', data: bytes(1), size: 1001 }]), CAPPED))).toBe('too-large');
    expect(reasonOf(() => listZip(buildZip([{ name: 'card.json', data: bytes(1), size: 1000 }]), CAPPED))).toBe('ok');
    expect(reasonOf(() => listZip(buildZip([{ name: 'other', data: bytes(1), size: 5000 }]), CAPPED))).toBe('ok');
  });

  it('解壓時一邊解一邊數：宣告 10、DEFLATE 實際 5000（沒超過一般上限）→ too-large；別的檔同樣情況只是大小對不上', () => {
    const lying = buildZip([{ name: 'card.json', data: bytes(5000), size: 10 }]);
    expect(reasonOf(() => extractZip(lying, listZip(lying, CAPPED), CAPPED))).toBe('too-large');
    const other = buildZip([{ name: 'other', data: bytes(5000), size: 10 }]);
    expect(reasonOf(() => extractZip(other, listZip(other, CAPPED), CAPPED))).toBe('bad-zip');
  });

  it('DEFLATE 炸彈（宣告 10、實際 256 MB）→ 解到這個檔的上限就停，很快', () => {
    const zip = buildZip([{ name: 'card.json', compressed: zeroBomb(1 << 28), size: 10, crc: 0 }]);
    const listing = listZip(zip, CAPPED);
    const started = performance.now();
    expect(errorOf(() => extractZip(zip, listing, CAPPED))?.reason).toBe('too-large');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('不壓縮：宣告 10、實際 1200 → too-large；別的檔 1200 位元組沒問題', () => {
    const lying = buildZip([{ name: 'card.json', data: bytes(1200), method: 0, size: 10 }]);
    expect(reasonOf(() => extractZip(lying, listZip(lying, CAPPED), CAPPED))).toBe('too-large');
    const honest = buildZip([{ name: 'other', data: bytes(1200), method: 0 }]);
    expect(reasonOf(() => extractZip(honest, listZip(honest, CAPPED), CAPPED))).toBe('ok');
  });
});

describe('補審查員的改壞試驗放過的規則（T-406：Z1／Z3／Z4／Z5／Z6／Z8／Z9／Z20）', () => {
  const read = (zip: Uint8Array): ZipError | null => errorOf(() => readAll(zip));
  /** EOCD 固定在最後 22 位元組（這些 zip 沒有註解）。 */
  const eocdAt = (zip: Uint8Array): number => zip.length - 22;

  it('Z1：EOCD 的「這一片的檔案數」和「總檔案數」不同', () => {
    const zip = buildZip([
      { name: 'a', data: bytes(3) },
      { name: 'b', data: bytes(3) },
    ]);
    zip.set(u16le(1), eocdAt(zip) + 8);
    const error = read(zip);
    expect(error?.reason).toBe('bad-zip');
    expect(error?.message).toMatch(/split/);
  });

  it('Z3：EOCD 宣告的檔案數比中央目錄實際的少', () => {
    const zip = buildZip(
      [
        { name: 'a', data: bytes(3) },
        { name: 'b', data: bytes(3) },
      ],
      { count: 1 },
    );
    const error = read(zip);
    expect(error?.reason).toBe('bad-zip');
    expect(error?.message).toMatch(/does not match its entries/);
  });

  it('Z3：中央目錄大小比實際的筆數多（後面藏了東西）', () => {
    const zip = buildZip([{ name: 'a', data: bytes(3) }]);
    const end = eocdAt(zip);
    // 在中央目錄和 EOCD 之間塞 10 個位元組，EOCD 的目錄大小跟著加 10
    const padded = concat([zip.subarray(0, end), bytes(10, 0x55), zip.subarray(end)]);
    padded.set(u32le(46 + 1 + 10), end + 10 + 12);
    expect(read(padded)?.message).toMatch(/does not match its entries/);
  });

  it('Z2：中央目錄的範圍伸進 EOCD 裡（最後一筆的 extra 欄位蓋住了 EOCD）', () => {
    const zip = buildZip([{ name: 'a', data: bytes(3) }]);
    const end = eocdAt(zip);
    zip.set(u16le(22), end - (46 + 1) + 30); // 中央目錄那一筆的 extra 長度＝EOCD 的 22 位元組
    zip.set(u32le(46 + 1 + 22), end + 12); // EOCD 的目錄大小跟著變大：每一筆都「剛好接得上」，只有範圍超出檔案
    const error = read(zip);
    expect(error?.reason).toBe('bad-zip');
    expect(error?.message).toMatch(/out of range/);
  });

  it('Z4：中央目錄的「從第幾片開始」不是 0', () => {
    const zip = buildZip([{ name: 'a', data: bytes(3) }]);
    const directory = eocdAt(zip) - (46 + 1);
    zip.set(u16le(1), directory + 34);
    const error = read(zip);
    expect(error?.reason).toBe('bad-zip');
    expect(error?.message).toMatch(/another disk/);
  });

  it('Z5：只設旗標 bit 6（強加密）也算加密', () => {
    const error = read(buildZip([{ name: 'a', data: bytes(3), flags: 0x0840 }]));
    expect(error?.reason).toBe('bad-zip');
    expect(error?.message).toMatch(/encrypted/);
    // 對照：只設 bit 0 也是；兩個都沒設就讀得出來
    expect(read(buildZip([{ name: 'a', data: bytes(3), flags: 0x0801 }]))?.message).toMatch(/encrypted/);
    expect(read(buildZip([{ name: 'a', data: bytes(3), flags: 0x0800 }]))).toBeNull();
  });

  it('Z6：B 的本地檔頭藏在 A 的不壓縮資料裡（名字不同）→ 重疊', () => {
    const bData = utf8('BBBB');
    const bLocal = buildZip([{ name: 'b', data: bData, method: 0 }]).subarray(0, 30 + 1 + bData.length);
    const aData = concat([utf8('AAAA'), bLocal, utf8('AAAA')]);
    // B 的中央目錄指到 A 的資料裡（本地檔頭＋檔名 'a' 共 31 位元組，再跳過 4 個 A）
    const zip = buildZip([
      { name: 'a', data: aData, method: 0 },
      { name: 'b', data: bData, method: 0, offset: 30 + 1 + 4 },
    ]);
    const error = read(zip);
    expect(error?.reason).toBe('bad-zip');
    expect(error?.message).toMatch(/overlap/);
  });

  it('Z8：本地檔頭的壓縮法和中央目錄不同', () => {
    const zip = buildZip([{ name: 'a', data: bytes(30) }]); // 中央目錄寫 DEFLATE
    zip.set(u16le(0), 8); // 本地檔頭的壓縮法改成「不壓縮」
    const error = read(zip);
    expect(error?.reason).toBe('bad-zip');
    expect(error?.message).toMatch(/local header does not match/);
  });

  it('Z9：本地檔頭的位置指進中央目錄（藏在別筆的 extra 欄位裡）', () => {
    const aData = utf8('AAAA');
    const bData = utf8('BBBB');
    const bLocal = buildZip([{ name: 'b', data: bData, method: 0 }]).subarray(0, 30 + 1 + bData.length);
    const locals = 2 * (30 + 1 + 4); // a、b 各一份真的本地檔頭＋資料，中央目錄從這裡開始
    // B 的中央目錄指到中央目錄第一筆（a）的 extra 欄位開頭；那裡有一份完整合格的 B 本地檔頭＋資料
    const zip = buildZip([
      { name: 'a', data: aData, method: 0, extra: bLocal },
      { name: 'b', data: bData, method: 0, offset: locals + 46 + 1 },
    ]);
    const error = read(zip);
    expect(error?.reason).toBe('bad-zip');
    expect(error?.message).toMatch(/local header not found/);
    // 對照：把 B 指回真的那份就讀得出來
    const honest = buildZip([
      { name: 'a', data: aData, method: 0, extra: bLocal },
      { name: 'b', data: bData, method: 0 },
    ]);
    expect(read(honest)).toBeNull();
  });

  it('Z20：不支援的壓縮法——資料其實是合法的 DEFLATE、CRC 也對，仍然因為壓縮法被擋', () => {
    const data = utf8('hello hello hello hello');
    const error = read(buildZip([{ name: 'a', data, method: 99, compressed: deflateSync(data) }]));
    expect(error?.reason).toBe('bad-zip');
    expect(error?.message).toMatch(/unsupported compression 99/);
  });
});

describe('ZIP64 的特徵值（T-406：文件說回 too-large，鎖住現在的行為）', () => {
  it('檔案數 0xffff、單檔大小 0xffffffff → too-large（在解壓或讀完整個目錄之前）', () => {
    expect(reasonOf(() => listZip(buildZip([{ name: 'a', data: bytes(1) }], { count: 0xffff }), SMALL))).toBe('too-large');
    expect(reasonOf(() => listZip(buildZip([{ name: 'a', data: bytes(1), size: 0xffffffff }]), SMALL))).toBe('too-large');
  });

  it('EOCD 的中央目錄位置與大小是 0xffffffff（ZIP64 的特徵）→ bad-zip', () => {
    const zip = buildZip([{ name: 'a', data: bytes(1) }]);
    const end = zip.length - 22;
    zip.set(u32le(0xffffffff), end + 12);
    zip.set(u32le(0xffffffff), end + 16);
    expect(reasonOf(() => listZip(zip, SMALL))).toBe('bad-zip');
  });
});
