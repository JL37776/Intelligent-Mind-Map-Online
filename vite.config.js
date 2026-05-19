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

function appUpdateNotes() {
  try {
    return execSync('git log -5 --pretty=format:%s').toString().trim().split(/\r?\n/)
  } catch {
    return ['Local build']
  }
}

export default defineConfig({
  plugins: [react()],
  base: '/Intelligent-Mind-Map-Online/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
    __APP_UPDATE_NOTES__: JSON.stringify(appUpdateNotes()),
  },
  build: {
    outDir: 'docs',
  },
})
