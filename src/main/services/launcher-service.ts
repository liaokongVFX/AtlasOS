import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { app, dialog, shell } from 'electron'
import { launcherChooseFileInputSchema, launcherOpenInputSchema, type LauncherChooseFileResult, type LauncherOpenInput } from '@shared/ipc'
import { handleValidated } from './ipc-helpers'

const APP_FILE_FILTERS: Electron.FileFilter[] = [
  { name: 'Applications and shortcuts', extensions: ['exe', 'lnk', 'bat', 'cmd', 'ps1', 'com'] },
  { name: 'All files', extensions: ['*'] }
]

const ANY_FILE_FILTERS: Electron.FileFilter[] = [{ name: 'All files', extensions: ['*'] }]

export class LauncherService {
  constructor(
    private readonly platform = process.platform,
    private readonly spawnProcess: typeof spawn = spawn,
    private readonly getFileIcon: typeof app.getFileIcon = app.getFileIcon.bind(app),
    private readonly readShortcutLink: typeof shell.readShortcutLink = shell.readShortcutLink.bind(shell)
  ) {}

  registerIpc(): void {
    handleValidated('launcher:choose-file', launcherChooseFileInputSchema, async (_, input) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: input.kind === 'app' ? APP_FILE_FILTERS : ANY_FILE_FILTERS
      })

      if (result.canceled) return null

      const targetPath = result.filePaths[0]
      if (!targetPath) return null

      return {
        path: targetPath,
        iconDataUrl: await this.readIconDataUrl(targetPath)
      } satisfies LauncherChooseFileResult
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

  private async readIconDataUrl(targetPath: string): Promise<string | null> {
    const iconSourcePath = this.shortcutIconSourcePath(targetPath) ?? targetPath
    const iconDataUrl = await this.readFileIconDataUrl(iconSourcePath)
    if (iconDataUrl || iconSourcePath === targetPath) return iconDataUrl

    return this.readFileIconDataUrl(targetPath)
  }

  private async readFileIconDataUrl(targetPath: string): Promise<string | null> {
    try {
      const icon = await this.getFileIcon(targetPath, { size: 'normal' })
      return icon.isEmpty() ? null : icon.toDataURL()
    } catch {
      return null
    }
  }

  private shortcutIconSourcePath(targetPath: string): string | null {
    if (this.platform !== 'win32' || !targetPath.toLowerCase().endsWith('.lnk')) return null

    try {
      const shortcut = this.readShortcutLink(targetPath)
      return this.expandWindowsEnvironmentPath(shortcut.icon?.trim() || shortcut.target.trim()) || null
    } catch {
      return null
    }
  }

  private expandWindowsEnvironmentPath(targetPath: string): string {
    return targetPath.replace(
      /%([^%]+)%/g,
      (match, name) => process.env[name] ?? process.env[name.toUpperCase()] ?? process.env[name.toLowerCase()] ?? match
    )
  }

  private async openCommand(shellKind: 'cmd' | 'powershell', command: string, cwd?: string): Promise<void> {
    if (this.platform !== 'win32') {
      throw new Error('Command shortcuts are only supported on Windows')
    }

    const resolvedCwd = cwd ? await this.validateCommandCwd(cwd) : undefined
    const file = 'cmd.exe'
    const args = ['/d', '/s', '/c', 'start', '', ...this.commandWindowArgs(shellKind, command)]
    const options: Parameters<typeof spawn>[2] = {
      cwd: resolvedCwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    }

    const child = this.spawnProcess(file, args, options)
    this.detachChild(child)
  }

  private commandWindowArgs(shellKind: 'cmd' | 'powershell', command: string): string[] {
    if (shellKind === 'cmd') return ['cmd.exe', '/d', '/s', '/k', command]
    return ['powershell.exe', '-NoLogo', '-NoExit', '-Command', command]
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
