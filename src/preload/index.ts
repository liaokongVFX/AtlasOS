import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AiProfileDraft,
  AiScreenshotCaptureSession,
  AiScreenshotCaptureSource,
  AiScreenshotImageInput,
  AiScreenshotTextResult,
  AiSettings,
  AiTranslationRequest
} from '@shared/ai'
import type { AgentUsageDayDetail, AgentUsageIndexStatus, AgentUsageYearResult } from '@shared/agent-usage'
import type { PluginConfig, PluginDiagnosticEntry, PluginInfo, PluginSettings } from '@shared/plugins'
import type { GitDiffInput, LauncherChooseFileResult, LauncherOpenInput } from '@shared/ipc'
import type { PetAlertTarget, PetRuntimeState, PetSettings } from '@shared/pet'
import type { AppSettings, AppSettingsPatch, AtlasAppState, CanvasDocument, FileEntry } from '@shared/schema'
import type { TerminalEnvironment } from '@shared/terminal-environment'
import type {
  RemoteServerConnectResult,
  RemoteServerProfileDraft,
  RemoteServerSettings,
  RemoteServerStatusSnapshot
} from '@shared/remote-servers'
import type { SystemMetricsSnapshot } from '@shared/system-metrics'
import type { TerminalAgentCommandEvent, TerminalAgentSessionEndedEvent } from '@shared/terminal-agent'
import type { AtlasUpdateState } from '@shared/updates'
import type { ClaudeHistoryListResult, ClaudeHistorySessionDetail } from '@shared/claude-history'
import type { CodexHistoryListResult, CodexHistorySessionDetail } from '@shared/codex-history'
import type { GitBranchSummary, GitCommitSummary, GitDiffResult, GitOperationResult, GitStashEntry, GitStatusSnapshot, GitSummary } from '@shared/git'

type Listener<T> = (payload: T) => void

const AI_SCREENSHOT_CAPTURE_SESSION_CHANNEL = 'ai:screenshot-capture-session'

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
    update: (settings: AppSettings) => ipcRenderer.invoke('app-settings:update', { settings }) as Promise<AppSettings>,
    patch: (patch: AppSettingsPatch) => ipcRenderer.invoke('app-settings:patch', { patch }) as Promise<AppSettings>
  },
  ai: {
    getSettings: () => ipcRenderer.invoke('ai:get-settings', {}) as Promise<AiSettings>,
    saveProfile: (profile: AiProfileDraft, apiKey?: string) => ipcRenderer.invoke('ai:save-profile', { profile, apiKey }) as Promise<AiSettings>,
    deleteProfile: (profileId: string) => ipcRenderer.invoke('ai:delete-profile', { profileId }) as Promise<AiSettings>,
    setProfileApiKey: (profileId: string, apiKey: string) => ipcRenderer.invoke('ai:set-profile-api-key', { profileId, apiKey }) as Promise<AiSettings>,
    clearProfileApiKey: (profileId: string) => ipcRenderer.invoke('ai:clear-profile-api-key', { profileId }) as Promise<AiSettings>,
    updateTranslationSettings: (patch: Partial<AiSettings['translation']>) =>
      ipcRenderer.invoke('ai:update-translation-settings', { patch }) as Promise<AiSettings>,
    updateDailySummarySettings: (patch: Partial<AiSettings['dailySummary']>) =>
      ipcRenderer.invoke('ai:update-daily-summary-settings', { patch }) as Promise<AiSettings>,
    openTranslator: (input: { text: string; source: AiTranslationRequest['source'] }) => ipcRenderer.invoke('ai:open-translator', input) as Promise<AiTranslationRequest>,
    translate: (input: { text: string; profileId?: string; model?: string; targetLanguage?: string }) =>
      ipcRenderer.invoke('ai:translate', input) as Promise<{ text: string }>,
    getActiveTranslationRequest: () => ipcRenderer.invoke('ai:get-active-translation-request', {}) as Promise<AiTranslationRequest | null>,
    closeTranslator: () => ipcRenderer.invoke('ai:close-translator', {}) as Promise<{ ok: true }>,
    startScreenshotCapture: (input: { source: AiScreenshotCaptureSource }) =>
      ipcRenderer.invoke('ai:start-screenshot-capture', input) as Promise<AiScreenshotCaptureSession>,
    getActiveScreenshotCapture: () => ipcRenderer.invoke('ai:get-active-screenshot-capture', {}) as Promise<AiScreenshotCaptureSession | null>,
    ocrScreenshot: (input: AiScreenshotImageInput) => ipcRenderer.invoke('ai:ocr-screenshot', input) as Promise<AiScreenshotTextResult>,
    translateScreenshot: (input: AiScreenshotImageInput) => ipcRenderer.invoke('ai:translate-screenshot', input) as Promise<AiScreenshotTextResult>,
    copyScreenshotImage: (input: AiScreenshotImageInput) => ipcRenderer.invoke('ai:copy-screenshot-image', input) as Promise<{ ok: true }>,
    closeScreenshotCapture: () => ipcRenderer.invoke('ai:close-screenshot-capture', {}) as Promise<{ ok: true }>,
    onTranslationRequest: (listener: Listener<AiTranslationRequest>) => on('ai:translation-request', listener),
    onScreenshotCaptureSession: (listener: Listener<AiScreenshotCaptureSession | null>) => on(AI_SCREENSHOT_CAPTURE_SESSION_CHANNEL, listener)
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
    watch: (rootPath: string, targetPath = rootPath) =>
      ipcRenderer.invoke('filesystem:watch', { rootPath, targetPath }) as Promise<{ watchId: string }>,
    unwatch: (watchId: string) => ipcRenderer.invoke('filesystem:unwatch', { watchId }),
    onWatchEvent: (listener: Listener<{ watchId: string; eventName: string; path: string }>) => on('filesystem:watch-event', listener)
  },
  terminal: {
    create: (input: { componentId: string; canvasId?: string; title?: string; cwd?: string; shell?: string; initialCommand?: string; environment?: TerminalEnvironment; autoConfirmWorkspaceTrust?: boolean; cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:create', input) as Promise<{ sessionId: string; cwd: string; shell: string; didRunInitialCommand?: boolean }>,
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
      }),
    onAgentCommand: (sessionId: string, listener: Listener<TerminalAgentCommandEvent>) =>
      on<TerminalAgentCommandEvent>('terminal:agent-command', (payload) => {
        if (payload.sessionId === sessionId) listener(payload)
      }),
    onAgentSessionEnded: (sessionId: string, listener: Listener<TerminalAgentSessionEndedEvent>) =>
      on<TerminalAgentSessionEndedEvent>('terminal:agent-session-ended', (payload) => {
        if (payload.sessionId === sessionId) listener(payload)
      })
  },
  remoteServers: {
    listProfiles: () => ipcRenderer.invoke('remote-servers:list-profiles', {}) as Promise<RemoteServerSettings>,
    saveProfile: (profile: RemoteServerProfileDraft) =>
      ipcRenderer.invoke('remote-servers:save-profile', { profile }) as Promise<RemoteServerSettings>,
    deleteProfile: (profileId: string) => ipcRenderer.invoke('remote-servers:delete-profile', { profileId }) as Promise<{ ok: true }>,
    testConnection: (profile: RemoteServerProfileDraft) => ipcRenderer.invoke('remote-servers:test-connection', { profile }),
    connect: (input: {
      componentId: string
      canvasId?: string
      profileId: string
      cols?: number
      rows?: number
      acceptHostKey?: boolean
      expectedHostKeyFingerprint?: string
    }) => ipcRenderer.invoke('remote-servers:connect', input) as Promise<RemoteServerConnectResult>,
    closeSession: (sessionId: string) => ipcRenderer.invoke('remote-servers:close-session', { sessionId }) as Promise<{ ok: true }>,
    closeComponent: (componentId: string) => ipcRenderer.invoke('remote-servers:close-component', { componentId }) as Promise<{ ok: true }>,
    write: (sessionId: string, data: string) => ipcRenderer.invoke('remote-servers:shell-write', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('remote-servers:shell-resize', { sessionId, cols, rows }),
    status: (sessionId: string) => ipcRenderer.invoke('remote-servers:status', { sessionId }) as Promise<RemoteServerStatusSnapshot>,
    listTree: (sessionId: string, rootPath: string, targetPathOrMaxDepth: string | number = rootPath, maxDepth = 1) => {
      const targetPath = typeof targetPathOrMaxDepth === 'number' ? rootPath : targetPathOrMaxDepth
      const depth = typeof targetPathOrMaxDepth === 'number' ? targetPathOrMaxDepth : maxDepth
      return ipcRenderer.invoke('remote-servers:list-tree', { sessionId, rootPath, targetPath, maxDepth: depth }) as Promise<FileEntry>
    },
    readFile: (sessionId: string, rootPath: string, targetPath: string) =>
      ipcRenderer.invoke('remote-servers:read-file', { sessionId, rootPath, targetPath }) as Promise<string>,
    writeFile: (sessionId: string, rootPath: string, targetPath: string, contents: string) =>
      ipcRenderer.invoke('remote-servers:write-file', { sessionId, rootPath, targetPath, contents }) as Promise<{ ok: true }>,
    createFile: (sessionId: string, rootPath: string, targetPath: string, name: string, contents = '') =>
      ipcRenderer.invoke('remote-servers:create-file', { sessionId, rootPath, targetPath, name, contents }) as Promise<FileEntry>,
    createFolder: (sessionId: string, rootPath: string, targetPath: string, name: string) =>
      ipcRenderer.invoke('remote-servers:create-folder', { sessionId, rootPath, targetPath, name }) as Promise<FileEntry>,
    rename: (sessionId: string, rootPath: string, targetPath: string, name: string) =>
      ipcRenderer.invoke('remote-servers:rename', { sessionId, rootPath, targetPath, name }) as Promise<FileEntry>,
    deletePath: (sessionId: string, rootPath: string, targetPath: string, recursive = true) =>
      ipcRenderer.invoke('remote-servers:delete', { sessionId, rootPath, targetPath, recursive }) as Promise<{ ok: true }>,
    upload: (sessionId: string, rootPath: string, targetPath: string, localPath: string, name?: string) =>
      ipcRenderer.invoke('remote-servers:upload', { sessionId, rootPath, targetPath, localPath, name }) as Promise<FileEntry>,
    download: (sessionId: string, rootPath: string, targetPath: string, localDirectory: string) =>
      ipcRenderer.invoke('remote-servers:download', { sessionId, rootPath, targetPath, localDirectory }) as Promise<{ path: string }>,
    onShellData: (sessionId: string, listener: Listener<string>) =>
      on<{ sessionId: string; data: string }>('remote-servers:shell-data', (payload) => {
        if (payload.sessionId === sessionId) listener(payload.data)
      }),
    onShellExit: (sessionId: string, listener: Listener<void>) =>
      on<{ sessionId: string }>('remote-servers:shell-exit', (payload) => {
        if (payload.sessionId === sessionId) listener()
      })
  },
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text: string) => clipboard.writeText(text)
  },
  launcher: {
    chooseFile: (input: { kind: 'app' | 'file' }) => ipcRenderer.invoke('launcher:choose-file', input) as Promise<LauncherChooseFileResult>,
    open: (input: LauncherOpenInput) => ipcRenderer.invoke('launcher:open', input) as Promise<{ ok: true }>
  },
  systemMetrics: {
    get: () => ipcRenderer.invoke('system-metrics:get', {}) as Promise<SystemMetricsSnapshot>
  },
  agentUsage: {
    refresh: () => ipcRenderer.invoke('agent-usage:refresh', {}) as Promise<AgentUsageIndexStatus>,
    getYear: (year?: number) => ipcRenderer.invoke('agent-usage:get-year', { year }) as Promise<AgentUsageYearResult>,
    getDay: (day: string) => ipcRenderer.invoke('agent-usage:get-day', { day }) as Promise<AgentUsageDayDetail>,
    generateSummary: (input: { day: string; locale?: string; regenerate?: boolean }) =>
      ipcRenderer.invoke('agent-usage:generate-summary', input) as Promise<AgentUsageDayDetail>
  },
  updates: {
    getState: () => ipcRenderer.invoke('updates:get-state', {}) as Promise<AtlasUpdateState>,
    check: () => ipcRenderer.invoke('updates:check', {}) as Promise<AtlasUpdateState>,
    download: () => ipcRenderer.invoke('updates:download', {}) as Promise<AtlasUpdateState>,
    dismissWindow: () => ipcRenderer.invoke('updates:dismiss-window', {}) as Promise<{ ok: true }>,
    installAndRestart: () => ipcRenderer.invoke('updates:install-and-restart', {}) as Promise<{ ok: true }>,
    onStateUpdated: (listener: Listener<AtlasUpdateState>) => on('updates:state-updated', listener)
  },
  claudeHistory: {
    list: () => ipcRenderer.invoke('claude-history:list', {}) as Promise<ClaudeHistoryListResult>,
    getSession: (input: { sessionId: string }) => ipcRenderer.invoke('claude-history:get-session', input) as Promise<ClaudeHistorySessionDetail>
  },
  codexHistory: {
    list: () => ipcRenderer.invoke('codex-history:list', {}) as Promise<CodexHistoryListResult>,
    getSession: (input: { sessionId: string }) => ipcRenderer.invoke('codex-history:get-session', input) as Promise<CodexHistorySessionDetail>
  },
  git: {
    chooseRepository: (title?: string) => ipcRenderer.invoke('git:choose-repository', { title }) as Promise<string | null>,
    summary: (repoPath: string) => ipcRenderer.invoke('git:summary', { repoPath }) as Promise<GitSummary>,
    status: (repoPath: string) => ipcRenderer.invoke('git:status', { repoPath }) as Promise<GitStatusSnapshot>,
    branches: (repoPath: string) => ipcRenderer.invoke('git:branches', { repoPath }) as Promise<GitBranchSummary[]>,
    log: (repoPath: string, input: { ref?: string; limit?: number; skip?: number } = {}) =>
      ipcRenderer.invoke('git:log', { repoPath, ...input }) as Promise<GitCommitSummary[]>,
    commitDetail: (repoPath: string, commitHash: string) =>
      ipcRenderer.invoke('git:commit-detail', { repoPath, commitHash }) as Promise<GitCommitSummary>,
    diff: (repoPath: string, target: GitDiffInput['target']) => ipcRenderer.invoke('git:diff', { repoPath, target }) as Promise<GitDiffResult>,
    stage: (repoPath: string, filePaths: string[]) => ipcRenderer.invoke('git:stage', { repoPath, filePaths }) as Promise<GitOperationResult>,
    unstage: (repoPath: string, filePaths: string[]) => ipcRenderer.invoke('git:unstage', { repoPath, filePaths }) as Promise<GitOperationResult>,
    commit: (repoPath: string, message: string, filePaths?: string[]) =>
      ipcRenderer.invoke('git:commit', { repoPath, message, filePaths }) as Promise<GitOperationResult>,
    createBranch: (repoPath: string, name: string, startPoint?: string) =>
      ipcRenderer.invoke('git:branch-create', { repoPath, name, startPoint }) as Promise<GitOperationResult>,
    switchBranch: (repoPath: string, name: string, remote = false) =>
      ipcRenderer.invoke('git:branch-switch', { repoPath, name, remote }) as Promise<GitOperationResult>,
    deleteBranch: (repoPath: string, name: string) => ipcRenderer.invoke('git:branch-delete', { repoPath, name }) as Promise<GitOperationResult>,
    fetch: (repoPath: string) => ipcRenderer.invoke('git:fetch', { repoPath }) as Promise<GitOperationResult>,
    pull: (repoPath: string) => ipcRenderer.invoke('git:pull', { repoPath }) as Promise<GitOperationResult>,
    push: (repoPath: string) => ipcRenderer.invoke('git:push', { repoPath }) as Promise<GitOperationResult>,
    stashes: (repoPath: string) => ipcRenderer.invoke('git:stash-list', { repoPath }) as Promise<GitStashEntry[]>,
    pushStash: (repoPath: string, message?: string) => ipcRenderer.invoke('git:stash-push', { repoPath, message }) as Promise<GitOperationResult>,
    applyStash: (repoPath: string, ref: string) => ipcRenderer.invoke('git:stash-apply', { repoPath, ref }) as Promise<GitOperationResult>,
    popStash: (repoPath: string, ref: string) => ipcRenderer.invoke('git:stash-pop', { repoPath, ref }) as Promise<GitOperationResult>,
    dropStash: (repoPath: string, ref: string) => ipcRenderer.invoke('git:stash-drop', { repoPath, ref }) as Promise<GitOperationResult>
  },
  pet: {
    getState: () => ipcRenderer.invoke('pet:get-state', {}) as Promise<PetRuntimeState>,
    updateSettings: (settings: PetSettings) => ipcRenderer.invoke('pet:update-settings', { settings }) as Promise<PetSettings>,
    ackAlert: (alertId: string) => ipcRenderer.invoke('pet:ack-alert', { alertId }) as Promise<{ ok: true }>,
    clearAlerts: (alertIds?: string[]) => ipcRenderer.invoke('pet:clear-alerts', alertIds ? { alertIds } : {}) as Promise<{ ok: true }>,
    snoozeAlert: (alertId: string, minutes: number) => ipcRenderer.invoke('pet:snooze-alert', { alertId, minutes }) as Promise<{ ok: true }>,
    setPosition: (position: { x: number; y: number }) => ipcRenderer.invoke('pet:set-position', position) as Promise<{ x: number; y: number }>,
    setInteractive: (interactive: boolean) => ipcRenderer.invoke('pet:set-interactive', { interactive }) as Promise<{ ok: true }>,
    openTarget: (target: PetAlertTarget) => ipcRenderer.invoke('pet:open-target', { target }) as Promise<{ ok: true }>,
    installClaudeHooks: () => ipcRenderer.invoke('pet:install-claude-hooks', {}) as Promise<PetRuntimeState['bridge']['claudeHook']>,
    installCodexHooks: () => ipcRenderer.invoke('pet:install-codex-hooks', {}) as Promise<PetRuntimeState['bridge']['codexHook']>,
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
    setZoom: (tabId: string, zoomFactor: number) => ipcRenderer.invoke('browser:set-zoom', { tabId, zoomFactor }),
    queryText: (tabId: string, selector: string) => ipcRenderer.invoke('browser:query-text', { tabId, selector }),
    click: (tabId: string, selector: string) => ipcRenderer.invoke('browser:click', { tabId, selector }),
    type: (tabId: string, selector: string, text: string) => ipcRenderer.invoke('browser:type', { tabId, selector, text }),
    closeTab: (tabId: string) => ipcRenderer.invoke('browser:close-tab', { tabId }),
    onTabUpdated: (listener: Listener<{ tabId: string; patch: Record<string, unknown> }>) => on('browser:tab-updated', listener),
    onOpenTabRequested: (listener: Listener<{ componentId: string; sourceTabId: string; url: string }>) =>
      on('browser:open-tab-requested', listener),
    onWebviewOpenTabRequested: (listener: Listener<{ sourceWebContentsId: number; url: string }>) =>
      on('browser:webview-open-tab-requested', listener),
    onWebviewZoomUpdated: (listener: Listener<{ sourceWebContentsId: number; zoomFactor: number }>) =>
      on('browser:webview-zoom-updated', listener)
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
