import { describe, expect, it } from 'vitest';
import { checkFile, layerNameFromFile } from '../../src/images/ingest';
import { MAX_UPLOAD_BYTES } from '../../src/images/types';

describe('checkFile（解碼前的檢查）', () => {
  it('剛好 30 MB 通過', () => {
    expect(MAX_UPLOAD_BYTES).toBe(30 * 1024 * 1024);
    expect(checkFile(MAX_UPLOAD_BYTES, 'image/png')).toBeNull();
  });

  it('多 1 byte → too-large', () => {
    expect(checkFile(MAX_UPLOAD_BYTES + 1, 'image/png')).toBe('too-large');
  });

  it('太大又不是圖 → 先回 too-large（大小先檢查，不解碼）', () => {
    expect(checkFile(MAX_UPLOAD_BYTES + 1, 'image/gif')).toBe('too-large');
  });

  it('image/gif → not-image', () => {
    expect(checkFile(1000, 'image/gif')).toBe('not-image');
  });

  it('其他非圖片格式 → not-image', () => {
    expect(checkFile(1000, 'application/pdf')).toBe('not-image');
    expect(checkFile(1000, 'text/plain')).toBe('not-image');
    expect(checkFile(1000, 'image/svg+xml')).toBe('not-image');
  });

  it('png／webp／jpeg 通過', () => {
    expect(checkFile(1000, 'image/png')).toBeNull();
    expect(checkFile(1000, 'image/webp')).toBeNull();
    expect(checkFile(1000, 'image/jpeg')).toBeNull();
  });

  it('空 type 放行（交給解碼判斷）', () => {
    expect(checkFile(1000, '')).toBeNull();
  });

  it('大小 0 也放行（交給解碼判斷）', () => {
    expect(checkFile(0, 'image/png')).toBeNull();
  });
});

describe('layerNameFromFile', () => {
  it('去掉副檔名', () => {
    expect(layerNameFromFile('背景.png')).toBe('背景');
    expect(layerNameFromFile('photo.JPG')).toBe('photo');
  });

  it('多個點只去掉最後一段', () => {
    expect(layerNameFromFile('my.cool.card.webp')).toBe('my.cool.card');
  });

  it('沒有副檔名就原樣', () => {
    expect(layerNameFromFile('背景')).toBe('背景');
  });

  it('超過 60 字截到 60 字', () => {
    const long = 'a'.repeat(100);
    expect(layerNameFromFile(`${long}.png`)).toBe('a'.repeat(60));
  });

  it('剛好 60 字不動', () => {
    const exact = 'b'.repeat(60);
    expect(layerNameFromFile(`${exact}.png`)).toBe(exact);
  });

  it('空字串用「圖層」', () => {
    expect(layerNameFromFile('')).toBe('圖層');
  });

  it('去掉副檔名後變空（例如 ".png"）用「圖層」', () => {
    expect(layerNameFromFile('.png')).toBe('圖層');
  });

  it('只有空白用「圖層」', () => {
    expect(layerNameFromFile('   .png')).toBe('圖層');
    expect(layerNameFromFile('   ')).toBe('圖層');
  });

  it('前後空白去掉', () => {
    expect(layerNameFromFile('  星空  .png')).toBe('星空');
  });
});
