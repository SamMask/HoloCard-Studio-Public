// 同源讀檔的共用設定（硬邊界 1，T-605c）：程式裡的 fetch 一律只讀自己網站的檔。
// 同源網址也可能被伺服器轉址到外站（fetch 預設會跟著轉），所以一律 redirect: 'error'——轉址就失敗，不會連出去。
// tests/no-external-fetch.test.ts 會掃 src/ 的每一個 fetch 呼叫，沒帶這個（或同樣設定）就失敗。

export const SAME_ORIGIN_FETCH: Readonly<RequestInit> = Object.freeze({
  mode: 'same-origin',
  redirect: 'error',
  credentials: 'same-origin',
});
