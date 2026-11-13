import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // 共享包各自声明 React peer 依赖，强制解析到同一份 React，
    // 避免打包后出现 "Invalid hook call"。
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
