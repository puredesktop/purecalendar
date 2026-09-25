import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

import { appDevServerFromManifest } from '../../scripts/vite/app-server.mjs'

export default defineConfig({
  plugins: [
    react({
      plugins: [
        [
          '@swc/plugin-styled-components',
          { displayName: true, fileName: true },
        ],
      ],
    }),
  ],
  server: appDevServerFromManifest(import.meta.url),
})
