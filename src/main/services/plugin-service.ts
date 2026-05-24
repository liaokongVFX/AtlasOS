import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { app, dialog, protocol, utilityProcess, type UtilityProcess } from 'electron'
import { z } from 'zod'
import {
  pluginConfigInputSchema,
  pluginIdInputSchema,
  pluginInstallDirectoryInputSchema,
  pluginRootDirectoryInputSchema,
  pluginInvokeInputSchema
} from '@shared/ipc'
import {
  ATLAS_PLUGIN_MANIFEST_FILE,
  ATLAS_PLUGIN_RENDERER_PROTOCOL,
  atlasPluginManifestSchema,
  installedPluginsStateSchema,
  parsePluginRendererModuleUrl,
  pluginSettingsSchema,
  pluginRendererModuleUrl,
  type AtlasPluginManifest,
  type InstalledPluginRecord,
  type InstalledPluginsState,
  type PluginConfig,
  type PluginConfigField,
  type PluginConfigValue,
  type PluginDiagnosticEntry,
  type PluginInfo,
  type PluginSettings,
  type PluginStatus
} from '@shared/plugins'
import { translateShared } from '@shared/locale-text'
import { assertInsideRoot } from './path-safety'
import { handleValidated } from './ipc-helpers'

const PLUGIN_STATE_FILE = 'plugins.json'
const PLUGIN_SETTINGS_FILE = 'settings.json'
const PLUGIN_STATE_DIR = 'plugin-state'
const MAX_DIAGNOSTIC_ENTRIES = 80
const PLUGIN_INVOKE_TIMEOUT_MS = 30_000
const PLUGIN_RENDERER_ALLOWED_METHODS = 'GET, HEAD'

let activePluginProtocolService: PluginService | null = null

type PendingPluginInvoke = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type PluginRuntime = {
  process: UtilityProcess
  pendingInvokes: Map<string, PendingPluginInvoke>
}

function nowIso(): string {
  return new Date().toISOString()
}

function isoTimeMs(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmpPath, filePath)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function defaultConfigValue(field: PluginConfigField): PluginConfigValue {
  if (field.default !== undefined) return field.default
  if (field.type === 'boolean') return false
  if (field.type === 'number') return field.min ?? 0
  if (field.type === 'select') return field.options[0]?.value ?? ''
  return ''
}

function normalizePluginRootPath(rootPath: string): string {
  return assertInsideRoot(rootPath, rootPath)
}

function assertPluginChildPath(rootPath: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error('Plugin entrypoints must use relative paths')
  return assertInsideRoot(rootPath, resolve(rootPath, relativePath))
}

function pluginRendererMimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.wasm':
      return 'application/wasm'
    default:
      return 'application/octet-stream'
  }
}

function streamFileBody(path: string): BodyInit {
  return Readable.toWeb(createReadStream(path)) as unknown as BodyInit
}

function textResponse(message: string, status: number, headers: HeadersInit = {}): Response {
  return new Response(message, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      ...headers
    }
  })
}

function registerPluginRendererProtocol(service: PluginService): void {
  activePluginProtocolService = service
  if (protocol.isProtocolHandled(ATLAS_PLUGIN_RENDERER_PROTOCOL)) return

  protocol.handle(ATLAS_PLUGIN_RENDERER_PROTOCOL, (request) => {
    if (!activePluginProtocolService) return textResponse('Plugin service unavailable', 503)
    return activePluginProtocolService.createRendererModuleResponse(request)
  })
}

export class PluginService {
  private readonly userDataDir = app.getPath('userData')
  private readonly defaultPluginRoot = join(this.userDataDir, 'plugins')
  private readonly stateDir = join(this.userDataDir, PLUGIN_STATE_DIR)
  private readonly statePath = join(this.stateDir, PLUGIN_STATE_FILE)
  private readonly settingsPath = join(this.stateDir, PLUGIN_SETTINGS_FILE)
  private readonly legacyStatePath = join(this.defaultPluginRoot, PLUGIN_STATE_FILE)
  private readonly diagnostics = new Map<string, PluginDiagnosticEntry[]>()
  private readonly runtimes = new Map<string, PluginRuntime>()

  registerIpc(): void {
    registerPluginRendererProtocol(this)
    handleValidated('plugins:get-settings', z.object({}), () => this.getSettings())
    handleValidated('plugins:set-root-directory', pluginRootDirectoryInputSchema, (_, input) => this.setRootDirectory(input.rootPath))
    handleValidated('plugins:scan-root-directory', z.object({}), () => this.scanRootDirectory())
    handleValidated('plugins:list', z.object({}), () => this.listPlugins())
    handleValidated('plugins:install-directory', pluginInstallDirectoryInputSchema, (_, input) => this.installDirectory(input.sourcePath, input.dialogTitle))
    handleValidated('plugins:enable', pluginIdInputSchema, (_, input) => this.enablePlugin(input.pluginId))
    handleValidated('plugins:disable', pluginIdInputSchema, (_, input) => this.disablePlugin(input.pluginId))
    handleValidated('plugins:uninstall', pluginIdInputSchema, (_, input) => this.uninstallPlugin(input.pluginId))
    handleValidated('plugins:reload', pluginIdInputSchema, (_, input) => this.reloadPlugin(input.pluginId))
    handleValidated('plugins:update-config', pluginConfigInputSchema, (_, input) => this.updatePluginConfig(input.pluginId, input.config))
    handleValidated('plugins:diagnostics', pluginIdInputSchema, (_, input) => this.getDiagnostics(input.pluginId))
    handleValidated('plugins:invoke', pluginInvokeInputSchema, (_, input) => this.invoke(input.pluginId, input.command, input.input))
  }

  dispose(): void {
    if (activePluginProtocolService === this) activePluginProtocolService = null

    for (const pluginId of [...this.runtimes.keys()]) {
      this.stopRuntime(pluginId)
    }
  }

  async getSettings(): Promise<PluginSettings> {
    await mkdir(this.stateDir, { recursive: true })
    await mkdir(this.defaultPluginRoot, { recursive: true })

    try {
      const raw = await readFile(this.settingsPath, 'utf8')
      const settings = pluginSettingsSchema.parse(JSON.parse(raw))
      const rootPath = normalizePluginRootPath(settings.rootPath)
      await mkdir(rootPath, { recursive: true })
      return { rootPath }
    } catch {
      const settings = { rootPath: this.defaultPluginRoot }
      await this.writeSettings(settings)
      return settings
    }
  }

  async setRootDirectory(rootPathInput: string): Promise<PluginSettings> {
    const rootPath = normalizePluginRootPath(rootPathInput)
    const settings = { rootPath }
    await mkdir(rootPath, { recursive: true })
    await this.writeSettings(settings)
    await this.scanRootDirectory()
    return settings
  }

  async listPlugins(): Promise<PluginInfo[]> {
    await this.discoverPluginsFromRoot()
    const state = await this.readRefreshedState()
    return Promise.all(state.plugins.map((record) => this.infoFor(record)))
  }

  async scanRootDirectory(): Promise<PluginInfo[]> {
    await this.discoverPluginsFromRoot()
    const state = await this.readRefreshedState()
    return Promise.all(state.plugins.map((record) => this.infoFor(record)))
  }

  async installDirectory(sourcePathInput?: string, dialogTitle?: string): Promise<PluginInfo | null> {
    const sourcePath = sourcePathInput ?? (await this.choosePluginDirectory(dialogTitle))
    if (!sourcePath) return null

    const manifest = await this.readManifest(sourcePath)
    const state = await this.readState()
    const timestamp = nowIso()
    const existing = state.plugins.find((plugin) => plugin.id === manifest.id)

    if (existing) {
      existing.sourcePath = sourcePath
      existing.updatedAt = timestamp
      await this.writeState(state)
      this.addDiagnostic(manifest.id, 'info', `Updated plugin source: ${sourcePath}`)
      return this.infoFor(existing)
    }

    const record: InstalledPluginRecord = {
      id: manifest.id,
      sourcePath,
      enabled: false,
      config: {},
      installedAt: timestamp,
      updatedAt: timestamp
    }
    state.plugins.push(record)
    await this.writeState(state)
    this.addDiagnostic(manifest.id, 'info', `Installed plugin from ${sourcePath}`)
    return this.infoFor(record)
  }

  async enablePlugin(pluginId: string): Promise<PluginInfo> {
    const state = await this.readState()
    const record = this.requireRecord(state, pluginId)
    record.enabled = true
    record.updatedAt = nowIso()
    await this.writeState(state)
    await this.startNativeRuntime(record)
    return this.infoFor(record)
  }

  async disablePlugin(pluginId: string): Promise<PluginInfo> {
    const state = await this.readState()
    const record = this.requireRecord(state, pluginId)
    this.stopRuntime(pluginId)
    record.enabled = false
    record.updatedAt = nowIso()
    await this.writeState(state)
    this.addDiagnostic(pluginId, 'info', 'Disabled plugin')
    return this.infoFor(record)
  }

  async uninstallPlugin(pluginId: string): Promise<{ ok: true }> {
    const state = await this.readState()
    this.requireRecord(state, pluginId)
    this.stopRuntime(pluginId)
    state.plugins = state.plugins.filter((plugin) => plugin.id !== pluginId)
    await this.writeState(state)
    this.addDiagnostic(pluginId, 'info', 'Uninstalled plugin reference')
    return { ok: true }
  }

  async reloadPlugin(pluginId: string): Promise<PluginInfo> {
    const state = await this.readState()
    const record = this.requireRecord(state, pluginId)
    this.stopRuntime(pluginId)
    await this.readManifest(record.sourcePath)
    record.updatedAt = nowIso()
    await this.writeState(state)
    if (record.enabled) await this.startNativeRuntime(record)
    this.addDiagnostic(pluginId, 'info', 'Reloaded plugin')
    return this.infoFor(record)
  }

  async updatePluginConfig(pluginId: string, config: PluginConfig): Promise<PluginInfo> {
    const state = await this.readState()
    const record = this.requireRecord(state, pluginId)
    const manifest = await this.readManifest(record.sourcePath)
    record.config = this.normalizeConfig(manifest, config)
    record.updatedAt = nowIso()
    await this.writeState(state)

    if (record.enabled) {
      this.stopRuntime(pluginId)
      await this.startNativeRuntime(record)
    }

    this.addDiagnostic(pluginId, 'info', 'Updated plugin configuration')
    return this.infoFor(record)
  }

  async getDiagnostics(pluginId: string): Promise<PluginDiagnosticEntry[]> {
    const state = await this.readState()
    this.requireRecord(state, pluginId)
    return this.diagnosticsFor(pluginId)
  }

  async invoke(pluginId: string, command: string, input: unknown): Promise<unknown> {
    const state = await this.readState()
    const record = this.requireRecord(state, pluginId)
    if (!record.enabled) throw new Error('Plugin is disabled')

    await this.startNativeRuntime(record)
    const runtime = this.runtimes.get(pluginId)
    if (!runtime) throw new Error('Plugin does not expose a native runtime')

    const requestId = randomUUID()
    return new Promise((resolveInvoke, rejectInvoke) => {
      const timeout = setTimeout(() => {
        runtime.pendingInvokes.delete(requestId)
        rejectInvoke(new Error(`Plugin command timed out: ${command}`))
      }, PLUGIN_INVOKE_TIMEOUT_MS)

      runtime.pendingInvokes.set(requestId, {
        resolve: resolveInvoke,
        reject: rejectInvoke,
        timeout
      })

      runtime.process.postMessage({
        type: 'atlas:invoke',
        requestId,
        command,
        input
      })
    })
  }

  async createRendererModuleResponse(request: Request): Promise<Response> {
    const method = request.method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
      return textResponse('Method not allowed', 405, { Allow: PLUGIN_RENDERER_ALLOWED_METHODS })
    }

    try {
      const { pluginId, relativePath } = parsePluginRendererModuleUrl(request.url)
      const state = await this.readState()
      const record = this.requireRecord(state, pluginId)
      if (!record.enabled) return textResponse('Plugin is disabled', 403)

      await this.readManifest(record.sourcePath)
      const targetPath = assertPluginChildPath(record.sourcePath, relativePath)
      const info = await stat(targetPath)
      if (!info.isFile()) return textResponse('Plugin renderer asset is not a file', 404)

      return new Response(method === 'HEAD' ? null : streamFileBody(targetPath), {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'Content-Length': String(info.size),
          'Content-Type': pluginRendererMimeType(targetPath),
          'X-Content-Type-Options': 'nosniff'
        }
      })
    } catch (error) {
      return textResponse(error instanceof Error ? error.message : 'Failed to load plugin renderer asset', 404)
    }
  }

  private async choosePluginDirectory(title = translateShared(undefined, 'plugin.installTitle')): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title,
      properties: ['openDirectory']
    })

    return result.canceled ? null : result.filePaths[0]
  }

  private async readState(): Promise<InstalledPluginsState> {
    await mkdir(this.stateDir, { recursive: true })

    try {
      const raw = await readFile(this.statePath, 'utf8')
      return installedPluginsStateSchema.parse(JSON.parse(raw))
    } catch {
      try {
        const legacyRaw = await readFile(this.legacyStatePath, 'utf8')
        const legacyState = installedPluginsStateSchema.parse(JSON.parse(legacyRaw))
        await this.writeState(legacyState)
        return legacyState
      } catch {
        return { plugins: [] }
      }
    }
  }

  private async readRefreshedState(): Promise<InstalledPluginsState> {
    const state = await this.readState()
    if (await this.refreshInstalledPluginSources(state)) {
      await this.writeState(state)
    }
    return state
  }

  private async writeSettings(settings: PluginSettings): Promise<void> {
    await mkdir(this.stateDir, { recursive: true })
    await writeJsonAtomic(this.settingsPath, pluginSettingsSchema.parse(settings))
  }

  private async writeState(state: InstalledPluginsState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true })
    await writeJsonAtomic(this.statePath, installedPluginsStateSchema.parse(state))
  }

  private async discoverPluginsFromRoot(): Promise<void> {
    const settings = await this.getSettings()
    const pluginDirectories = await this.pluginDirectoriesInRoot(settings.rootPath)
    if (pluginDirectories.length === 0) return

    const state = await this.readState()
    const timestamp = nowIso()
    let changed = false

    for (const sourcePath of pluginDirectories) {
      try {
        const manifest = await this.readManifest(sourcePath)
        const existing = state.plugins.find((plugin) => plugin.id === manifest.id)

        if (existing) {
          if (existing.sourcePath !== sourcePath) {
            existing.sourcePath = sourcePath
            existing.updatedAt = timestamp
            changed = true
            this.addDiagnostic(manifest.id, 'info', `Discovered plugin source: ${sourcePath}`)
          } else {
            const sourceUpdatedAtMs = await this.pluginSourceUpdatedAtMs(sourcePath, manifest)
            if (sourceUpdatedAtMs <= isoTimeMs(existing.updatedAt)) continue

            existing.updatedAt = new Date(Math.max(Date.now(), sourceUpdatedAtMs)).toISOString()
            changed = true
            this.addDiagnostic(manifest.id, 'info', 'Detected plugin source changes')
          }
          continue
        }

        state.plugins.push({
          id: manifest.id,
          sourcePath,
          enabled: false,
          config: {},
          installedAt: timestamp,
          updatedAt: timestamp
        })
        changed = true
        this.addDiagnostic(manifest.id, 'info', `Discovered plugin in root directory: ${sourcePath}`)
      } catch {
        // Ignore folders that are not valid plugin roots. Invalid installed records still surface through infoFor.
      }
    }

    if (changed) await this.writeState(state)
  }

  private async refreshInstalledPluginSources(state: InstalledPluginsState): Promise<boolean> {
    let changed = false

    for (const record of state.plugins) {
      try {
        const manifest = await this.readManifest(record.sourcePath)
        const sourceUpdatedAtMs = await this.pluginSourceUpdatedAtMs(record.sourcePath, manifest)
        if (sourceUpdatedAtMs <= isoTimeMs(record.updatedAt)) continue

        record.updatedAt = new Date(Math.max(Date.now(), sourceUpdatedAtMs)).toISOString()
        changed = true
        this.addDiagnostic(record.id, 'info', 'Detected plugin source changes')
      } catch {
        // Missing or invalid plugin sources are reported by infoFor; timestamp refresh should not hide them.
      }
    }

    return changed
  }

  private async pluginDirectoriesInRoot(rootPath: string): Promise<string[]> {
    const root = normalizePluginRootPath(rootPath)
    await mkdir(root, { recursive: true })

    try {
      const rootManifest = await stat(join(root, ATLAS_PLUGIN_MANIFEST_FILE))
      if (rootManifest.isFile()) return [root]
    } catch {
      // The configured root is normally a container for plugin folders.
    }

    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))
  }

  private async pluginSourceUpdatedAtMs(sourcePath: string, manifest: AtlasPluginManifest): Promise<number> {
    const directory = assertInsideRoot(sourcePath, sourcePath)
    const paths = [join(directory, ATLAS_PLUGIN_MANIFEST_FILE)]

    if (manifest.renderer) paths.push(assertPluginChildPath(directory, manifest.renderer.entry))
    if (manifest.native) paths.push(assertPluginChildPath(directory, manifest.native.entry))

    const stats = await Promise.all(paths.map((path) => stat(path)))
    return Math.max(...stats.map((entry) => entry.mtimeMs))
  }

  private requireRecord(state: InstalledPluginsState, pluginId: string): InstalledPluginRecord {
    const record = state.plugins.find((plugin) => plugin.id === pluginId)
    if (!record) throw new Error('Plugin is not installed')
    return record
  }

  private async readManifest(sourcePath: string): Promise<AtlasPluginManifest> {
    const directory = assertInsideRoot(sourcePath, sourcePath)
    const stats = await stat(directory)
    if (!stats.isDirectory()) throw new Error('Plugin source must be a directory')

    const raw = await readFile(join(directory, ATLAS_PLUGIN_MANIFEST_FILE), 'utf8')
    const manifest = atlasPluginManifestSchema.parse(JSON.parse(raw))

    if (manifest.renderer) await stat(assertPluginChildPath(directory, manifest.renderer.entry))
    if (manifest.native) await stat(assertPluginChildPath(directory, manifest.native.entry))

    return manifest
  }

  private normalizeConfig(manifest: AtlasPluginManifest, input: PluginConfig = {}): PluginConfig {
    const inputRecord = input as Record<string, unknown>
    const nextConfig: PluginConfig = {}

    for (const field of manifest.configuration) {
      const rawValue = hasOwn(inputRecord, field.id) ? inputRecord[field.id] : defaultConfigValue(field)
      nextConfig[field.id] = this.normalizeConfigField(field, rawValue)
    }

    return nextConfig
  }

  private normalizeConfigField(field: PluginConfigField, value: unknown): PluginConfigValue {
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Plugin config ${field.id} must be boolean`)
      return value
    }

    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Plugin config ${field.id} must be a finite number`)
      if (field.min !== undefined && value < field.min) throw new Error(`Plugin config ${field.id} must be at least ${field.min}`)
      if (field.max !== undefined && value > field.max) throw new Error(`Plugin config ${field.id} must be at most ${field.max}`)
      return value
    }

    if (field.type === 'select') {
      if (typeof value !== 'string') throw new Error(`Plugin config ${field.id} must be a string`)
      if (!field.options.some((option) => option.value === value)) throw new Error(`Plugin config ${field.id} must match a declared option`)
      return value
    }

    if (typeof value !== 'string') throw new Error(`Plugin config ${field.id} must be a string`)
    if (value.length > 2000) throw new Error(`Plugin config ${field.id} is too long`)
    return value
  }

  private async infoFor(record: InstalledPluginRecord): Promise<PluginInfo> {
    let manifest: AtlasPluginManifest | null = null
    let status: PluginStatus = record.enabled ? 'enabled' : 'disabled'
    let rendererEntryUrl: string | null = null
    let config: PluginConfig = record.config

    try {
      manifest = await this.readManifest(record.sourcePath)
      rendererEntryUrl = manifest.renderer ? pluginRendererModuleUrl(record.id, manifest.renderer.entry) : null
      try {
        config = this.normalizeConfig(manifest, record.config)
      } catch (error) {
        config = this.normalizeConfig(manifest, {})
        this.addDiagnostic(record.id, 'warn', error instanceof Error ? error.message : String(error))
      }
    } catch (error) {
      status = 'missing'
      this.addDiagnostic(record.id, 'error', error instanceof Error ? error.message : String(error))
    }

    if (this.runtimes.has(record.id)) status = 'running'
    else if (status !== 'missing' && this.diagnosticsFor(record.id).some((entry) => entry.level === 'error') && record.enabled) status = 'error'

    return {
      ...record,
      config,
      manifest,
      status,
      rendererEntryUrl,
      diagnostics: this.diagnosticsFor(record.id)
    }
  }

  private async startNativeRuntime(record: InstalledPluginRecord): Promise<void> {
    if (this.runtimes.has(record.id)) return

    let manifest: AtlasPluginManifest
    try {
      manifest = await this.readManifest(record.sourcePath)
    } catch (error) {
      this.addDiagnostic(record.id, 'error', error instanceof Error ? error.message : String(error))
      return
    }

    if (!manifest.native) return

    const config = this.normalizeConfig(manifest, record.config)
    const entryPath = assertPluginChildPath(record.sourcePath, manifest.native.entry)
    const child = utilityProcess.fork(entryPath, [], {
      cwd: record.sourcePath,
      serviceName: `AtlasOS Plugin ${manifest.name}`,
      stdio: 'pipe'
    })
    const runtime: PluginRuntime = {
      process: child,
      pendingInvokes: new Map()
    }
    this.runtimes.set(record.id, runtime)

    child.on('spawn', () => {
      this.addDiagnostic(record.id, 'info', 'Native runtime started')
      child.postMessage({
        type: 'atlas:init',
        pluginId: record.id,
        manifest,
        config,
        sourcePath: record.sourcePath
      })
    })
    child.on('message', (message) => this.handleNativeMessage(record.id, message))
    child.on('error', (_type, location) => {
      this.addDiagnostic(record.id, 'error', `Native runtime failed: ${location}`)
    })
    child.on('exit', (code) => {
      this.runtimes.delete(record.id)
      for (const pending of runtime.pendingInvokes.values()) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('Plugin runtime exited before replying'))
      }
      runtime.pendingInvokes.clear()
      this.addDiagnostic(record.id, code === 0 ? 'info' : 'error', `Native runtime exited with code ${code}`)
    })
    child.stdout?.on('data', (chunk) => this.addDiagnostic(record.id, 'info', String(chunk).trim()))
    child.stderr?.on('data', (chunk) => this.addDiagnostic(record.id, 'error', String(chunk).trim()))
  }

  private stopRuntime(pluginId: string): void {
    const runtime = this.runtimes.get(pluginId)
    if (!runtime) return

    for (const pending of runtime.pendingInvokes.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Plugin runtime stopped'))
    }
    runtime.pendingInvokes.clear()
    runtime.process.kill()
    this.runtimes.delete(pluginId)
  }

  private handleNativeMessage(pluginId: string, message: unknown): void {
    if (!isRecord(message)) return

    if (message.type === 'atlas:log') {
      const level = message.level === 'warn' || message.level === 'error' ? message.level : 'info'
      this.addDiagnostic(pluginId, level, asString(message.message) ?? '')
      return
    }

    if (message.type !== 'atlas:invoke-result') return

    const requestId = asString(message.requestId)
    if (!requestId) return

    const runtime = this.runtimes.get(pluginId)
    if (!runtime) return

    const pending = runtime.pendingInvokes.get(requestId)
    if (!pending) return

    runtime.pendingInvokes.delete(requestId)
    clearTimeout(pending.timeout)

    if (message.ok === true) {
      pending.resolve(message.result)
    } else {
      pending.reject(new Error(asString(message.error) ?? 'Plugin command failed'))
    }
  }

  private addDiagnostic(pluginId: string, level: PluginDiagnosticEntry['level'], message: string): void {
    if (!message) return

    const entries = this.diagnosticsFor(pluginId)
    entries.push({
      timestamp: nowIso(),
      level,
      message
    })

    if (entries.length > MAX_DIAGNOSTIC_ENTRIES) {
      entries.splice(0, entries.length - MAX_DIAGNOSTIC_ENTRIES)
    }

    this.diagnostics.set(pluginId, entries)
  }

  private diagnosticsFor(pluginId: string): PluginDiagnosticEntry[] {
    return this.diagnostics.get(pluginId) ?? []
  }
}
