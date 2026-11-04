import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

function getGitInfo() {
  let commit = 'local'
  let tagVersion = pkg.version
  let date = new Date().toISOString().split('T')[0]
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim()
  } catch {}
  try {
    const rawDate = execSync('git log -1 --format=%cd --date=short').toString().trim()
    if (rawDate) date = rawDate
  } catch {}
  try {
    const latestTag = execSync('git describe --tags --abbrev=0').toString().trim()
    if (latestTag) {
      const cleanTag = latestTag.replace(/^v/i, '')
      if (cleanTag && pkg.version === '0.0.0') tagVersion = cleanTag
    }
  } catch {}
  return { version: tagVersion, commit, date }
}

const gitInfo = getGitInfo()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(gitInfo.version),
    __GIT_COMMIT__: JSON.stringify(gitInfo.commit),
    __BUILD_DATE__: JSON.stringify(gitInfo.date),
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true
      }
    }
  }
})
