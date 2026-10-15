// T-828a 掃描：src/**/*.ts（字典 src/i18n/** 以外）不准有寫死的介面中文（DESIGN §9：所有介面文字都要能翻）。
// 用 TypeScript 的語法樹找字串與樣板字面值（註解自然不算），含中日韓字的除了下面「有寫理由的允許清單」之外都要是 0。
// 之後新增介面文字：寫進 src/i18n/zh-Hant.ts（四種語言同一輪補齊），程式裡讀 S。
// 允許清單的字一律照原樣比對（樣板的 ${…} 寫成 ${}）：允許清單裡的檔案多了一句新的中文，一樣會被抓到。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** 中日韓字（含假名、韓文字母、全形標點）。 */
const CJK = /[　-〿぀-ヿ㐀-鿿가-힯＀-￯]/;

/** 只給開發者看的錯誤與 console 訊息：丟出去的錯誤由呼叫端接住、寫 console，畫面只顯示字典裡固定的白話句。 */
const DEV_ONLY = '丟出的錯誤／console 訊息，只給開發者看（畫面顯示字典裡固定的白話句，不顯示這些）';

const ALLOWED: Record<string, { reason: string; texts: readonly string[] | '*' }> = {
  'src/model/validate.ts': {
    reason: '卡片資料驗證的錯誤說明：存檔失敗只寫 console、匯入失敗的細節只給開發者看（畫面只顯示 save.notCardFile 等三句白話），整個檔都不是介面文字',
    texts: '*',
  },
  'src/model/actions.ts': {
    reason:
      'model 不准依賴其他模組（tests/model/imports.test.ts）：新文字圖層的字由組裝端換成 S.defaults.textContent、圖層名由 images/ingest 給（S.defaults.layerName），這裡只剩保底',
    texts: ['圖層', '文字', '卡片名稱'],
  },
  'src/model/create.ts': {
    reason: 'model 不准依賴其他模組：空白卡的卡名由組裝端（main.ts 的 blankName）換成 S.defaults.cardName，這裡只剩原文預設值',
    texts: ['未命名卡片'],
  },
  'src/images/text-layout.ts': {
    reason: '直排標點對照表（橫排標點 → 直排字形）：排版用的資料，不是介面文字',
    texts: ['，', '、', '。', '：', '；', '！', '？', '「', '」', '『', '』', '（', '）', '【', '】', '《', '》', '〈', '〉', '｛', '｝', '〔', '〕', '－', '～'],
  },
  'src/images/text.ts': {
    reason: '量字高用的參考字（畫在看不到的畫布上，不顯示）',
    texts: ['國'],
  },
  'src/main.ts': {
    reason: DEV_ONLY,
    texts: [
      '3D 預覽沒有準備好，拍不了 preview',
      '讀不到要匯出的卡 ${}',
      '3D 預覽沒有準備好',
      '沒有第 ${} 張範例，或還沒開好卡',
      '範例卡片檔 ${} 沒通過檢查（${}）',
      '範例卡一張都沒有打開',
      '找不到 #app',
    ],
  },
  'src/app/samples.ts': {
    reason: DEV_ONLY,
    texts: [
      '範例卡片檔讀太久，不等了：${}（超過 ${} 秒）',
      '範例卡片檔讀不到：${}（HTTP ${}）',
      '沒通過卡片檔的檢查（${}${}）',
      '：${}',
      '存不進卡片庫',
      '打不開（${}）',
      '範例卡 ${} 跳過：',
      '沒有第 ${} 張範例',
      '沒通過卡片檔的檢查（${}）',
      '卡片檔裡沒有預覽圖',
      '範例卡 ${} 的縮圖讀不到：',
      '記不住補過的範例：',
      '讀不到卡片庫，這次不補新的範例：',
    ],
  },
  'src/app/session.ts': {
    reason: DEV_ONLY,
    texts: ['存檔裡缺圖 ${}', '存檔打不開，讀不到卡片庫', '卡片庫裡有卡，但一張都讀不出來', '記憶體裡找不到圖 ${}，沒有另存', '打不開卡片 ${}（${}）'],
  },
  'src/app/autosave.ts': { reason: DEV_ONLY, texts: ['記憶體裡找不到圖 ${}，沒有存'] },
  'src/app/files.ts': {
    reason: `${DEV_ONLY}；[nodownload] 那句是測試用不下載開關的 console 記錄`,
    texts: [
      '一圈秒數要是大於 0 的有限數字',
      '週期要是大於 0 的有限數字',
      '影片要轉 1～${} 圈',
      '圈數要是正整數',
      '每圈格數要是正整數',
      '起始時間要是有限數字',
      '一圈的效果時間要是大於 0 的有限數字',
      '匯出已取消',
      '一格都沒有拍到',
      '[nodownload] 沒有下載「${}」（${} 位元組），放在 window.__holoDownloads',
    ],
  },
  'src/app/gallery-hall.ts': { reason: DEV_ONLY, texts: ['展示廳的大廳圖解出來是空的'] },
  'src/app/nebula-swirl.ts': { reason: DEV_ONLY, texts: ['星雲的漩渦大圖解出來是空的'] },
  'src/app/thumbnail.ts': { reason: DEV_ONLY, texts: ['沒有 2D 畫布'] },
  'src/app/tab-lock.ts': { reason: DEV_ONLY, texts: ['這個分頁已經交給另一個分頁編輯，沒有寫入存檔'] },
  'src/app/turntable-export.ts': { reason: DEV_ONLY, texts: ['3D 預覽沒有準備好'] },
  'src/storage/store.ts': {
    reason: DEV_ONLY,
    texts: [
      'IndexedDB 要求失敗',
      'IndexedDB 交易失敗',
      'IndexedDB 交易被中止',
      '打不開資料庫',
      '這個瀏覽器不支援 IndexedDB，沒辦法存卡片',
      '縮圖要是 Blob，沒有存',
      '卡片資料不是單純的資料，沒有存',
      '；',
      '（共 ${} 條）',
      '卡片資料不合格，沒有存：${}${}',
      '圖片資料不合格，沒有存',
    ],
  },
  'src/render/card-mesh.ts': { reason: DEV_ONLY, texts: ['無法建立 2D 畫布'] },
  'src/render/card-view.ts': {
    reason: DEV_ONLY,
    texts: [
      '無法建立 2D 畫布',
      'PNG 圖片產生失敗',
      '擷取已取消',
      '還沒有卡片可以擷取',
      '擷取寬度要是 1～${} 的整數',
      '畫格數要是 2 以上的整數',
      '一圈秒數要是大於 0 的有限數字',
      '起始時間要是有限數字',
      '效果時間要是大於 0 的有限數字',
      '俯仰角要是有限數字',
      '擷取動作要是 turn 或 swing',
      '擺動幅度要是 5～60 的有限數字',
      '上下點頭幅度要是 ${}～${} 的有限數字',
      '擷取的圖太大（長邊最多 ${} 像素）',
      '擷取卡片畫面失敗',
      // 連舞台一起錄（T-850）
      '畫面高要是 1～${} 的整數',
      '鏡頭縮放要是大於 0 的有限數字',
      '第幾圈要是 0 以上的整數',
      '上下角度範圍要是 0 以上的數字',
    ],
  },
  'src/render/pick.ts': {
    reason: DEV_ONLY,
    texts: ['卡片跑到鏡頭後面，無法擷取', '擷取寬度要是 1 以上的整數', '俯仰角要是有限數字', '擺動幅度要是 5～60 的有限數字', '上下點頭幅度要是 ${}～${} 的有限數字'],
  },
  'src/render/pixels.ts': { reason: DEV_ONLY, texts: ['讀回的像素大小不對', '輸出像素暫存大小不對', '合成的畫格大小不對'] },
  // 連舞台一起錄（T-850）：圖讀不到時丟的錯（匯出組裝接住，畫面顯示 export.gifFailed／videoFailed）
  'src/app/stage-scenery.ts': { reason: DEV_ONLY, texts: ['讀不到舞台的圖：${}', '讀不到舞台的圖', '讀不到這張卡的背景圖', '舞台的圖沒有接上 3D'] },
  'src/render/read-image.ts': { reason: DEV_ONLY, texts: ['素材讀不到：${}（HTTP ${}）', '素材解碼失敗：${}'] },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const relPath = (p: string) => relative(ROOT, p).replaceAll('\\', '/');

/** 這個檔裡含中日韓字的字面值：字串照原樣、樣板的 ${…} 寫成 ${}（巢狀樣板各算一個）。 */
function cjkLiterals(source: string, fileName = 'x.ts'): { line: number; text: string }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: { line: number; text: string }[] = [];
  const add = (node: ts.Node, text: string) => {
    if (CJK.test(text)) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) add(node, node.head.text + node.templateSpans.map((s) => '${}' + s.literal.text).join(''));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const files = walk(join(ROOT, 'src'))
  .map(relPath)
  .filter((f) => !f.startsWith('src/i18n/'))
  .sort();

describe('掃描工具本身', () => {
  it('找得到字串、樣板（含巢狀）、物件鍵；註解裡的不算', () => {
    const src = [
      "// 註解裡的中文不算",
      "/* 這個也不算 */",
      "const a = '你好';",
      'const b = `共 ${n} 張${x ? `：${y}` : ""}`;',
      "const c = { '，': 1, ok: 'english' };",
      'const d = "한국어";',
    ].join('\n');
    expect(cjkLiterals(src).map((x) => x.text)).toEqual(['你好', '共 ${} 張${}', '：${}', '，', '한국어']);
  });

  it('有東西可以掃（不是空的資料夾）；字典資料夾不掃', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('src/ui/logic.ts');
    expect(files.some((f) => f.startsWith('src/i18n/'))).toBe(false);
  });
});

describe('src 裡沒有寫死的介面中文（字典以外）', () => {
  it('允許清單之外是 0', () => {
    const found: string[] = [];
    for (const file of files) {
      const allowed = ALLOWED[file];
      if (allowed?.texts === '*') continue;
      for (const hit of cjkLiterals(readFileSync(join(ROOT, file), 'utf8'), file)) {
        if (allowed && allowed.texts.includes(hit.text)) continue;
        found.push(`${file}:${hit.line}  ${hit.text}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('允許清單每一條都有理由，而且還用得到（清掉的字要一起從清單拿掉）', () => {
    const stale: string[] = [];
    for (const [file, allowed] of Object.entries(ALLOWED)) {
      expect(allowed.reason.trim().length, file).toBeGreaterThan(5);
      expect(files, file).toContain(file);
      if (allowed.texts === '*') continue;
      const texts = new Set(cjkLiterals(readFileSync(join(ROOT, file), 'utf8'), file).map((h) => h.text));
      for (const t of allowed.texts) if (!texts.has(t)) stale.push(`${file}  ${t}`);
    }
    expect(stale).toEqual([]);
  });

  it('整個檔都允許的只有卡片資料驗證（model/validate.ts）', () => {
    expect(Object.entries(ALLOWED).filter(([, a]) => a.texts === '*').map(([f]) => f)).toEqual(['src/model/validate.ts']);
  });
});
