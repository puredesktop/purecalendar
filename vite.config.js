import react from '@vitejs/plugin-react-swc'
import { createRequire } from 'node:module'
import { defineConfig } from 'vite'

import { appDevServerFromManifest } from '../../scripts/vite/app-server.mjs'

const require = createRequire(import.meta.url)
// Resolve the SWC extension beside the React plugin that loads the compiler.
// The suite can hoist that compiler while the app has its own SWC dependencies.
const requireReactPlugin = createRequire(require.resolve('@vitejs/plugin-react-swc'))

export default defineConfig({
  plugins: [
    react({
      plugins: [
        [
          requireReactPlugin.resolve('@swc/plugin-styled-components'),
          { displayName: true, fileName: true },
        ],
      ],
    }),
  ],
  server: appDevServerFromManifest(import.meta.url),
})
