// T-846：凍結第 1 版前的全欄位固定檔；分級草案由主對話回寫 SCHEMA §4。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportHolocard, importHolocard } from '../src/file/holocard';
import type { StoredImage } from '../src/images/types';
import type { Card } from '../src/model/types';
import { validateCard } from '../src/model/validate';
import { makePng, stored } from './file-fixtures';

const REVIEW_FIELDS = '卡片欄位有變動：請先更新 SCHEMA §4「讀卡程式支援分級」表，再補全功能固定檔與欄位清單快照。';
const IMPORT_ID = 'full-feature-imported';
const IMPORT_TIME = '2026-10-16T01:02:03.000Z';

/** 第一張用自訂比例；第二張補上和 customAspect 互斥的 kind: disc。 */
function fixtures(): Card[] {
  return JSON.parse(readFileSync(new URL('./fixtures/full-feature-card.json', import.meta.url), 'utf8')) as Card[];
}

/** 實際讀 Card 型別，新增可省略欄位也會擋下；不只比固定檔自己的鍵。 */
function modelFieldPaths(): string[] {
  const file = fileURLToPath(new URL('../src/model/types.ts', import.meta.url));
  const program = ts.createProgram([file], { strict: true, target: ts.ScriptTarget.ES2022, types: [], skipLibCheck: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file)!;
  const card = source.statements.find((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === 'Card');
  if (!card) throw new Error('找不到 Card 型別，請檢查欄位清單快照的讀取方式。');
  const paths = new Set<string>();
  function visit(type: ts.Type, prefix = ''): void {
    type = checker.getNonNullableType(type);
    if (checker.isArrayType(type)) {
      visit(checker.getTypeArguments(type as ts.TypeReference)[0], `${prefix}[]`);
      return;
    }
    if (!(type.flags & ts.TypeFlags.Object)) return;
    for (const property of type.getProperties()) {
      const path = prefix ? `${prefix}.${property.name}` : property.name;
      paths.add(path);
      visit(checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? property.declarations![0]), path);
    }
  }
  visit(checker.getTypeAtLocation(card));
  return [...paths].sort();
}

/** 陣列合併各元素的欄位；互斥的圖層選項分別放在不同圖層。 */
function fixtureFieldPaths(cards: Card[]): string[] {
  const paths = new Set<string>();
  function visit(value: unknown, prefix = ''): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, `${prefix}[]`);
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        paths.add(path);
        visit(child, path);
      }
    }
  }
  for (const card of cards) visit(card);
  return [...paths].sort();
}

describe('全功能卡片固定檔（T-846，SCHEMA §1／§4）', () => {
  const images = new Map<string, StoredImage>();
  let baseHash: string;
  beforeAll(async () => {
    // 9 張真正能解碼的 4×4 PNG；不同雜湊讓漏包變身／遮罩／背景／前景圖也會失敗。
    // 順序：底圖、角色、變身、反光遮罩、背景、前景、文字、破框、剪裁。
    for (const seed of [11, 22, 33, 44, 55, 66, 77, 88, 99]) {
      const hasAlpha = seed !== 11 && seed !== 55;
      const bytes = makePng({ width: 4, height: 4, colorType: hasAlpha ? 6 : 2, seed });
      const image = await stored(bytes, 'image/png', 4, 4, hasAlpha);
      images.set(image.hash, image);
      if (seed === 11) baseHash = image.hash;
    }
  });

  it.each([0, 1])('固定卡 %i 通過 validateCard，圖片確實存在', (index) => {
    expect(fixtures()).toHaveLength(2);
    expect(validateCard(fixtures()[index], (hash) => images.has(hash))).toEqual([]);
  });

  it.each([0, 1])('固定卡 %i 匯出再匯入，除 id／時間外完全相同，圖片位元組不變', async (index) => {
    const card = fixtures()[index];
    const previewBytes = makePng({ width: 8, height: 8, seed: 255 });
    const preview = new Blob([previewBytes], { type: 'image/png' });
    const exported = await exportHolocard(card, async (hash) => images.get(hash), preview);
    const files = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    // 不用 omitCardDefaults 整理預期值：避免把匯出時的意外欄位遺失一起藏掉。
    expect(JSON.parse(strFromU8(files['card.json']))).toEqual(card);
    const expectedHashes = index === 0 ? [...images.keys()] : [baseHash];
    expect(Object.keys(files).sort()).toEqual(['card.json', 'preview.png', ...expectedHashes.map((hash) => `images/${hash}.png`)].sort());
    const result = await importHolocard(exported, { newId: () => IMPORT_ID, now: () => IMPORT_TIME });
    if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
    expect(result.card).toEqual({ ...card, id: IMPORT_ID, createdAt: IMPORT_TIME, updatedAt: IMPORT_TIME });
    expect(result.images.map((image) => image.hash).sort()).toEqual(expectedHashes.sort());
    for (const image of result.images) {
      const original = images.get(image.hash)!;
      expect({ ...image, blob: undefined }).toEqual({ ...original, blob: undefined });
      expect(image.blob.type).toBe(original.blob.type);
      expect(new Uint8Array(await image.blob.arrayBuffer())).toEqual(new Uint8Array(await original.blob.arrayBuffer()));
    }
    expect(result.preview?.type).toBe('image/png');
    expect(new Uint8Array(await result.preview!.arrayBuffer())).toEqual(previewBytes);
  });

  it('Card 型別與固定檔的欄位清單快照：新增欄位須更新讀卡程式支援分級表', () => {
    const modelPaths = modelFieldPaths();
    expect(modelPaths, REVIEW_FIELDS).toMatchInlineSnapshot(`
      [
        "aspect",
        "back",
        "back.foil",
        "back.foil.frame",
        "back.foil.mask",
        "back.foil.shape",
        "back.layers",
        "back.layers[].alt",
        "back.layers[].alt.hasAlpha",
        "back.layers[].alt.image",
        "back.layers[].blend",
        "back.layers[].breakout",
        "back.layers[].clip",
        "back.layers[].depth",
        "back.layers[].fx",
        "back.layers[].fx.color",
        "back.layers[].fx.kind",
        "back.layers[].fx.speed",
        "back.layers[].fx.strength",
        "back.layers[].hasAlpha",
        "back.layers[].holo",
        "back.layers[].id",
        "back.layers[].image",
        "back.layers[].lineart",
        "back.layers[].name",
        "back.layers[].opacity",
        "back.layers[].role",
        "back.layers[].scale",
        "back.layers[].text",
        "back.layers[].text.align",
        "back.layers[].text.color",
        "back.layers[].text.content",
        "back.layers[].text.font",
        "back.layers[].text.style",
        "back.layers[].text.vertical",
        "back.layers[].visible",
        "back.layers[].x",
        "back.layers[].y",
        "bodyColor",
        "cornerRadius",
        "createdAt",
        "customAspect",
        "customAspect.height",
        "customAspect.width",
        "formatVersion",
        "frame",
        "frame.color",
        "frame.enabled",
        "frame.shine",
        "frame.style",
        "frame.width",
        "front",
        "front.foil",
        "front.foil.frame",
        "front.foil.mask",
        "front.foil.shape",
        "front.layers",
        "front.layers[].alt",
        "front.layers[].alt.hasAlpha",
        "front.layers[].alt.image",
        "front.layers[].blend",
        "front.layers[].breakout",
        "front.layers[].clip",
        "front.layers[].depth",
        "front.layers[].fx",
        "front.layers[].fx.color",
        "front.layers[].fx.kind",
        "front.layers[].fx.speed",
        "front.layers[].fx.strength",
        "front.layers[].hasAlpha",
        "front.layers[].holo",
        "front.layers[].id",
        "front.layers[].image",
        "front.layers[].lineart",
        "front.layers[].name",
        "front.layers[].opacity",
        "front.layers[].role",
        "front.layers[].scale",
        "front.layers[].text",
        "front.layers[].text.align",
        "front.layers[].text.color",
        "front.layers[].text.content",
        "front.layers[].text.font",
        "front.layers[].text.style",
        "front.layers[].text.vertical",
        "front.layers[].visible",
        "front.layers[].x",
        "front.layers[].y",
        "holo",
        "holo.bandWidth",
        "holo.colors",
        "holo.matte",
        "holo.palette",
        "holo.sparkle",
        "holo.strength",
        "id",
        "kind",
        "name",
        "shadow",
        "shadow.distance",
        "shadow.strength",
        "story",
        "story.font",
        "story.text",
        "updatedAt",
        "view",
        "view.backdrop",
        "view.farPan",
        "view.farPan.x",
        "view.farPan.y",
        "view.farPan.zoom",
        "view.foreground",
        "view.foreground.blur",
        "view.foreground.image",
        "view.foreground.scale",
        "view.foreground.x",
        "view.foreground.y",
        "view.returnToFront",
        "view.showcase",
        "view.sleeve",
        "view.stage",
        "view.waterLook",
        "view.waterLook.glint",
        "view.waterLook.glintColor",
        "view.waterLook.horizon",
        "view.waterLook.lift",
        "view.waterLook.mist",
        "view.waterLook.mistColor",
        "view.waterLook.ripple",
        "view.waterLook.streak",
        "view.waterScene",
      ]
    `);
    expect(fixtureFieldPaths(fixtures()), REVIEW_FIELDS).toEqual(modelPaths);
  });
});
