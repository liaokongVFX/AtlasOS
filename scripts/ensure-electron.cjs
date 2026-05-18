const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const electronModuleDir = path.dirname(require.resolve('electron/package.json'))
const pathFile = path.join(electronModuleDir, 'path.txt')
const electronCache = process.env.electron_config_cache || process.env.npm_config_electron_config_cache || path.resolve('.electron-cache')
const electronMirror = process.env.ELECTRON_MIRROR || process.env.npm_config_electron_mirror

function isElectronBinaryInstalled() {
  if (!fs.existsSync(pathFile)) return false

  const executable = fs.readFileSync(pathFile, 'utf8').trim()
  if (!executable) return false

  return fs.existsSync(path.join(electronModuleDir, 'dist', executable))
}

if (isElectronBinaryInstalled()) {
  process.exit(0)
}

const result = spawnSync(process.execPath, [path.join(electronModuleDir, 'install.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    electron_config_cache: electronCache,
    ...(electronMirror
      ? {
          ELECTRON_MIRROR: electronMirror,
          npm_config_electron_mirror: electronMirror
        }
      : {})
  }
})

if (result.status !== 0) {
  console.error(
    [
      '',
      'Electron runtime download failed.',
      'AtlasOS expects node_modules/electron/path.txt and node_modules/electron/dist/electron.exe before electron-vite can start.',
      'If GitHub releases are blocked in your network, set ELECTRON_MIRROR or npm_config_electron_mirror.',
      'Current mirror: ' + (electronMirror || 'Electron default GitHub releases URL')
    ].join('\n')
  )
}

process.exit(result.status ?? 1)
