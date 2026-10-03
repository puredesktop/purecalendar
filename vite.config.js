import react from '@vitejs/plugin-react-swc'
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'

import { appDevServerFromManifest } from '../../scripts/vite/app-server.mjs'

export default defineConfig({
  plugins: [
    react({
      plugins: [
        [
          createRequire(import.meta.url).resolve('@swc/plugin-styled-components'),
          { displayName: true, fileName: true },
        ],
      ],
    }),
  ],
  server: appDevServerFromManifest(import.meta.url),
})
