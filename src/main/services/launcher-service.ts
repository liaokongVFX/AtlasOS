import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { dialog, shell } from 'electron'
import { launcherChooseFileInputSchema, launcherOpenInputSchema, type LauncherOpenInput } from '@shared/ipc'
import { handleValidated } from './ipc-helpers'

const APP_FILE_FILTERS: Electron.FileFilter[] = [
  { name: 'Applications and shortcuts', extensions: ['exe', 'lnk', 'bat', 'cmd', 'ps1', 'com'] },
  { name: 'All files', extensions: ['*'] }
]

const ANY_FILE_FILTERS: Electron.FileFilter[] = [{ name: 'All files', extensions: ['*'] }]

export class LauncherService {
  constructor(
    private readonly platform = process.platform,
    private readonly spawnProcess: typeof spawn = spawn
  ) {}

  registerIpc(): void {
    handleValidated('launcher:choose-file', launcherChooseFileInputSchema, async (_, input) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: input.kind === 'app' ? APP_FILE_FILTERS : ANY_FILE_FILTERS
      })

      return result.canceled ? null : result.filePaths[0]
    })

    handleValidated('launcher:open', launcherOpenInputSchema, async (_, input) => {
      await this.open(input)
      return { ok: true }
    })
  }

  async open(input: LauncherOpenInput): Promise<void> {
    if (input.kind === 'url') {
      await this.openUrl(input.url)
      return
    }

    if (input.kind === 'command') {
      await this.openCommand(input.shell, input.command, input.cwd)
      return
    }

    await this.openPath(input.kind, input.targetPath)
  }

  private async openPath(kind: 'app' | 'file' | 'folder', targetPath: string): Promise<void> {
    const metadata = await stat(targetPath)
    if (kind === 'folder' && !metadata.isDirectory()) {
      throw new Error('Launcher target is not a folder')
    }
    if (kind !== 'folder' && metadata.isDirectory()) {
      throw new Error('Launcher target is not a file')
    }

    const error = await shell.openPath(targetPath)
    if (error) throw new Error(error)
  }

  private async openUrl(url: string): Promise<void> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Launcher URLs must use http or https')
    }

    await shell.openExternal(parsed.toString())
  }

  private async openCommand(shellKind: 'cmd' | 'powershell', command: string, cwd?: string): Promise<void> {
    if (this.platform !== 'win32') {
      throw new Error('Command shortcuts are only supported on Windows')
    }

    const options: Parameters<typeof spawn>[2] = {
      cwd: cwd ? await this.validateCommandCwd(cwd) : undefined,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    }

    const child =
      shellKind === 'cmd'
        ? this.spawnProcess('cmd.exe', ['/d', '/s', '/k', command], options)
        : this.spawnProcess('powershell.exe', ['-NoLogo', '-NoExit', '-Command', command], options)

    this.detachChild(child)
  }

  private async validateCommandCwd(cwd: string): Promise<string> {
    const metadata = await stat(cwd)
    if (!metadata.isDirectory()) throw new Error('Command working directory is not a folder')
    return cwd
  }

  private detachChild(child: ChildProcess): void {
    child.unref()
  }
}
