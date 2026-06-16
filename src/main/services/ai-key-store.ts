import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { z } from 'zod'

const AI_KEYS_DIR = 'app-settings'
const AI_KEYS_FILE = 'ai-keys.json'

const encryptedKeysSchema = z.record(z.string(), z.string())

export class AiKeyStore {
  private readonly stateDir = join(app.getPath('userData'), AI_KEYS_DIR)
  private readonly statePath = join(this.stateDir, AI_KEYS_FILE)

  async hasKey(profileId: string): Promise<boolean> {
    const keys = await this.readKeys()
    return Boolean(keys[profileId])
  }

  async readKey(profileId: string): Promise<string | null> {
    const keys = await this.readKeys()
    const encrypted = keys[profileId]
    if (!encrypted) return null

    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return null
    }
  }

  async setKey(profileId: string, apiKey: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure key storage is not available on this system')
    }

    const trimmed = apiKey.trim()
    if (!trimmed) throw new Error('API key is required')

    const keys = await this.readKeys()
    keys[profileId] = safeStorage.encryptString(trimmed).toString('base64')
    await this.writeKeys(keys)
  }

  async clearKey(profileId: string): Promise<void> {
    const keys = await this.readKeys()
    if (!keys[profileId]) return

    delete keys[profileId]
    await this.writeKeys(keys)
  }

  private async readKeys(): Promise<Record<string, string>> {
    try {
      const raw = await readFile(this.statePath, 'utf8')
      return encryptedKeysSchema.parse(JSON.parse(raw))
    } catch {
      return {}
    }
  }

  private async writeKeys(keys: Record<string, string>): Promise<void> {
    await mkdir(this.stateDir, { recursive: true })
    await writeFile(this.statePath, `${JSON.stringify(encryptedKeysSchema.parse(keys), null, 2)}\n`, 'utf8')
  }
}
