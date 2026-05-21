import { clipboard, contextBridge, ipcRenderer } from 'electron'
import type { AtlasAppState, CanvasDocument } from '@shared/schema'

type Listener<T> = (payload: T) => void

function on<T>(channel: string, listener: Listener<T>): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const atlasApi = {
  appState: {
    get: () => ipcRenderer.invoke('app-state:get', {}) as Promise<AtlasAppState>
  },
  canvas: {
    list: () => ipcRenderer.invoke('canvas:list', {}) as Promise<CanvasDocument[]>,
    get: (canvasId: string) => ipcRenderer.invoke('canvas:get', { canvasId }) as Promise<CanvasDocument>,
    create: (name?: string) => ipcRenderer.invoke('canvas:create', { name }) as Promise<{ appState: AtlasAppState; canvas: CanvasDocument }>,
    save: (canvas: CanvasDocument) => ipcRenderer.invoke('canvas:save', { canvas }) as Promise<CanvasDocument>,
    setActive: (canvasId: string) => ipcRenderer.invoke('canvas:set-active', { canvasId }) as Promise<AtlasAppState>,
    delete: (canvasId: string) => ipcRenderer.invoke('canvas:delete', { canvasId }) as Promise<AtlasAppState>
  },
  filesystem: {
    chooseDirectory: (title?: string) => ipcRenderer.invoke('filesystem:choose-directory', { title }) as Promise<string | null>,
    listTree: (rootPath: string, maxDepth = 4) => ipcRenderer.invoke('filesystem:list-tree', { rootPath, maxDepth }),
    createFile: (rootPath: string, targetPath: string, name: string, contents = '') =>
      ipcRenderer.invoke('filesystem:create-file', { rootPath, targetPath, name, contents }),
    createFolder: (rootPath: string, targetPath: string, name: string) =>
      ipcRenderer.invoke('filesystem:create-folder', { rootPath, targetPath, name }),
    rename: (rootPath: string, targetPath: string, name: string) =>
      ipcRenderer.invoke('filesystem:rename', { rootPath, targetPath, name }),
    move: (rootPath: string, sourcePath: string, destinationPath: string) =>
      ipcRenderer.invoke('filesystem:move', { rootPath, sourcePath, destinationPath }),
    trash: (rootPath: string, targetPath: string) => ipcRenderer.invoke('filesystem:trash', { rootPath, targetPath }),
    readFile: (rootPath: string, targetPath: string) => ipcRenderer.invoke('filesystem:read-file', { rootPath, targetPath }),
    writeFile: (rootPath: string, targetPath: string, contents: string) =>
      ipcRenderer.invoke('filesystem:write-file', { rootPath, targetPath, contents }),
    search: (rootPath: string, query: string, limit = 50) => ipcRenderer.invoke('filesystem:search', { rootPath, query, limit }),
    watch: (rootPath: string) => ipcRenderer.invoke('filesystem:watch', { rootPath }) as Promise<{ watchId: string }>,
    unwatch: (watchId: string) => ipcRenderer.invoke('filesystem:unwatch', { watchId }),
    onWatchEvent: (listener: Listener<{ watchId: string; eventName: string; path: string }>) => on('filesystem:watch-event', listener)
  },
  terminal: {
    create: (input: { componentId: string; cwd?: string; shell?: string; cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:create', input) as Promise<{ sessionId: string; cwd: string; shell: string }>,
    write: (sessionId: string, data: string) => ipcRenderer.invoke('terminal:write', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', { sessionId, cols, rows }),
    close: (sessionId: string) => ipcRenderer.invoke('terminal:close', { sessionId }),
    closeComponent: (componentId: string) => ipcRenderer.invoke('terminal:close-component', { componentId }),
    onData: (sessionId: string, listener: Listener<string>) =>
      on<{ sessionId: string; data: string }>('terminal:data', (payload) => {
        if (payload.sessionId === sessionId) listener(payload.data)
      }),
    onExit: (sessionId: string, listener: Listener<{ exitCode: number; signal?: number }>) =>
      on<{ sessionId: string; exitCode: number; signal?: number }>('terminal:exit', (payload) => {
        if (payload.sessionId === sessionId) listener(payload)
      }),
    onCwd: (sessionId: string, listener: Listener<string>) =>
      on<{ sessionId: string; cwd: string }>('terminal:cwd', (payload) => {
        if (payload.sessionId === sessionId) listener(payload.cwd)
      })
  },
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text: string) => clipboard.writeText(text)
  },
  browser: {
    createTab: (input: { componentId: string; url: string; partition?: string }) => ipcRenderer.invoke('browser:create-tab', input),
    setBounds: (input: { tabId: string; visible: boolean; bounds: { x: number; y: number; width: number; height: number } }) =>
      ipcRenderer.invoke('browser:set-bounds', input),
    navigate: (tabId: string, url: string) => ipcRenderer.invoke('browser:navigate', { tabId, url }),
    back: (tabId: string) => ipcRenderer.invoke('browser:back', { tabId }),
    forward: (tabId: string) => ipcRenderer.invoke('browser:forward', { tabId }),
    reload: (tabId: string) => ipcRenderer.invoke('browser:reload', { tabId }),
    devtools: (tabId: string) => ipcRenderer.invoke('browser:devtools', { tabId }),
    capture: (tabId: string) => ipcRenderer.invoke('browser:capture', { tabId }) as Promise<string>,
    queryText: (tabId: string, selector: string) => ipcRenderer.invoke('browser:query-text', { tabId, selector }),
    click: (tabId: string, selector: string) => ipcRenderer.invoke('browser:click', { tabId, selector }),
    type: (tabId: string, selector: string, text: string) => ipcRenderer.invoke('browser:type', { tabId, selector, text }),
    closeTab: (tabId: string) => ipcRenderer.invoke('browser:close-tab', { tabId }),
    onTabUpdated: (listener: Listener<{ tabId: string; patch: Record<string, unknown> }>) => on('browser:tab-updated', listener)
  }
}

contextBridge.exposeInMainWorld('atlas', atlasApi)

export type AtlasApi = typeof atlasApi
