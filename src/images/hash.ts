// 圖片雜湊：編碼後內容的 SHA-256 前 16 碼（小寫十六進位）。SCHEMA.md §2。

/** 用瀏覽器內建的 `crypto.subtle` 算 SHA-256，回前 16 碼。 */
export async function hashBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  // 只算這段檢視的範圍（Uint8Array 可能只是大 buffer 的一小段）。
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', view as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest).subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
