import type { CanvasComponent } from '@shared/schema'

export const TERMINAL_LOCKED_STATE_KEY = 'locked'

export function isTerminalComponentLocked(component: Pick<CanvasComponent, 'type' | 'state'>): boolean {
  return component.type === 'terminal' && component.state[TERMINAL_LOCKED_STATE_KEY] === true
}
