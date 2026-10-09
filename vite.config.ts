import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Serve api/*.ts (Vercel functions) from the dev server, so `npm run dev` is the whole app. */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const m = url.pathname.match(/^\/api\/([a-z0-9-]+)$/)
        if (!m) return next()
        try {
          const mod = await server.ssrLoadModule(`/api/${m[1]}.ts`)
          const r: Response = await mod.GET(new Request(url))
          res.statusCode = r.status
          r.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await r.arrayBuffer()))
        } catch (e) {
          res.statusCode = 500
          res.end(String(e))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    devApi(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Lineup Lab',
        short_name: 'Lineup Lab',
        description: 'See a Sleeper fantasy trade in both starting lineups: projections, drops, waiver fills.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#10131c',
        theme_color: '#10131c',
        categories: ['sports', 'utilities'],
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Our market feeds: fresh when online, last good copy when not.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'lineuplab-api', networkTimeoutSeconds: 8, expiration: { maxEntries: 10, maxAgeSeconds: 86400 } },
          },
          {
            // Sleeper league data + projections (the 15 MB player DB is cached by the app itself).
            urlPattern: /^https:\/\/api\.sleeper\.(app|com)\/(?!v1\/players\/nfl$).*/,
            handler: 'NetworkFirst',
            options: { cacheName: 'sleeper-api', networkTimeoutSeconds: 8, expiration: { maxEntries: 600, maxAgeSeconds: 86400 } },
          },
          {
            urlPattern: /^https:\/\/sleepercdn\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'sleeper-images', expiration: { maxEntries: 800, maxAgeSeconds: 30 * 86400 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts' },
          },
        ],
      },
    }),
  ],
})
