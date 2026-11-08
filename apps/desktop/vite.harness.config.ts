import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const stub = (f: string) => fileURLToPath(new URL(`./dev/stubs/${f}.ts`, import.meta.url));

// Só para testar a interface num navegador (pnpm harness). O app instalado usa vite.config.ts.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 1430, strictPort: true },
  resolve: {
    alias: {
      '@tauri-apps/api/webview': stub('webview'),
      '@tauri-apps/api/window': stub('window'),
      '@tauri-apps/api/app': stub('app'),
      '@tauri-apps/plugin-process': stub('process'),
      '@tauri-apps/plugin-updater': stub('updater'),
    },
  },
});
