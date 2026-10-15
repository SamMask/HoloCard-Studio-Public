import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// 只綁本機：使用者的圖片與卡片不離開這台電腦（AGENTS.md 硬邊界 2）。
const local = { host: '127.0.0.1', port: 5190, strictPort: true } as const;

export default defineConfig({
  server: { ...local },
  preview: { ...local },
  // T-702（AI 推論）：onnxruntime-web 只在 Web Worker 裡 import，Vite 啟動時的掃描看不到它 →
  // 先列進預先打包，不然使用者第一次用 AI 功能時 Vite 才打包、整頁重新整理（實測過）。
  optimizeDeps: { include: ['onnxruntime-web/webgpu'] },
  // 'onnxruntime-web-use-extern-wasm'：wasm 一律從 public/ort/ 讀（npm run fetch-models 複製），
  // build 時不再多打包一份用不到的 26.8 MB wasm（實測過）。保留 Vite 預設的條件。
  resolve: { conditions: [...defaultClientConditions, 'onnxruntime-web-use-extern-wasm'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
