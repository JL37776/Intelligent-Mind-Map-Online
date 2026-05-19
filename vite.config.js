import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function appVersion() {
  try {
    const commit = execSync('git rev-parse --short HEAD').toString().trim()
    const dirty = execSync('git status --porcelain').toString().trim()
    return dirty ? `${commit}-pending` : commit
  } catch {
    return String(Date.now())
  }
}

export default defineConfig({
  plugins: [react()],
  base: '/Intelligent-Mind-Map-Online/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  build: {
    outDir: 'docs',
  },
})
