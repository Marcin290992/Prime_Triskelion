import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      // Avoid scanning standalone demos in src/ when starting Astro dev.
      noDiscovery: true,
      entries: ['src/pages/**/*.astro', 'src/pages/**/*.html'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              // shaders/typegpu (WebGPU) are only used by the preloader's
              // decorative effect and dynamically import()'d there — leave
              // them out of the shared vendor chunk so they stay in their
              // own lazily-fetched chunk instead of bloating every page's
              // eager JS with a multi-MB dependency most navigations never
              // even need (session-gated, first visit only).
              if (id.includes('/shaders/') || id.includes('/typegpu/')) {
                return;
              }
              return 'vendor';
            }
          },
        },
      },
    },
  },
});
