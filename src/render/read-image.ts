// 讀一張素材圖（T-416b）：先用呼叫端給的 read 取回內容、再從 blob 網址解碼。
// 不直接把網址交給 Image.src：那樣會跟著伺服器轉址連到別的主機（硬邊界 1）。main 給的 read 是帶 SAME_ORIGIN_FETCH 的 fetch
// （只准同源、轉址就失敗）；render 不 import app、不寫死檔名，素材由 main 讀好注入。

/** 讀網址的內容（main：url => fetch(url, SAME_ORIGIN_FETCH)）。 */
export type ReadAsset = (url: string) => Promise<Response>;

/**
 * 讀圖並解碼完：HTTP 不是 2xx、讀不到、解碼失敗都丟錯（失敗時 blob 網址收回）。
 * 成功時 blob 網址留著（素材整個工坊開著都在用，只有幾張）。
 */
export async function readImage(read: ReadAsset, url: string): Promise<HTMLImageElement> {
  const res = await read(url);
  if (!res.ok) throw new Error(`素材讀不到：${url}（HTTP ${res.status}）`);
  const objectUrl = URL.createObjectURL(await res.blob());
  const img = new Image();
  img.src = objectUrl;
  try {
    await img.decode();
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw new Error(`素材解碼失敗：${url}`, { cause: err });
  }
  return img;
}
