import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Nothing was prefetching links at all before this — every tap had to
  // wait for the new page's fetch to even START before the View Transition
  // could begin, which on a mobile connection reads as an inconsistent
  // stall right after tapping (fast on good signal, a visible hang on
  // anything worse) rather than a fixed, predictable delay. 'viewport'
  // fetches a link's page as soon as it scrolls into view — well before
  // anyone can actually tap it — so by the time a real tap happens the
  // page is normally already cached and navigation has nothing left to
  // wait on. prefetchAll extends that to every link site-wide (menu, logo,
  // project cards, footer), not just ones opted in with data-astro-prefetch.
  prefetch: {
    defaultStrategy: 'viewport',
    prefetchAll: true,
  },
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
