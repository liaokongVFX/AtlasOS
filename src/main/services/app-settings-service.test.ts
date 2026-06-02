import { mkdir, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ATLAS_SCHEMA_VERSION } from '@shared/constants'
import { AppSettingsService } from './app-settings-service'

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  userDataPath: ''
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => electronMocks.userDataPath)
  },
  ipcMain: {
    handle: electronMocks.ipcHandle
  }
}))

const testRoot = join(process.cwd(), '.atlasos-dev', 'app-settings-service-test')
const userDataPath = join(testRoot, 'user-data')

describe('AppSettingsService', () => {
  beforeEach(async () => {
    electronMocks.ipcHandle.mockClear()
    electronMocks.userDataPath = userDataPath

    await rm(testRoot, { recursive: true, force: true })
    await mkdir(testRoot, { recursive: true })
  })

  it('creates default app settings on first read', async () => {
    const service = new AppSettingsService()

    await expect(service.getSettings()).resolves.toEqual({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      locale: 'zh-CN',
      shortcuts: {
        canvasDeselect: 'Ctrl+Q',
        canvasFind: 'Ctrl+F',
        canvasCreateComponent: 'Tab',
        canvasGroupSelection: 'Ctrl+G',
        canvasUngroupSelection: 'Ctrl+Shift+G'
      },
      updates: {
        autoCheck: true
      },
      pet: {
        enabled: true,
        showNativeNotifications: true,
        showRunningAgents: true,
        position: { x: 36, y: 120 },
        size: 72,
        kanban: { enabled: true },
        agentBridge: { enabled: true },
        assetPack: {
          id: 'atlas-orb',
          name: 'Atlas Orb',
          idleSrc: '',
          idleKind: 'image',
          idleSprite: { frameCount: 8, fps: 8 },
          runningSrc: '',
          runningKind: 'image',
          runningSprite: { frameCount: 8, fps: 8 },
          attentionSrc: '',
          attentionKind: 'image',
          attentionSprite: { frameCount: 8, fps: 8 }
        },
        actionMap: { idle: 'float', running: 'bounce', attention: 'pulse' }
      }
    })
  })

  it('persists normalized shortcut settings', async () => {
    const service = new AppSettingsService()

    await service.updateSettings({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      locale: 'en-US',
      shortcuts: {
        canvasDeselect: 'ctrl + shift + x',
        canvasFind: 'alt + f',
        canvasCreateComponent: 'ctrl + alt + space',
        canvasGroupSelection: 'ctrl + g',
        canvasUngroupSelection: 'ctrl + shift + g'
      },
      pet: {
        enabled: false,
        showNativeNotifications: false,
        showRunningAgents: true,
        position: { x: 320, y: 240 },
        size: 80,
        kanban: { enabled: true },
        agentBridge: { enabled: false },
        assetPack: {
          id: 'atlas-orb',
          name: 'Atlas Orb',
          idleSrc: '',
          idleKind: 'image',
          idleSprite: { frameCount: 8, fps: 8 },
          runningSrc: '',
          runningKind: 'image',
          runningSprite: { frameCount: 8, fps: 8 },
          attentionSrc: '',
          attentionKind: 'image',
          attentionSprite: { frameCount: 8, fps: 8 }
        },
        actionMap: { idle: 'float', running: 'bounce', attention: 'pulse' }
      },
      updates: {
        autoCheck: false
      }
    })

    await expect(new AppSettingsService().getSettings()).resolves.toEqual({
      schemaVersion: ATLAS_SCHEMA_VERSION,
      locale: 'en-US',
      shortcuts: {
        canvasDeselect: 'Ctrl+Shift+X',
        canvasFind: 'Alt+F',
        canvasCreateComponent: 'Ctrl+Alt+Space',
        canvasGroupSelection: 'Ctrl+G',
        canvasUngroupSelection: 'Ctrl+Shift+G'
      },
      updates: {
        autoCheck: false
      },
      pet: {
        enabled: false,
        showNativeNotifications: false,
        showRunningAgents: true,
        position: { x: 320, y: 240 },
        size: 80,
        kanban: { enabled: true },
        agentBridge: { enabled: false },
        assetPack: {
          id: 'atlas-orb',
          name: 'Atlas Orb',
          idleSrc: '',
          idleKind: 'image',
          idleSprite: { frameCount: 8, fps: 8 },
          runningSrc: '',
          runningKind: 'image',
          runningSprite: { frameCount: 8, fps: 8 },
          attentionSrc: '',
          attentionKind: 'image',
          attentionSprite: { frameCount: 8, fps: 8 }
        },
        actionMap: { idle: 'float', running: 'bounce', attention: 'pulse' }
      }
    })
  })

  it('serializes concurrent settings writes', async () => {
    const service = new AppSettingsService()
    const baseSettings = await service.getSettings()

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        service.updateSettings({
          ...baseSettings,
          pet: {
            ...baseSettings.pet,
            position: { x: 40 + index, y: 140 + index }
          }
        })
      )
    )

    const settings = await new AppSettingsService().getSettings()
    expect(settings.pet.position).toEqual({ x: 59, y: 159 })
    const files = await readdir(join(userDataPath, 'app-settings'))
    expect(files.filter((file) => file.endsWith('.tmp'))).toEqual([])
  })
})
