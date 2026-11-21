import type { AppSettings } from '@shared/schema'
import { shortcutProblem } from '@shared/quick-input-shortcuts'

type ShortcutRegistry = Pick<Electron.GlobalShortcut, 'register' | 'unregister'>

function accelerator(key: string): string {
  return key.split('+').map(token => token.replace(/^Arrow/, '')).join('+')
}

export class QuickInputHotkeys {
  private actions = new Map<string, string | null>()
  private unavailable = new Map<string, string | null>()
  private readonly held = new Set<string>()

  constructor(
    private readonly registry: ShortcutRegistry,
    private readonly trigger: (snippetId: string | null) => void,
    private readonly waitForRelease: () => Promise<boolean>,
    private readonly record: (shortcut: string) => boolean = () => false
  ) {}

  start(settings: AppSettings): void {
    this.prepare(settings, true).commit()
  }

  unavailableKeys(): string[] { return [...this.unavailable.keys()] }

  dispose(): void {
    for (const key of this.actions.keys()) this.registry.unregister(accelerator(key))
    this.actions.clear()
    this.unavailable.clear()
  }

  prepare(settings: AppSettings, startup = false) {
    const actions = new Map<string, string | null>()
    if (settings.quickInput.windowShortcut) actions.set(settings.quickInput.windowShortcut, null)
    for (const snippet of settings.quickInput.snippets) {
      if (snippet.shortcut) actions.set(snippet.shortcut, snippet.id)
    }
    const added: string[] = []
    const unavailable = new Map<string, string | null>()
    const rollback = (): void => {
      for (const key of added) this.registry.unregister(accelerator(key))
    }
    try {
      for (const [key, snippetId] of actions) {
        if (this.actions.has(key)) continue
        const problem = shortcutProblem(settings, snippetId === null ? 'window' : `snippet:${snippetId}`, key)
        const ok = !problem && this.registry.register(accelerator(key), () => {
          const id = this.actions.get(key)
          if (id === undefined || this.held.has(key)) return
          this.held.add(key)
          if (!this.record(key)) this.trigger(id)
          void this.waitForRelease().finally(() => this.held.delete(key))
        })
        if (!ok && (startup || this.unavailable.get(key) === snippetId)) {
          unavailable.set(key, snippetId)
          actions.delete(key)
          continue
        }
        if (!ok) throw new Error(problem ?? (settings.locale === 'en-US'
          ? `Windows could not register ${key}. It may be in use by another application.`
          : `Windows 无法注册 ${key}，该键可能已被其他程序占用。`))
        added.push(key)
      }
    } catch (error) {
      rollback()
      throw error
    }
    return { rollback, commit: () => {
      for (const key of this.actions.keys()) {
        if (!actions.has(key)) this.registry.unregister(accelerator(key))
      }
      this.actions = actions
      this.unavailable = unavailable
    } }
  }
}
