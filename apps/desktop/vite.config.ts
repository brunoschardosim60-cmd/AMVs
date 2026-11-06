import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Configuração para o Tauri: porta fixa, sem limpar a tela, alvo de navegador moderno (WebView2/WebKitGTK).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', testTimeout: 60_000 },
});
