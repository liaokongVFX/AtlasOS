import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { EditorInsertionResult, QuickInputFocus } from '@shared/quick-input-editor'

export type QuickInputTarget = {
  point: { x: number; y: number } | null
  focusState(panelHandle?: number): Promise<QuickInputFocus>
  insert?(text: string, panelHandle: number): Promise<EditorInsertionResult>
  release(): void
}

export class WindowsQuickInput {
  private readonly child = spawn(join(__dirname.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked'), 'quick-input-helper.exe'), {
    stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true
  })
  private readonly replies: Array<(line: string) => void> = []
  readonly ready: Promise<boolean>
  private stopped = false
  private nextId = 0

  constructor() {
    this.ready = this.reply().then((line) => line === 'ready')
    createInterface({ input: this.child.stdout }).on('line', (line) => this.replies.shift()?.(line))
    this.child.on('error', () => this.dispose())
    this.child.on('exit', () => this.dispose())
    this.child.stdin.on('error', () => this.dispose())
  }

  private reply(): Promise<string> {
    if (this.stopped) return Promise.resolve('unavailable')
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.dispose(), 8000)
      this.replies.push((line) => { clearTimeout(timer); resolve(line) })
    })
  }

  private command(line: string): Promise<string> {
    if (this.stopped) return Promise.resolve('unavailable')
    const result = this.reply()
    this.child.stdin.write(line + '\n')
    return result
  }

  async capture(): Promise<QuickInputTarget | null> {
    const id = ++this.nextId
    const [status, left, top, right, bottom, mode] = (await this.command(`capture ${id}`)).split(' ')
    if (status !== 'captured') return null
    return {
      point: { x: Math.round((Number(left) + Number(right)) / 2), y: Math.round((Number(top) + Number(bottom)) / 2) },
      focusState: async (panelHandle = 0) => {
        const state = await this.command(`current ${id} ${panelHandle}`)
        return state === 'current' || state === 'switched' ? state : 'unavailable'
      },
      insert: mode === 'edit' ? async (text, panelHandle) => {
        const encoded = Buffer.from(text, 'utf16le').toString('base64')
        const result = await this.command(`insert ${id} ${panelHandle} ${encoded}`)
        return result === 'inserted' || result === 'unavailable' ? result : 'unknown'
      } : undefined,
      release: () => { void this.command(`cancel ${id}`) }
    }
  }

  async waitForKeysReleased(): Promise<boolean> {
    for (;;) {
      const result = await this.command('release-keys')
      if (result !== 'held') return result === 'released'
      await new Promise(resolve => setTimeout(resolve, 15))
    }
  }

  async hasOtherForeground(original: number, panel: number): Promise<boolean> {
    return await this.command(`foreground ${original} ${panel}`) === 'switched'
  }

  dispose(): void {
    if (this.stopped) return
    this.stopped = true
    this.child.kill()
    for (const finish of this.replies.splice(0)) finish('unknown')
  }
}
