import { watch as watchFileSystem, type Dirent, type FSWatcher } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { dialog, shell, type WebContents } from 'electron'
import fg from 'fast-glob'
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

type NodeFileSystem = typeof import('node:fs')

const requireFromHere = createRequire(import.meta.url)
const realFileSystem = loadRealFileSystem()
const realFileSystemAdapter: fg.FileSystemAdapter = {
  lstat: realFileSystem.lstat,
  lstatSync: realFileSystem.lstatSync,
  stat: realFileSystem.stat,
  statSync: realFileSystem.statSync,
  readdir: realFileSystem.readdir,
  readdirSync: realFileSystem.readdirSync
}

function loadRealFileSystem(): NodeFileSystem {
  try {
    return requireFromHere('original-fs') as NodeFileSystem
  } catch {
    return requireFromHere('node:fs') as NodeFileSystem
  }
}

type WatcherRecord = {
  watcher: FSWatcher
  ownerId: number
}

type OwnerWatcherCleanup = {
  watchIds: Set<string>
  webContents: WebContents
  destroyedListener: () => void
}

export class FileSystemService {
  private readonly watchers = new Map<string, WatcherRecord>()
  private readonly ownerCleanupById = new Map<number, OwnerWatcherCleanup>()

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
        unique: true,
        fs: realFileSystemAdapter
      })
      const lowerQuery = input.query.toLowerCase()
      return results
        .filter((item) => item.toLowerCase().includes(lowerQuery))
        .slice(0, input.limit)
        .map((item) => join(rootPath, item))
    })

    handleValidated('filesystem:watch', watchDirectoryInputSchema, (event, input) =>
      this.watch(event.sender, input.rootPath, input.targetPath ?? input.rootPath)
    )
    handleValidated('filesystem:unwatch', z.object({ watchId: z.string() }), (_, input) => this.unwatch(input.watchId))
  }

  dispose(): void {
    for (const watchId of [...this.watchers.keys()]) {
      void this.closeWatch(watchId)
    }
  }

  private watch(webContents: WebContents, rootPathInput: string, targetPathInput: string): { watchId: string } {
    const rootPath = assertInsideRoot(rootPathInput, rootPathInput)
    const targetPath = assertInsideRoot(rootPath, targetPathInput)
    const watchId = randomUUID()
    const watcher = watchFileSystem(targetPath, { persistent: true }, (eventName, fileName) => {
      if (!webContents.isDestroyed()) {
        const eventPath = fileName ? join(targetPath, fileName.toString()) : targetPath
        webContents.send('filesystem:watch-event', { watchId, eventName, path: eventPath })
      }
    })

    this.watchers.set(watchId, { watcher, ownerId: webContents.id })
    this.trackOwnerWatch(webContents, watchId)
    return { watchId }
  }

  private async unwatch(watchId: string): Promise<{ ok: true }> {
    await this.closeWatch(watchId)
    return { ok: true }
  }

  private closeWatch(watchId: string): Promise<void> {
    const record = this.watchers.get(watchId)
    if (!record) return Promise.resolve()

    this.watchers.delete(watchId)
    this.untrackOwnerWatch(record.ownerId, watchId)
    record.watcher.close()
    return Promise.resolve()
  }

  private trackOwnerWatch(webContents: WebContents, watchId: string): void {
    const ownerId = webContents.id
    const existing = this.ownerCleanupById.get(ownerId)
    if (existing) {
      existing.watchIds.add(watchId)
      return
    }

    const cleanup: OwnerWatcherCleanup = {
      watchIds: new Set([watchId]),
      webContents,
      destroyedListener: () => {
        void this.closeWatchesByOwner(ownerId)
      }
    }
    this.ownerCleanupById.set(ownerId, cleanup)
    webContents.once('destroyed', cleanup.destroyedListener)
  }

  private untrackOwnerWatch(ownerId: number, watchId: string): void {
    const cleanup = this.ownerCleanupById.get(ownerId)
    if (!cleanup) return

    cleanup.watchIds.delete(watchId)
    if (cleanup.watchIds.size > 0) return

    this.ownerCleanupById.delete(ownerId)
    if (!cleanup.webContents.isDestroyed()) {
      cleanup.webContents.removeListener('destroyed', cleanup.destroyedListener)
    }
  }

  private async closeWatchesByOwner(ownerId: number): Promise<void> {
    const cleanup = this.ownerCleanupById.get(ownerId)
    if (!cleanup) return

    for (const watchId of [...cleanup.watchIds]) {
      await this.closeWatch(watchId)
    }
  }

  private async readTree(rootPath: string, targetPath: string, maxDepth: number): Promise<FileEntry> {
    const entry = await this.entryFor(rootPath, targetPath, maxDepth)
    return entry
  }

  private async entryFor(rootPath: string, targetPath: string, depth: number, dirent?: Dirent): Promise<FileEntry> {
    const safePath = assertInsideRoot(rootPath, targetPath)
    const info = dirent ? null : await realFileSystem.promises.lstat(safePath)
    const kind = dirent ? (dirent.isDirectory() ? 'directory' : 'file') : info?.isDirectory() ? 'directory' : 'file'
    const entry: FileEntry = {
      id: safePath,
      name: safePath === rootPath ? safePath : safePath.split(/[\\/]/).at(-1) ?? safePath,
      path: safePath,
      kind,
      size: !dirent && kind === 'file' ? info?.size : undefined,
      modifiedAt: info?.mtime.toISOString()
    }

    if (kind === 'directory' && depth > 0) {
      entry.childrenLoaded = true
      const dirents = await realFileSystem.promises.readdir(safePath, { withFileTypes: true })
      entry.children = await Promise.all(
        dirents
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
          .map((childDirent) => this.entryFor(rootPath, join(safePath, childDirent.name), depth - 1, childDirent))
      )
    } else if (kind === 'directory') {
      entry.childrenLoaded = false
    }

    return entry
  }
}
