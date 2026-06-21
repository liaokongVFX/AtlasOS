import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { z } from 'zod'

const REMOTE_SERVER_CREDENTIALS_DIR = 'app-settings'
const REMOTE_SERVER_CREDENTIALS_FILE = 'remote-server-credentials.json'

const encryptedCredentialsSchema = z.record(
  z.string(),
  z.object({
    password: z.string().optional(),
    passphrase: z.string().optional()
  })
)

export type RemoteServerCredentials = {
  password?: string
  passphrase?: string
}

export class RemoteServerCredentialStore {
  private readonly stateDir = join(app.getPath('userData'), REMOTE_SERVER_CREDENTIALS_DIR)
  private readonly statePath = join(this.stateDir, REMOTE_SERVER_CREDENTIALS_FILE)

  async readCredentials(profileId: string): Promise<RemoteServerCredentials> {
    const saved = (await this.readSavedCredentials())[profileId]
    if (!saved) return {}

    return {
      password: saved.password ? this.decrypt(saved.password) : undefined,
      passphrase: saved.passphrase ? this.decrypt(saved.passphrase) : undefined
    }
  }

  async credentialState(profileId: string): Promise<{ passwordConfigured: boolean; passphraseConfigured: boolean }> {
    const saved = (await this.readSavedCredentials())[profileId]
    return {
      passwordConfigured: Boolean(saved?.password),
      passphraseConfigured: Boolean(saved?.passphrase)
    }
  }

  async updateCredentials(
    profileId: string,
    input: { password?: string; passphrase?: string; clearPassword?: boolean; clearPassphrase?: boolean }
  ): Promise<{ passwordConfigured: boolean; passphraseConfigured: boolean }> {
    if ((input.password && input.password.trim()) || (input.passphrase && input.passphrase.trim())) {
      this.assertSecureStorageAvailable()
    }

    const saved = await this.readSavedCredentials()
    const current = { ...(saved[profileId] ?? {}) }

    if (input.clearPassword) delete current.password
    if (input.clearPassphrase) delete current.passphrase
    if (input.password?.trim()) current.password = this.encrypt(input.password)
    if (input.passphrase?.trim()) current.passphrase = this.encrypt(input.passphrase)

    if (current.password || current.passphrase) saved[profileId] = current
    else delete saved[profileId]

    await this.writeSavedCredentials(saved)
    return this.credentialState(profileId)
  }

  async clearCredentials(profileId: string): Promise<void> {
    const saved = await this.readSavedCredentials()
    if (!saved[profileId]) return

    delete saved[profileId]
    await this.writeSavedCredentials(saved)
  }

  private assertSecureStorageAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is not available on this system')
    }
  }

  private encrypt(value: string): string {
    return safeStorage.encryptString(value).toString('base64')
  }

  private decrypt(value: string): string | undefined {
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      return undefined
    }
  }

  private async readSavedCredentials(): Promise<Record<string, { password?: string; passphrase?: string }>> {
    try {
      const raw = await readFile(this.statePath, 'utf8')
      return encryptedCredentialsSchema.parse(JSON.parse(raw))
    } catch {
      return {}
    }
  }

  private async writeSavedCredentials(credentials: Record<string, { password?: string; passphrase?: string }>): Promise<void> {
    await mkdir(this.stateDir, { recursive: true })
    await writeFile(this.statePath, `${JSON.stringify(encryptedCredentialsSchema.parse(credentials), null, 2)}\n`, 'utf8')
  }
}
