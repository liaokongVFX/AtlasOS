import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PluginConfig, PluginDiagnosticEntry, PluginInfo, PluginSettings } from '@shared/plugins'
import type { LauncherOpenInput, PetAgentEventInput } from '@shared/ipc'
import type { PetAlertTarget, PetRuntimeState, PetSettings } from '@shared/pet'
import type { AppSettings, AtlasAppState, CanvasDocument } from '@shared/schema'
import type { SystemMetricsSnapshot } from '@shared/system-metrics'

type Listener<T> = (payload: T) => void

type OpenSettingsRequest = {
  sectionId?: string
}

type SavedClipboardImageResult =
  | {
      saved: true
      path: string
      width: number
      height: number
      byteLength: number
      formats: string[]
    }
  | {
      saved: false
      reason: 'empty'
      formats: string[]
    }

type NativeClipboardFilesResult = {
  paths: string[]
  formats: string[]
}

function on<T>(channel: string, listener: Listener<T>): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const atlasApi = {
  app: {
    onOpenSettings: (listener: Listener<OpenSettingsRequest | undefined>) => on('app:open-settings', listener),
    onOpenTarget: (listener: Listener<PetAlertTarget>) => on('app:open-target', listener)
  },
  appState: {
    get: () => ipcRenderer.invoke('app-state:get', {}) as Promise<AtlasAppState>
  },
  appSettings: {
    get: () => ipcRenderer.invoke('app-settings:get', {}) as Promise<AppSettings>,
    update: (settings: AppSettings) => ipcRenderer.invoke('app-settings:update', { settings }) as Promise<AppSettings>
  },
  canvas: {
    list: () => ipcRenderer.invoke('canvas:list', {}) as Promise<CanvasDocument[]>,
    get: (canvasId: string) => ipcRenderer.invoke('canvas:get', { canvasId }) as Promise<CanvasDocument>,
    create: (name?: string) => ipcRenderer.invoke('canvas:create', { name }) as Promise<{ appState: AtlasAppState; canvas: CanvasDocument }>,
    save: (canvas: CanvasDocument) => ipcRenderer.invoke('canvas:save', { canvas }) as Promise<CanvasDocument>,
    setActive: (canvasId: string) => ipcRenderer.invoke('canvas:set-active', { canvasId }) as Promise<AtlasAppState>,
    reorder: (canvasOrder: string[]) => ipcRenderer.invoke('canvas:reorder', { canvasOrder }) as Promise<AtlasAppState>,
    delete: (canvasId: string) => ipcRenderer.invoke('canvas:delete', { canvasId }) as Promise<AtlasAppState>
  },
  filesystem: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    chooseDirectory: (title?: string) => ipcRenderer.invoke('filesystem:choose-directory', { title }) as Promise<string | null>,
    listTree: (rootPath: string, targetPathOrMaxDepth: string | number = rootPath, maxDepth = 1) => {
      const targetPath = typeof targetPathOrMaxDepth === 'number' ? rootPath : targetPathOrMaxDepth
      const depth = typeof targetPathOrMaxDepth === 'number' ? targetPathOrMaxDepth : maxDepth
      return ipcRenderer.invoke('filesystem:list-tree', { rootPath, targetPath, maxDepth: depth })
    },
    createFile: (rootPath: string, targetPath: string, name: string, contents = '') =>
      ipcRenderer.invoke('filesystem:create-file', { rootPath, targetPath, name, contents }),
    createFolder: (rootPath: string, targetPath: string, name: string) =>
      ipcRenderer.invoke('filesystem:create-folder', { rootPath, targetPath, name }),
    rename: (rootPath: string, targetPath: string, name: string) =>
      ipcRenderer.invoke('filesystem:rename', { rootPath, targetPath, name }),
    move: (rootPath: string, sourcePath: string, destinationPath: string) =>
      ipcRenderer.invoke('filesystem:move', { rootPath, sourcePath, destinationPath }),
    trash: (rootPath: string, targetPath: string) => ipcRenderer.invoke('filesystem:trash', { rootPath, targetPath }),
    revealInFolder: (rootPath: string, targetPath: string) =>
      ipcRenderer.invoke('filesystem:reveal-in-folder', { rootPath, targetPath }) as Promise<{ ok: true }>,
    readFile: (rootPath: string, targetPath: string) => ipcRenderer.invoke('filesystem:read-file', { rootPath, targetPath }),
    writeFile: (rootPath: string, targetPath: string, contents: string) =>
      ipcRenderer.invoke('filesystem:write-file', { rootPath, targetPath, contents }),
    search: (rootPath: string, query: string, limit = 50) => ipcRenderer.invoke('filesystem:search', { rootPath, query, limit }),
    watch: (rootPath: string) => ipcRenderer.invoke('filesystem:watch', { rootPath }) as Promise<{ watchId: string }>,
    unwatch: (watchId: string) => ipcRenderer.invoke('filesystem:unwatch', { watchId }),
    onWatchEvent: (listener: Listener<{ watchId: string; eventName: string; path: string }>) => on('filesystem:watch-event', listener)
  },
  terminal: {
    create: (input: { componentId: string; canvasId?: string; title?: string; cwd?: string; shell?: string; cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:create', input) as Promise<{ sessionId: string; cwd: string; shell: string }>,
    write: (sessionId: string, data: string) => ipcRenderer.invoke('terminal:write', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', { sessionId, cols, rows }),
    close: (sessionId: string) => ipcRenderer.invoke('terminal:close', { sessionId }),
    closeComponent: (componentId: string) => ipcRenderer.invoke('terminal:close-component', { componentId }),
    savePastedAsset: (input: { dataBase64: string; mimeType?: string; sourceName?: string }) =>
      ipcRenderer.invoke('terminal:save-pasted-asset', input) as Promise<{ path: string }>,
    saveClipboardImage: () => ipcRenderer.invoke('terminal:save-clipboard-image', {}) as Promise<SavedClipboardImageResult>,
    readClipboardFiles: () => ipcRenderer.invoke('terminal:read-clipboard-files', {}) as Promise<NativeClipboardFilesResult>,
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
  launcher: {
    chooseFile: (input: { kind: 'app' | 'file' }) => ipcRenderer.invoke('launcher:choose-file', input) as Promise<string | null>,
    open: (input: LauncherOpenInput) => ipcRenderer.invoke('launcher:open', input) as Promise<{ ok: true }>
  },
  systemMetrics: {
    get: () => ipcRenderer.invoke('system-metrics:get', {}) as Promise<SystemMetricsSnapshot>
  },
  pet: {
    getState: () => ipcRenderer.invoke('pet:get-state', {}) as Promise<PetRuntimeState>,
    updateSettings: (settings: PetSettings) => ipcRenderer.invoke('pet:update-settings', { settings }) as Promise<PetSettings>,
    ackAlert: (alertId: string) => ipcRenderer.invoke('pet:ack-alert', { alertId }) as Promise<{ ok: true }>,
    snoozeAlert: (alertId: string, minutes: number) => ipcRenderer.invoke('pet:snooze-alert', { alertId, minutes }) as Promise<{ ok: true }>,
    setPosition: (position: { x: number; y: number }) => ipcRenderer.invoke('pet:set-position', position) as Promise<{ x: number; y: number }>,
    setInteractive: (interactive: boolean) => ipcRenderer.invoke('pet:set-interactive', { interactive }) as Promise<{ ok: true }>,
    openTarget: (target: PetAlertTarget) => ipcRenderer.invoke('pet:open-target', { target }) as Promise<{ ok: true }>,
    sendAgentEvent: (event: PetAgentEventInput) => ipcRenderer.invoke('pet:agent-event', event) as Promise<{ ok: true }>,
    listAgentSessions: () => ipcRenderer.invoke('pet:list-agent-sessions', {}) as Promise<PetRuntimeState['agentSessions']>,
    onStateUpdated: (listener: Listener<PetRuntimeState>) => on('pet:state-updated', listener)
  },
  browser: {
    createTab: (input: { componentId: string; url: string; partition?: string }) => ipcRenderer.invoke('browser:create-tab', input),
    setBounds: (input: {
      tabId: string
      visible: boolean
      bounds: { x: number; y: number; width: number; height: number }
      contentBounds?: { x: number; y: number; width: number; height: number }
    }) => ipcRenderer.invoke('browser:set-bounds', input),
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
    onTabUpdated: (listener: Listener<{ tabId: string; patch: Record<string, unknown> }>) => on('browser:tab-updated', listener),
    onOpenTabRequested: (listener: Listener<{ componentId: string; sourceTabId: string; url: string }>) =>
      on('browser:open-tab-requested', listener),
    onWebviewOpenTabRequested: (listener: Listener<{ sourceWebContentsId: number; url: string }>) =>
      on('browser:webview-open-tab-requested', listener)
  },
  plugins: {
    getSettings: () => ipcRenderer.invoke('plugins:get-settings', {}) as Promise<PluginSettings>,
    setRootDirectory: (rootPath: string) => ipcRenderer.invoke('plugins:set-root-directory', { rootPath }) as Promise<PluginSettings>,
    scanRootDirectory: () => ipcRenderer.invoke('plugins:scan-root-directory', {}) as Promise<PluginInfo[]>,
    list: () => ipcRenderer.invoke('plugins:list', {}) as Promise<PluginInfo[]>,
    installDirectory: (sourcePath?: string, dialogTitle?: string) =>
      ipcRenderer.invoke('plugins:install-directory', { sourcePath, dialogTitle }) as Promise<PluginInfo | null>,
    enable: (pluginId: string) => ipcRenderer.invoke('plugins:enable', { pluginId }) as Promise<PluginInfo>,
    disable: (pluginId: string) => ipcRenderer.invoke('plugins:disable', { pluginId }) as Promise<PluginInfo>,
    uninstall: (pluginId: string) => ipcRenderer.invoke('plugins:uninstall', { pluginId }) as Promise<{ ok: true }>,
    reload: (pluginId: string) => ipcRenderer.invoke('plugins:reload', { pluginId }) as Promise<PluginInfo>,
    updateConfig: (pluginId: string, config: PluginConfig) => ipcRenderer.invoke('plugins:update-config', { pluginId, config }) as Promise<PluginInfo>,
    diagnostics: (pluginId: string) => ipcRenderer.invoke('plugins:diagnostics', { pluginId }) as Promise<PluginDiagnosticEntry[]>,
    invoke: (pluginId: string, command: string, input?: unknown) => ipcRenderer.invoke('plugins:invoke', { pluginId, command, input }) as Promise<unknown>
  }
}

contextBridge.exposeInMainWorld('atlas', atlasApi)

export type AtlasApi = typeof atlasApi
