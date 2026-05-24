import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dialog, shell, type WebContents } from 'electron'
import fg from 'fast-glob'
import chokidar, { type FSWatcher } from 'chokidar'
import { z } from 'zod'
import {
  chooseDirectoryInputSchema,
  fileOperationInputSchema,
  filePathInputSchema,
  listTreeInputSchema,
  moveFileInputSchema,
  searchFilesInputSchema,
  watchDirectoryInputSchema
} from '@shared/ipc'
import type { FileEntry } from '@shared/schema'
import { translateShared } from '@shared/locale-text'
import { assertInsideRoot, childPath, sanitizeFileName } from './path-safety'
import { handleValidated } from './ipc-helpers'

const FILESYSTEM_SCAN_DEPTH = 64

export class FileSystemService {
  private readonly watchers = new Map<string, FSWatcher>()

  registerIpc(): void {
    handleValidated('filesystem:choose-directory', chooseDirectoryInputSchema, async (_, input) => {
      const result = await dialog.showOpenDialog({
        title: input.title ?? translateShared(undefined, 'filesystem.chooseFolder'),
        properties: ['openDirectory', 'createDirectory']
      })

      return result.canceled ? null : result.filePaths[0]
    })

    handleValidated('filesystem:list-tree', listTreeInputSchema, async (_, input) => {
      const rootPath = assertInsideRoot(input.rootPath, input.rootPath)
      const targetPath = assertInsideRoot(rootPath, input.targetPath ?? rootPath)
      return this.readTree(rootPath, targetPath, input.maxDepth)
    })

    handleValidated('filesystem:create-file', fileOperationInputSchema, async (_, input) => {
      if (!input.name) throw new Error('File name is required')
      const filePath = childPath(input.rootPath, input.targetPath, input.name)
      await writeFile(filePath, input.contents ?? '', { flag: 'wx' })
      return this.entryFor(input.rootPath, filePath, 0)
    })

    handleValidated('filesystem:create-folder', fileOperationInputSchema, async (_, input) => {
      if (!input.name) throw new Error('Folder name is required')
      const folderPath = childPath(input.rootPath, input.targetPath, input.name)
      await mkdir(folderPath, { recursive: false })
      return this.entryFor(input.rootPath, folderPath, 0)
    })

    handleValidated('filesystem:rename', fileOperationInputSchema, async (_, input) => {
      if (!input.name) throw new Error('New name is required')
      const sourcePath = assertInsideRoot(input.rootPath, input.targetPath)
      const destinationPath = assertInsideRoot(input.rootPath, join(dirname(sourcePath), sanitizeFileName(input.name)))
      await rename(sourcePath, destinationPath)
      return this.entryFor(input.rootPath, destinationPath, 0)
    })

    handleValidated('filesystem:move', moveFileInputSchema, async (_, input) => {
      const sourcePath = assertInsideRoot(input.rootPath, input.sourcePath)
      const destinationPath = assertInsideRoot(input.rootPath, input.destinationPath)
      await rename(sourcePath, destinationPath)
      return this.entryFor(input.rootPath, destinationPath, 0)
    })

    handleValidated('filesystem:trash', fileOperationInputSchema, async (_, input) => {
      const targetPath = assertInsideRoot(input.rootPath, input.targetPath)
      await shell.trashItem(targetPath)
      return { ok: true }
    })

    handleValidated('filesystem:reveal-in-folder', filePathInputSchema, async (_, input) => {
      const targetPath = assertInsideRoot(input.rootPath, input.targetPath)
      await stat(targetPath)
      shell.showItemInFolder(targetPath)
      return { ok: true }
    })

    handleValidated('filesystem:read-file', fileOperationInputSchema, async (_, input) => {
      const targetPath = assertInsideRoot(input.rootPath, input.targetPath)
      return readFile(targetPath, 'utf8')
    })

    handleValidated('filesystem:write-file', fileOperationInputSchema, async (_, input) => {
      const targetPath = assertInsideRoot(input.rootPath, input.targetPath)
      await writeFile(targetPath, input.contents ?? '', 'utf8')
      return { ok: true }
    })

    handleValidated('filesystem:search', searchFilesInputSchema, async (_, input) => {
      const rootPath = assertInsideRoot(input.rootPath, input.rootPath)
      const results = await fg('**/*', {
        cwd: rootPath,
        dot: true,
        onlyFiles: false,
        deep: FILESYSTEM_SCAN_DEPTH,
        unique: true
      })
      const lowerQuery = input.query.toLowerCase()
      return results
        .filter((item) => item.toLowerCase().includes(lowerQuery))
        .slice(0, input.limit)
        .map((item) => join(rootPath, item))
    })

    handleValidated('filesystem:watch', watchDirectoryInputSchema, (event, input) => this.watch(event.sender, input.rootPath))
    handleValidated('filesystem:unwatch', z.object({ watchId: z.string() }), (_, input) => this.unwatch(input.watchId))
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      void watcher.close()
    }
    this.watchers.clear()
  }

  private watch(webContents: WebContents, rootPathInput: string): { watchId: string } {
    const rootPath = assertInsideRoot(rootPathInput, rootPathInput)
    const watchId = randomUUID()
    const watcher = chokidar.watch(rootPath, {
      ignoreInitial: true,
      depth: FILESYSTEM_SCAN_DEPTH
    })

    watcher.on('all', (eventName, targetPath) => {
      if (!webContents.isDestroyed()) {
        webContents.send('filesystem:watch-event', { watchId, eventName, path: targetPath })
      }
    })

    webContents.once('destroyed', () => {
      void watcher.close()
      this.watchers.delete(watchId)
    })

    this.watchers.set(watchId, watcher)
    return { watchId }
  }

  private async unwatch(watchId: string): Promise<{ ok: true }> {
    const watcher = this.watchers.get(watchId)
    if (watcher) {
      await watcher.close()
      this.watchers.delete(watchId)
    }
    return { ok: true }
  }

  private async readTree(rootPath: string, targetPath: string, maxDepth: number): Promise<FileEntry> {
    const entry = await this.entryFor(rootPath, targetPath, maxDepth)
    return entry
  }

  private async entryFor(rootPath: string, targetPath: string, depth: number): Promise<FileEntry> {
    const safePath = assertInsideRoot(rootPath, targetPath)
    const info = await lstat(safePath)
    const kind = info.isDirectory() ? 'directory' : 'file'
    const entry: FileEntry = {
      id: safePath,
      name: safePath === rootPath ? safePath : safePath.split(/[\\/]/).at(-1) ?? safePath,
      path: safePath,
      kind,
      size: kind === 'file' ? info.size : undefined,
      modifiedAt: info.mtime.toISOString()
    }

    if (kind === 'directory' && depth > 0) {
      entry.childrenLoaded = true
      const dirents = await readdir(safePath, { withFileTypes: true })
      entry.children = await Promise.all(
        dirents
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
          .map((dirent) => this.entryFor(rootPath, join(safePath, dirent.name), depth - 1))
      )
    } else if (kind === 'directory') {
      entry.childrenLoaded = false
    }

    return entry
  }
}
