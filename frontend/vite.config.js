import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from 'node:url';
import { documentGateway } from './component1-document-gateway.js';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const traceabilityProxy = { '/api/v1/traceability': { target: 'http://127.0.0.1:5001', changeOrigin: true }, '/api': { target: 'http://localhost:5004', changeOrigin: true } };
  return {
  plugins: [react(), { name: 'component1-local-document-authorization',
    configureServer(server) { server.middlewares.use(documentGateway(env)); },
    configurePreviewServer(server) { server.middlewares.use(documentGateway(env)); },
  }],
  build: { rollupOptions: { input: {
    prescriptions: fileURLToPath(new URL('./index.html', import.meta.url)),
    traceability: fileURLToPath(new URL('./traceability.html', import.meta.url)),
  } } },
  preview: { proxy: traceabilityProxy },
  server: {
    host: "0.0.0.0",
    proxy: traceabilityProxy,
  },
}; });
