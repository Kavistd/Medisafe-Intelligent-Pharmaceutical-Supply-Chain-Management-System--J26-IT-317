import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from 'node:url';
import { documentGateway } from './component1-document-gateway.js';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const traceabilityProxy = {
    '/component2': { target: 'http://127.0.0.1:8000', changeOrigin: true, rewrite: (path) => path.replace(/^\/component2/, '') },
    '/api/v1/traceability': { target: 'http://127.0.0.1:5001', changeOrigin: true },
    '/api': { target: 'http://localhost:5004', changeOrigin: true },
    '/c3-api': {
      target: 'http://127.0.0.1:5005',
      changeOrigin: true,
      rewrite: path => path.replace(/^\/c3-api/, ''),
    },
    '/c3-demo-api': {
      target: 'http://127.0.0.1:5003',
      changeOrigin: true,
      rewrite: path => path.replace(/^\/c3-demo-api/, ''),
    },
  };
  return {
  plugins: [react(), { name: 'component1-local-document-authorization',
    configureServer(server) { server.middlewares.use(documentGateway(env)); },
    configurePreviewServer(server) { server.middlewares.use(documentGateway(env)); },
  }],
  build: { rollupOptions: { input: {
    prescriptions: fileURLToPath(new URL('./index.html', import.meta.url)),
    traceability: fileURLToPath(new URL('./traceability.html', import.meta.url)),
    component3: fileURLToPath(new URL('./component3.html', import.meta.url)),
    riskScoring: fileURLToPath(new URL('./risk-scoring.html', import.meta.url)),
  } } },
  preview: { proxy: traceabilityProxy },
  server: {
    host: "0.0.0.0",
    proxy: traceabilityProxy,
  },
}; });
