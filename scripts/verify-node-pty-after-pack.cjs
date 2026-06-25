const { existsSync, statSync } = require('node:fs')
const { join } = require('node:path')

const WINDOWS_NODE_PTY_REQUIRED_ASSETS = [
  'conpty.node',
  'conpty_console_list.node',
  'pty.node',
  'winpty-agent.exe',
  'winpty.dll'
]

const WINDOWS_NODE_PTY_OPTIONAL_CONPTY_DLL_ASSETS = [
  'conpty/conpty.dll',
  'conpty/OpenConsole.exe'
]

const ELECTRON_BUILDER_ARCH = {
  1: 'x64',
  3: 'arm64'
}

function isFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile()
  } catch {
    return false
  }
}

function missingFiles(rootDir, relativePaths) {
  return relativePaths.filter((relativePath) => !isFile(join(rootDir, relativePath)))
}

function verifyWindowsNodePtyAssets(appOutDir, arch) {
  const nodePtyDir = join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty')
  const candidateDirs = [
    join(nodePtyDir, 'build', 'Release'),
    join(nodePtyDir, 'build', 'Debug'),
    join(nodePtyDir, 'prebuilds', `win32-${arch}`)
  ]

  const selectedDir = candidateDirs.find((candidateDir) => isFile(join(candidateDir, 'conpty.node')))
  if (selectedDir) {
    const missing = missingFiles(selectedDir, WINDOWS_NODE_PTY_REQUIRED_ASSETS)
    if (missing.length === 0) {
      // Rebuilt node-pty uses the system ConPTY API by default; bundled conpty.dll is only used with useConptyDll=true.
      const missingOptionalConptyDll = missingFiles(selectedDir, WINDOWS_NODE_PTY_OPTIONAL_CONPTY_DLL_ASSETS)
      if (missingOptionalConptyDll.length > 0 && missingOptionalConptyDll.length < WINDOWS_NODE_PTY_OPTIONAL_CONPTY_DLL_ASSETS.length) {
        throw new Error(`node-pty optional bundled ConPTY DLL assets are incomplete in ${selectedDir}.\n${missingOptionalConptyDll.map((relativePath) => `  - ${relativePath}`).join('\n')}`)
      }

      console.log(`node-pty Windows runtime assets verified for win32-${arch}.`)
      return
    }

    throw new Error(`node-pty Windows runtime assets are incomplete in ${selectedDir}.\n${missing.map((relativePath) => `  - ${relativePath}`).join('\n')}`)
  }

  throw new Error(`node-pty Windows runtime assets are missing from the packaged app.\n${candidateDirs.map((candidateDir) => `  - ${join(candidateDir, 'conpty.node')}`).join('\n')}`)
}

async function verifyNodePtyAfterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const arch = ELECTRON_BUILDER_ARCH[context.arch] || process.arch
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`node-pty Windows packaging verification does not support arch: ${arch}`)
  }

  verifyWindowsNodePtyAssets(context.appOutDir, arch)
}

if (require.main === module) {
  const appOutDir = process.argv[2] || join(__dirname, '..', 'release', 'win-unpacked')
  const arch = process.argv[3] || process.arch
  verifyWindowsNodePtyAssets(appOutDir, arch)
}

module.exports = verifyNodePtyAfterPack
module.exports.default = verifyNodePtyAfterPack
