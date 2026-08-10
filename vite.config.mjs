import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

/**
 * 构建产物输出到 dist/，服务端直接 serve 它。
 *
 * 这里曾经有一整套 PV_PRO_STUB 桩机制，用来在没有 HeroUI Pro license 的环境下
 * 也能跑通构建。依赖里去掉 Pro 之后它就没有存在理由了 ——
 * 现在任何人 clone 下来 npm install 就能构建，不需要任何凭据。
 */
export default defineConfig({
  root: path.resolve(import.meta.dirname, 'web'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    /*
     * 不出 sourcemap。
     *
     * 它有 4.4MB，是 JS 产物的五倍，而这是个本地小工具，
     * 没有「线上报错要定位」的场景 —— 有问题直接 npm run dev。
     * 发 npm 包时它还会白白撑大下载体积。
     */
    sourcemap: false,
  },
  server: {
    port: 5173,
    // 开发时把 API 代理到 Express，前后端各自热重载互不干扰
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
