import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import path from 'node:path'
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { ipcMain, webContents, type WebContents } from 'electron'
import type { FileEntry } from '@shared/schema'
import type {
  RemoteServerConnectResult,
  RemoteServerProfile,
  RemoteServerProfileDraft,
  RemoteServerStatusSnapshot
} from '@shared/remote-servers'
import {
  remoteServersCloseComponentInputSchema,
  remoteServersCloseSessionInputSchema,
  remoteServersConnectInputSchema,
  remoteServersCreateFileInputSchema,
  remoteServersCreateFolderInputSchema,
  remoteServersDeleteInputSchema,
  remoteServersDeleteProfileInputSchema,
  remoteServersDownloadInputSchema,
  remoteServersListProfilesInputSchema,
  remoteServersListTreeInputSchema,
  remoteServersReadFileInputSchema,
  remoteServersRenameInputSchema,
  remoteServersSaveProfileInputSchema,
  remoteServersShellResizeInputSchema,
  remoteServersShellWriteInputSchema,
  remoteServersStatusInputSchema,
  remoteServersTestConnectionInputSchema,
  remoteServersUploadInputSchema,
  remoteServersWriteFileInputSchema
} from '@shared/ipc'
import { remoteServerSettingsSchema, type RemoteServerSettings } from '@shared/remote-servers'
import { handleValidated } from './ipc-helpers'
import { AppSettingsService } from './app-settings-service'
import { RemoteServerCredentialStore, type RemoteServerCredentials } from './remote-server-credential-store'

type RemoteSession = {
  id: string
  ownerId: number
  componentId: string
  canvasId?: string
  profileId: string
  client: Client
  shell: ClientChannel
  sftp: SFTPWrapper
  homePath: string
  hostKeyFingerprint: string
}

type OwnerCleanup = {
  sessionIds: Set<string>
  onDestroyed: () => void
}

type HostKeyVerificationResult =
  | { ok: true; fingerprint: string; shouldSave: boolean }
  | { ok: false; reason: 'untrusted'; fingerprint: string }
  | { ok: false; reason: 'mismatch'; expected: string; actual: string }

class HostKeyRejectedError extends Error {
  constructor(readonly result: Exclude<HostKeyVerificationResult, { ok: true }>) {
    super(result.reason === 'untrusted' ? 'Remote host key is not trusted' : 'Remote host key changed')
  }
}

const STATUS_COMMAND = `
printf 'hostname=%s\\n' "$(hostname 2>/dev/null)"
printf 'username=%s\\n' "$(whoami 2>/dev/null)"
printf 'kernel=%s\\n' "$(uname -srmo 2>/dev/null)"
if [ -r /etc/os-release ]; then
  os=$(awk -F= '/^PRETTY_NAME=/ { gsub(/"/, "", $2); print $2; exit }' /etc/os-release)
  printf 'os=%s\\n' "$os"
fi
printf 'uptime=%s\\n' "$(uptime -p 2>/dev/null)"
if [ -r /proc/loadavg ]; then
  printf 'load=%s\\n' "$(awk '{print $1" "$2" "$3}' /proc/loadavg)"
fi
if [ -r /proc/stat ]; then
  awk '/^cpu / {
    idle=$5
    total=0
    for (i=2; i<=NF; i++) total += $i
    if (total > 0) printf "cpu=%d\\n", ((total - idle) * 100 / total)
    exit
  }' /proc/stat
fi
if [ -r /proc/meminfo ]; then
  awk '
    /^MemTotal:/ { total=$2 * 1024 }
    /^MemAvailable:/ { available=$2 * 1024 }
    END {
      if (total > 0) printf "memory=%d %d %d\\n", total, total - available, available
    }
  ' /proc/meminfo
fi
df -PB1 "$HOME" 2>/dev/null | awk 'NR==2 { printf "disk=%s %s %s %s\\n", $6, $2, $3, $4 }'
`

function quotePosixShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function nowIso(): string {
  return new Date().toISOString()
}

function sanitizeRemoteName(name: string): string {
  return name.replace(/[\\/]/g, '').trim()
}

function normalizeRemotePath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'))
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function remoteParentPath(value: string): string {
  const normalized = normalizeRemotePath(value)
  const parent = path.posix.dirname(normalized)
  return parent === '.' ? '/' : parent
}

function remoteChildPath(parent: string, name: string): string {
  const safeName = sanitizeRemoteName(name)
  if (!safeName) throw new Error('Remote file name is required')
  return path.posix.join(normalizeRemotePath(parent), safeName)
}

function assertInsideRemoteRoot(rootPath: string, targetPath: string): string {
  const root = normalizeRemotePath(rootPath)
  const target = normalizeRemotePath(targetPath)
  if (root === '/') return target
  if (target !== root && !target.startsWith(`${root}/`)) {
    throw new Error('Remote path is outside the selected root')
  }
  return target
}

function fileNameFromRemotePath(value: string): string {
  const normalized = normalizeRemotePath(value)
  return basename(normalized) || normalized
}

function uniqueProfiles(profiles: RemoteServerProfile[]): RemoteServerProfile[] {
  const seen = new Set<string>()
  return profiles.filter((profile) => {
    if (seen.has(profile.id)) return false
    seen.add(profile.id)
    return true
  })
}

function parseKeyValueOutput(output: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    values[line.slice(0, index)] = line.slice(index + 1).trim()
  }
  return values
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseMetricTriple(value: string | undefined): { total: number; used: number; available: number } | undefined {
  if (!value) return undefined
  const [total, used, available] = value.split(/\s+/).map((part) => Number(part))
  if (![total, used, available].every(Number.isFinite)) return undefined
  return { total, used, available }
}

function profileFromDraft(
  draft: RemoteServerProfileDraft,
  existing: RemoteServerProfile | undefined,
  credentialState: { passwordConfigured: boolean; passphraseConfigured: boolean },
  timestamp: string
): RemoteServerProfile {
  return {
    id: existing?.id ?? draft.id ?? randomUUID(),
    name: draft.name,
    host: draft.host,
    port: draft.port,
    username: draft.username,
    authType: draft.authType,
    privateKeyPath: draft.authType === 'private-key' ? optionalString(draft.privateKeyPath) : undefined,
    passwordConfigured: credentialState.passwordConfigured,
    passphraseConfigured: credentialState.passphraseConfigured,
    hostKeyFingerprint: existing?.hostKeyFingerprint,
    updatedAt: timestamp
  }
}

export class RemoteServerService {
  private readonly sessionsById = new Map<string, RemoteSession>()
  private readonly sessionsByKey = new Map<string, RemoteSession>()
  private readonly ownerCleanupById = new Map<number, OwnerCleanup>()

  constructor(
    private readonly options: {
      appSettingsService: AppSettingsService
      credentialStore?: RemoteServerCredentialStore
    }
  ) {}

  registerIpc(): void {
    handleValidated('remote-servers:list-profiles', remoteServersListProfilesInputSchema, () => this.listProfiles())
    handleValidated('remote-servers:save-profile', remoteServersSaveProfileInputSchema, async (_, input) => this.saveProfile(input.profile))
    handleValidated('remote-servers:delete-profile', remoteServersDeleteProfileInputSchema, async (_, input) => {
      await this.deleteProfile(input.profileId)
      return { ok: true }
    })
    handleValidated('remote-servers:test-connection', remoteServersTestConnectionInputSchema, async (_, input) => this.testConnection(input.profile))
    handleValidated('remote-servers:connect', remoteServersConnectInputSchema, async (event, input) =>
      this.connect(event.sender, input.componentId, input.profileId, {
        canvasId: input.canvasId,
        cols: input.cols,
        rows: input.rows,
        acceptHostKey: input.acceptHostKey,
        expectedHostKeyFingerprint: input.expectedHostKeyFingerprint
      })
    )
    handleValidated('remote-servers:close-session', remoteServersCloseSessionInputSchema, (event, input) => {
      const session = this.requireOwnedSession(input.sessionId, event.sender.id)
      this.closeBySessionId(session.id)
      return { ok: true }
    })
    handleValidated('remote-servers:close-component', remoteServersCloseComponentInputSchema, (event, input) => {
      this.closeByComponentId(event.sender.id, input.componentId)
      return { ok: true }
    })
    handleValidated('remote-servers:shell-write', remoteServersShellWriteInputSchema, (event, input) => {
      return { ok: this.write(event.sender.id, input.sessionId, input.data) }
    })
    handleValidated('remote-servers:shell-resize', remoteServersShellResizeInputSchema, (event, input) => {
      return { ok: this.resize(event.sender.id, input.sessionId, input.cols, input.rows) }
    })
    handleValidated('remote-servers:status', remoteServersStatusInputSchema, (event, input) => this.status(event.sender.id, input.sessionId))
    handleValidated('remote-servers:list-tree', remoteServersListTreeInputSchema, (event, input) =>
      this.listTree(event.sender.id, input.sessionId, input.rootPath, input.targetPath ?? input.rootPath, input.maxDepth)
    )
    handleValidated('remote-servers:read-file', remoteServersReadFileInputSchema, (event, input) =>
      this.readFile(event.sender.id, input.sessionId, input.rootPath, input.targetPath)
    )
    handleValidated('remote-servers:write-file', remoteServersWriteFileInputSchema, async (event, input) => {
      await this.writeFile(event.sender.id, input.sessionId, input.rootPath, input.targetPath, input.contents ?? '')
      return { ok: true }
    })
    handleValidated('remote-servers:create-file', remoteServersCreateFileInputSchema, (event, input) =>
      this.createFile(event.sender.id, input.sessionId, input.rootPath, input.targetPath, input.name, input.contents ?? '')
    )
    handleValidated('remote-servers:create-folder', remoteServersCreateFolderInputSchema, (event, input) =>
      this.createFolder(event.sender.id, input.sessionId, input.rootPath, input.targetPath, input.name)
    )
    handleValidated('remote-servers:rename', remoteServersRenameInputSchema, (event, input) =>
      this.rename(event.sender.id, input.sessionId, input.rootPath, input.targetPath, input.name)
    )
    handleValidated('remote-servers:delete', remoteServersDeleteInputSchema, async (event, input) => {
      await this.deletePath(event.sender.id, input.sessionId, input.rootPath, input.targetPath, input.recursive)
      return { ok: true }
    })
    handleValidated('remote-servers:upload', remoteServersUploadInputSchema, (event, input) =>
      this.upload(event.sender.id, input.sessionId, input.rootPath, input.targetPath, input.localPath, input.name)
    )
    handleValidated('remote-servers:download', remoteServersDownloadInputSchema, (event, input) =>
      this.download(event.sender.id, input.sessionId, input.rootPath, input.targetPath, input.localDirectory)
    )
    ipcMain.on('remote-servers:dispose-owner', (event) => this.closeByOwner(event.sender.id))
  }

  dispose(): void {
    for (const sessionId of [...this.sessionsById.keys()]) {
      this.closeBySessionId(sessionId)
    }
  }

  async listProfiles(): Promise<RemoteServerSettings> {
    const settings = await this.options.appSettingsService.getSettings()
    return remoteServerSettingsSchema.parse(settings.remoteServers)
  }

  async saveProfile(draft: RemoteServerProfileDraft): Promise<RemoteServerSettings> {
    const timestamp = nowIso()
    let savedSettings: RemoteServerSettings | null = null
    const credentialStore = this.credentialStore()
    const profileId = draft.id ?? randomUUID()
    const credentialState = await credentialStore.updateCredentials(profileId, {
      password: draft.password,
      passphrase: draft.passphrase,
      clearPassword: draft.clearPassword,
      clearPassphrase: draft.clearPassphrase
    })

    await this.options.appSettingsService.updateSettingsWith((settings) => {
      const current = remoteServerSettingsSchema.parse(settings.remoteServers)
      const existing = current.profiles.find((profile) => profile.id === profileId)
      const profile = profileFromDraft({ ...draft, id: profileId }, existing, credentialState, timestamp)
      const profiles = existing
        ? current.profiles.map((candidate) => (candidate.id === profileId ? profile : candidate))
        : [...current.profiles, profile]
      savedSettings = remoteServerSettingsSchema.parse({ profiles: uniqueProfiles(profiles) })

      return {
        ...settings,
        remoteServers: savedSettings
      }
    })

    return savedSettings ?? this.listProfiles()
  }

  async deleteProfile(profileId: string): Promise<void> {
    this.closeByProfileId(profileId)
    await this.credentialStore().clearCredentials(profileId)
    await this.options.appSettingsService.updateSettingsWith((settings) => ({
      ...settings,
      remoteServers: remoteServerSettingsSchema.parse({
        profiles: settings.remoteServers.profiles.filter((profile) => profile.id !== profileId)
      })
    }))
  }

  async testConnection(draft: RemoteServerProfileDraft): Promise<RemoteServerConnectResult | { status: 'ok'; homePath: string; hostKeyFingerprint: string }> {
    const existing = draft.id ? (await this.listProfiles()).profiles.find((profile) => profile.id === draft.id) : undefined
    const savedCredentials = draft.id ? await this.credentialStore().readCredentials(draft.id) : {}
    let client: Client | null = null
    const temporaryProfile: RemoteServerProfile = {
      id: draft.id ?? 'test-profile',
      name: draft.name,
      host: draft.host,
      port: draft.port,
      username: draft.username,
      authType: draft.authType,
      privateKeyPath: draft.authType === 'private-key' ? draft.privateKeyPath : undefined,
      passwordConfigured: Boolean(draft.password || savedCredentials.password),
      passphraseConfigured: Boolean(draft.passphrase || savedCredentials.passphrase),
      hostKeyFingerprint: existing?.hostKeyFingerprint,
      updatedAt: nowIso()
    }
    const credentials = {
      password: draft.password || savedCredentials.password,
      passphrase: draft.passphrase || savedCredentials.passphrase
    }

    try {
      const connection = await this.createConnection(temporaryProfile, credentials, {
        acceptHostKey: false
      })
      client = connection.client
      const sftp = await this.openSftp(client)
      const homePath = await this.realpath(sftp, '.').catch(() => '/')
      return { status: 'ok', homePath, hostKeyFingerprint: connection.hostKeyFingerprint }
    } catch (error) {
      if (error instanceof HostKeyRejectedError) return this.hostKeyResult(temporaryProfile.id, error.result)
      throw error
    } finally {
      if (client) this.closeClient(client)
    }
  }

  private async connect(
    owner: WebContents,
    componentId: string,
    profileId: string,
    input: {
      canvasId?: string
      cols: number
      rows: number
      acceptHostKey: boolean
      expectedHostKeyFingerprint?: string
    }
  ): Promise<RemoteServerConnectResult> {
    const existing = this.sessionsByKey.get(this.sessionKey(owner.id, componentId, profileId))
    if (existing) {
      this.resize(owner.id, existing.id, input.cols, input.rows)
      return {
        status: 'connected',
        sessionId: existing.id,
        profileId,
        homePath: existing.homePath,
        hostKeyFingerprint: existing.hostKeyFingerprint
      }
    }

    const profile = await this.requireProfile(profileId)
    const credentials = await this.credentialStore().readCredentials(profileId)
    let client: Client | null = null
    let shell: ClientChannel | null = null
    let sessionId: string | null = null

    try {
      const connection = await this.createConnection(profile, credentials, input)
      client = connection.client

      if (connection.shouldSaveHostKey) {
        await this.updateHostKeyFingerprint(profileId, connection.hostKeyFingerprint)
      }

      const sftp = await this.openSftp(client)
      const homePath = await this.realpath(sftp, '.').catch(() => '/')
      shell = await this.openShell(client, input.cols, input.rows)
      sessionId = randomUUID()
      const createdSessionId = sessionId
      const session: RemoteSession = {
        id: createdSessionId,
        ownerId: owner.id,
        componentId,
        canvasId: input.canvasId,
        profileId,
        client,
        shell,
        sftp,
        homePath: normalizeRemotePath(homePath),
        hostKeyFingerprint: connection.hostKeyFingerprint
      }

      this.sessionsById.set(createdSessionId, session)
      this.sessionsByKey.set(this.sessionKey(owner.id, componentId, profileId), session)
      this.trackOwnerSession(owner, createdSessionId)

      shell.on('data', (data: Buffer | string) => {
        this.sendToOwner(session.ownerId, 'remote-servers:shell-data', {
          sessionId: createdSessionId,
          componentId,
          profileId,
          data: data.toString()
        })
      })
      shell.stderr.on('data', (data: Buffer | string) => {
        this.sendToOwner(session.ownerId, 'remote-servers:shell-data', {
          sessionId: createdSessionId,
          componentId,
          profileId,
          data: data.toString()
        })
      })
      shell.on('close', () => {
        this.handleRemoteSessionClosed(createdSessionId)
      })
      connection.client.on('close', () => {
        this.handleRemoteSessionClosed(createdSessionId)
      })

      return {
        status: 'connected',
        sessionId: createdSessionId,
        profileId,
        homePath: session.homePath,
        hostKeyFingerprint: connection.hostKeyFingerprint
      }
    } catch (error) {
      if (sessionId && this.sessionsById.has(sessionId)) {
        this.closeBySessionId(sessionId)
      } else {
        this.closeShell(shell)
        this.closeClient(client)
      }
      if (error instanceof HostKeyRejectedError) return this.hostKeyResult(profileId, error.result)
      throw error
    }
  }

  private async createConnection(
    profile: RemoteServerProfile,
    credentials: RemoteServerCredentials,
    input: { acceptHostKey: boolean; expectedHostKeyFingerprint?: string }
  ): Promise<{ client: Client; hostKeyFingerprint: string; shouldSaveHostKey: boolean }> {
    const client = new Client()
    let verification: HostKeyVerificationResult | null = null
    const config: ConnectConfig = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      hostHash: 'sha256',
      hostVerifier: (hashedKey: string) => {
        const fingerprint = `SHA256:${hashedKey}`
        if (profile.hostKeyFingerprint) {
          const ok = profile.hostKeyFingerprint === fingerprint
          verification = ok
            ? { ok: true, fingerprint, shouldSave: false }
            : { ok: false, reason: 'mismatch', expected: profile.hostKeyFingerprint, actual: fingerprint }
          return ok
        }

        if (input.acceptHostKey && (!input.expectedHostKeyFingerprint || input.expectedHostKeyFingerprint === fingerprint)) {
          verification = { ok: true, fingerprint, shouldSave: true }
          return true
        }

        verification = { ok: false, reason: 'untrusted', fingerprint }
        return false
      }
    }

    if (profile.authType === 'password') {
      if (!credentials.password) throw new Error('Password is required for this remote server')
      config.password = credentials.password
    } else {
      if (!profile.privateKeyPath) throw new Error('Private key path is required for this remote server')
      config.privateKey = await readFile(profile.privateKeyPath, 'utf8')
      if (credentials.passphrase) config.passphrase = credentials.passphrase
    }

    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        client.removeListener('ready', handleReady)
        client.removeListener('error', handleError)
      }
      const rejectAndClose = (error: Error): void => {
        cleanup()
        this.closeClient(client)
        reject(error)
      }
      const handleReady = (): void => {
        cleanup()
        if (!verification?.ok) {
          this.closeClient(client)
          reject(new Error('Remote host key verification did not complete'))
          return
        }
        resolve({
          client,
          hostKeyFingerprint: verification.fingerprint,
          shouldSaveHostKey: verification.shouldSave
        })
      }
      const handleError = (error: Error): void => {
        if (verification && !verification.ok) {
          rejectAndClose(new HostKeyRejectedError(verification))
          return
        }
        rejectAndClose(error)
      }

      client.once('ready', handleReady)
      client.once('error', handleError)
      client.connect(config)
    })
  }

  private hostKeyResult(profileId: string, result: Exclude<HostKeyVerificationResult, { ok: true }>): RemoteServerConnectResult {
    if (result.reason === 'untrusted') {
      return { status: 'host-key-untrusted', profileId, hostKeyFingerprint: result.fingerprint }
    }
    return {
      status: 'host-key-mismatch',
      profileId,
      expectedHostKeyFingerprint: result.expected,
      actualHostKeyFingerprint: result.actual
    }
  }

  private async status(ownerId: number, sessionId: string): Promise<RemoteServerStatusSnapshot> {
    const session = this.requireOwnedSession(sessionId, ownerId)
    const updatedAt = nowIso()

    try {
      const output = await this.exec(session.client, `sh -c ${quotePosixShellArg(STATUS_COMMAND)}`)
      const values = parseKeyValueOutput(output)
      const diskParts = values.disk?.split(/\s+/)

      return {
        profileId: session.profileId,
        sessionId,
        connection: 'connected',
        updatedAt,
        hostname: optionalString(values.hostname),
        username: optionalString(values.username),
        os: optionalString(values.os),
        kernel: optionalString(values.kernel),
        uptime: optionalString(values.uptime),
        loadAverage: optionalString(values.load),
        cpuUsagePercent: parseNumber(values.cpu),
        memory: parseMetricTriple(values.memory),
        disk: diskParts && diskParts.length >= 4
          ? {
              path: diskParts[0],
              total: Number(diskParts[1]),
              used: Number(diskParts[2]),
              available: Number(diskParts[3])
            }
          : undefined
      }
    } catch (error) {
      return {
        profileId: session.profileId,
        sessionId,
        connection: 'connected',
        updatedAt,
        error: errorMessage(error)
      }
    }
  }

  private async listTree(ownerId: number, sessionId: string, rootPath: string, targetPath: string, maxDepth: number): Promise<FileEntry> {
    const session = this.requireOwnedSession(sessionId, ownerId)
    return this.entryFor(session.sftp, assertInsideRemoteRoot(rootPath, targetPath), maxDepth)
  }

  private async readFile(ownerId: number, sessionId: string, rootPath: string, targetPath: string): Promise<string> {
    const session = this.requireOwnedSession(sessionId, ownerId)
    const remotePath = assertInsideRemoteRoot(rootPath, targetPath)
    const attrs = await this.stat(session.sftp, remotePath)
    if (attrs.size > 1024 * 1024) throw new Error('Remote text file is larger than 1 MiB')
    const value = await this.sftpCall<Buffer | string>((callback) => session.sftp.readFile(remotePath, callback))
    return value.toString()
  }

  private async writeFile(ownerId: number, sessionId: string, rootPath: string, targetPath: string, contents: string): Promise<void> {
    const session = this.requireOwnedSession(sessionId, ownerId)
    await this.sftpCall<void>((callback) => session.sftp.writeFile(assertInsideRemoteRoot(rootPath, targetPath), contents, callback))
  }

  private async createFile(
    ownerId: number,
    sessionId: string,
    rootPath: string,
    targetPath: string,
    name: string | undefined,
    contents: string
  ): Promise<FileEntry> {
    if (!name) throw new Error('Remote file name is required')
    const session = this.requireOwnedSession(sessionId, ownerId)
    const directory = assertInsideRemoteRoot(rootPath, targetPath)
    const filePath = remoteChildPath(directory, name)
    await this.sftpCall<void>((callback) => session.sftp.writeFile(filePath, contents, { flag: 'wx' }, callback))
    return this.entryFor(session.sftp, filePath, 0)
  }

  private async createFolder(ownerId: number, sessionId: string, rootPath: string, targetPath: string, name: string | undefined): Promise<FileEntry> {
    if (!name) throw new Error('Remote folder name is required')
    const session = this.requireOwnedSession(sessionId, ownerId)
    const directory = assertInsideRemoteRoot(rootPath, targetPath)
    const folderPath = remoteChildPath(directory, name)
    await this.sftpCall<void>((callback) => session.sftp.mkdir(folderPath, callback))
    return this.entryFor(session.sftp, folderPath, 0)
  }

  private async rename(ownerId: number, sessionId: string, rootPath: string, targetPath: string, name: string): Promise<FileEntry> {
    const session = this.requireOwnedSession(sessionId, ownerId)
    const sourcePath = assertInsideRemoteRoot(rootPath, targetPath)
    const destinationPath = assertInsideRemoteRoot(rootPath, remoteChildPath(remoteParentPath(sourcePath), name))
    await this.sftpCall<void>((callback) => session.sftp.rename(sourcePath, destinationPath, callback))
    return this.entryFor(session.sftp, destinationPath, 0)
  }

  private async deletePath(ownerId: number, sessionId: string, rootPath: string, targetPath: string, recursive: boolean): Promise<void> {
    const session = this.requireOwnedSession(sessionId, ownerId)
    const remotePath = assertInsideRemoteRoot(rootPath, targetPath)
    if (remotePath === normalizeRemotePath(rootPath)) throw new Error('Cannot delete the remote root')
    await this.deleteEntry(session.sftp, remotePath, recursive)
  }

  private async upload(
    ownerId: number,
    sessionId: string,
    rootPath: string,
    targetPath: string,
    localPath: string,
    name: string | undefined
  ): Promise<FileEntry> {
    const session = this.requireOwnedSession(sessionId, ownerId)
    const directory = assertInsideRemoteRoot(rootPath, targetPath)
    const destinationPath = remoteChildPath(directory, name ?? basename(localPath))
    await this.sftpCall<void>((callback) => session.sftp.fastPut(localPath, destinationPath, callback))
    return this.entryFor(session.sftp, destinationPath, 0)
  }

  private async download(ownerId: number, sessionId: string, rootPath: string, targetPath: string, localDirectory: string): Promise<{ path: string }> {
    const session = this.requireOwnedSession(sessionId, ownerId)
    const remotePath = assertInsideRemoteRoot(rootPath, targetPath)
    const localPath = join(localDirectory, fileNameFromRemotePath(remotePath))
    await this.sftpCall<void>((callback) => session.sftp.fastGet(remotePath, localPath, callback))
    return { path: localPath }
  }

  private async entryFor(sftp: SFTPWrapper, targetPath: string, depth: number): Promise<FileEntry> {
    const attrs = await this.stat(sftp, targetPath)
    const kind = attrs.isDirectory() ? 'directory' : 'file'
    const entry: FileEntry = {
      id: targetPath,
      name: fileNameFromRemotePath(targetPath),
      path: targetPath,
      kind,
      size: attrs.size,
      modifiedAt: new Date(attrs.mtime * 1000).toISOString()
    }

    if (kind !== 'directory') return entry
    if (depth <= 0) return { ...entry, childrenLoaded: false }

    const children = await this.sftpCall<Array<{ filename: string; attrs: { isDirectory: () => boolean; isFile: () => boolean; size: number; mtime: number } }>>(
      (callback) => sftp.readdir(targetPath, callback)
    )
    const childEntries = await Promise.all(
      children
        .filter((child) => child.filename !== '.' && child.filename !== '..')
        .sort((first, second) => {
          const firstDir = first.attrs.isDirectory()
          const secondDir = second.attrs.isDirectory()
          if (firstDir !== secondDir) return firstDir ? -1 : 1
          return first.filename.localeCompare(second.filename)
        })
        .map((child) => this.entryFor(sftp, path.posix.join(targetPath, child.filename), depth - 1))
    )

    return {
      ...entry,
      childrenLoaded: true,
      children: childEntries
    }
  }

  private async deleteEntry(sftp: SFTPWrapper, targetPath: string, recursive: boolean): Promise<void> {
    const attrs = await this.stat(sftp, targetPath)
    if (!attrs.isDirectory()) {
      await this.sftpCall<void>((callback) => sftp.unlink(targetPath, callback))
      return
    }

    if (recursive) {
      const children = await this.sftpCall<Array<{ filename: string }>>((callback) => sftp.readdir(targetPath, callback))
      for (const child of children) {
        if (child.filename === '.' || child.filename === '..') continue
        await this.deleteEntry(sftp, path.posix.join(targetPath, child.filename), true)
      }
    }

    await this.sftpCall<void>((callback) => sftp.rmdir(targetPath, callback))
  }

  private openSftp(client: Client): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      client.sftp((error, sftp) => {
        if (error) reject(error)
        else resolve(sftp)
      })
    })
  }

  private openShell(client: Client, cols: number, rows: number): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      client.shell({ term: 'xterm-256color', cols, rows }, (error, stream) => {
        if (error) reject(error)
        else resolve(stream)
      })
    })
  }

  private realpath(sftp: SFTPWrapper, targetPath: string): Promise<string> {
    return this.sftpCall<string>((callback) => sftp.realpath(targetPath, callback))
  }

  private stat(sftp: SFTPWrapper, targetPath: string): Promise<{ isDirectory: () => boolean; isFile: () => boolean; size: number; mtime: number }> {
    return this.sftpCall((callback) => sftp.stat(targetPath, callback))
  }

  private exec(client: Client, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec(command, (error, stream) => {
        if (error) {
          reject(error)
          return
        }

        let output = ''
        let stderr = ''
        stream.on('data', (data: Buffer | string) => {
          output += data.toString()
        })
        stream.stderr.on('data', (data: Buffer | string) => {
          stderr += data.toString()
        })
        stream.on('close', (code: number | undefined) => {
          if (code && code !== 0 && stderr.trim()) reject(new Error(stderr.trim()))
          else resolve(output)
        })
      })
    })
  }

  private sftpCall<T>(run: (callback: (error: Error | undefined | null, result?: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      run((error, result) => {
        if (error) reject(error)
        else resolve(result as T)
      })
    })
  }

  private write(ownerId: number, sessionId: string, data: string): boolean {
    const session = this.sessionsById.get(sessionId)
    if (!session || session.ownerId !== ownerId) return false

    try {
      session.shell.write(data)
      return true
    } catch (error) {
      console.warn(`Failed to write to remote shell ${sessionId}:`, error)
      return false
    }
  }

  private resize(ownerId: number, sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessionsById.get(sessionId)
    if (!session || session.ownerId !== ownerId) return false

    try {
      session.shell.setWindow(rows, cols, 0, 0)
      return true
    } catch (error) {
      console.warn(`Failed to resize remote shell ${sessionId}:`, error)
      return false
    }
  }

  private async requireProfile(profileId: string): Promise<RemoteServerProfile> {
    const settings = await this.listProfiles()
    const profile = settings.profiles.find((candidate) => candidate.id === profileId)
    if (!profile) throw new Error('Remote server profile not found')
    return profile
  }

  private requireSession(sessionId: string): RemoteSession {
    const session = this.sessionsById.get(sessionId)
    if (!session) throw new Error('Remote server session not found')
    return session
  }

  private requireOwnedSession(sessionId: string, ownerId: number): RemoteSession {
    const session = this.requireSession(sessionId)
    if (session.ownerId !== ownerId) throw new Error('Remote server session not found')
    return session
  }

  private async updateHostKeyFingerprint(profileId: string, hostKeyFingerprint: string): Promise<void> {
    await this.options.appSettingsService.updateSettingsWith((settings) => ({
      ...settings,
      remoteServers: remoteServerSettingsSchema.parse({
        profiles: settings.remoteServers.profiles.map((profile) =>
          profile.id === profileId ? { ...profile, hostKeyFingerprint, updatedAt: nowIso() } : profile
        )
      })
    }))
  }

  private closeByProfileId(profileId: string): void {
    for (const session of [...this.sessionsById.values()]) {
      if (session.profileId === profileId) this.closeBySessionId(session.id)
    }
  }

  private closeByComponentId(ownerId: number, componentId: string): void {
    for (const session of [...this.sessionsById.values()]) {
      if (session.ownerId === ownerId && session.componentId === componentId) this.closeBySessionId(session.id)
    }
  }

  private closeByOwner(ownerId: number): void {
    for (const session of [...this.sessionsById.values()]) {
      if (session.ownerId === ownerId) this.closeBySessionId(session.id)
    }
  }

  private closeBySessionId(sessionId: string, closeClient = true): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return

    this.sessionsById.delete(sessionId)
    this.sessionsByKey.delete(this.sessionKey(session.ownerId, session.componentId, session.profileId))
    this.untrackOwnerSession(session.ownerId, sessionId)

    if (!closeClient) return

    this.closeShell(session.shell)
    this.closeClient(session.client)
  }

  private handleRemoteSessionClosed(sessionId: string): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return

    this.sendToOwner(session.ownerId, 'remote-servers:shell-exit', {
      sessionId,
      componentId: session.componentId,
      profileId: session.profileId
    })
    this.closeBySessionId(sessionId)
  }

  private closeShell(shell: ClientChannel | null): void {
    if (!shell) return

    try {
      shell.close()
    } catch {
      // Ignore close races from already closed SSH channels.
    }
  }

  private closeClient(client: Client | null): void {
    if (!client) return

    try {
      client.end()
    } catch {
      // Ignore close races from already closed clients.
    }
  }

  private trackOwnerSession(owner: WebContents, sessionId: string): void {
    let cleanup = this.ownerCleanupById.get(owner.id)
    if (!cleanup) {
      const onDestroyed = (): void => this.closeByOwner(owner.id)
      cleanup = { sessionIds: new Set(), onDestroyed }
      this.ownerCleanupById.set(owner.id, cleanup)
      owner.once('destroyed', onDestroyed)
    }
    cleanup.sessionIds.add(sessionId)
  }

  private untrackOwnerSession(ownerId: number, sessionId: string): void {
    const cleanup = this.ownerCleanupById.get(ownerId)
    if (!cleanup) return

    cleanup.sessionIds.delete(sessionId)
    if (cleanup.sessionIds.size > 0) return

    this.ownerCleanupById.delete(ownerId)
  }

  private sendToOwner(ownerId: number, channel: string, payload: unknown): void {
    const owner = webContents.fromId(ownerId)
    if (!owner || owner.isDestroyed()) return
    owner.send(channel, payload)
  }

  private sessionKey(ownerId: number, componentId: string, profileId: string): string {
    return `${ownerId}:${componentId}:${profileId}`
  }

  private credentialStore(): RemoteServerCredentialStore {
    return this.options.credentialStore ?? new RemoteServerCredentialStore()
  }
}
