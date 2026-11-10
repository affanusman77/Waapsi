/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'brand/apple-touch-icon.png', 'brand/logo.png'],
      manifest: {
        id: '/',
        name: 'Wapsi · واپسی',
        short_name: 'Wapsi',
        description: 'Reuniting lost children with their families, safely.',
        lang: 'en',
        theme_color: '#FBF6EE',
        background_color: '#FBF6EE',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['utilities', 'social'],
        icons: [
          { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Long-press the home-screen icon to jump straight into the two urgent flows.
        shortcuts: [
          { name: 'I found a child', short_name: 'Found a child', url: '/f', icons: [{ src: '/brand/icon-192.png', sizes: '192x192' }] },
          { name: 'My child is lost', short_name: 'Child lost', url: '/p', icons: [{ src: '/brand/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // Never cache API/storage responses: child data must not linger on shared phones.
        navigateFallbackDenylist: [/^\/functions\//],
        runtimeCaching: [],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
