import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// マルチエントリ。挑戦者クライアント（将来の Steam 版本体）と
// 助言者ページ（無料ブラウザ・永続）を最初から別バンドルに分ける。
// フェーズ2で挑戦者側を Tauri で包むとき、advisor 側を巻き込まない。
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        challenger: resolve(__dirname, 'index.html'),
        advisor: resolve(__dirname, 'advisor.html'),
      },
    },
  },
  server: { host: true, port: 5173 },
});
