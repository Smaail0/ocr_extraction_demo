import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // ensure jwt-decode is pre-bundled
    include: ['jwt-decode']
  },
  server: {
    watch: {
      ignored: ['**/.angular/**']
    },
    proxy: {
      // redirect /api/* to your FastAPI backend
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
});
