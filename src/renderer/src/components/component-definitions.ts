import type { ComponentType, Frame } from '@shared/schema'

export type ComponentDefinitionMeta = {
  type: ComponentType
  title: string
  defaultFrame: Frame
  permissions: string[]
}

export const COMPONENT_DEFINITIONS: Record<ComponentType, ComponentDefinitionMeta> = {
  terminal: {
    type: 'terminal',
    title: 'Terminal',
    defaultFrame: { x: 120, y: 120, width: 720, height: 420 },
    permissions: ['pty:spawn', 'pty:write']
  },
  'file-tree': {
    type: 'file-tree',
    title: 'Files',
    defaultFrame: { x: 180, y: 160, width: 360, height: 560 },
    permissions: ['fs:choose-directory', 'fs:read', 'fs:write', 'fs:trash', 'fs:watch']
  },
  browser: {
    type: 'browser',
    title: 'Browser',
    defaultFrame: { x: 240, y: 180, width: 900, height: 620 },
    permissions: ['browser:view', 'browser:automation']
  },
  'markdown-note': {
    type: 'markdown-note',
    title: 'Markdown Note',
    defaultFrame: { x: 260, y: 220, width: 640, height: 520 },
    permissions: ['note:edit']
  },
  'file-preview': {
    type: 'file-preview',
    title: 'File Preview',
    defaultFrame: { x: 300, y: 260, width: 560, height: 420 },
    permissions: ['fs:read']
  }
}
