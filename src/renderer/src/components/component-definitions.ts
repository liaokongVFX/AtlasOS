import type { BuiltInComponentType } from '@shared/constants'
import type { Frame } from '@shared/schema'
import type { I18nKey } from '../i18n'

export type ComponentDefinitionMeta = {
  type: string
  title: string
  titleKey?: I18nKey
  defaultFrame: Frame
  permissions: string[]
  creatable?: boolean
}

export const CREATABLE_BUILTIN_COMPONENT_TYPES = ['terminal', 'file-tree', 'browser', 'markdown-note', 'kanban', 'quick-launcher', 'system-monitor', 'calendar'] as const satisfies readonly BuiltInComponentType[]

export const COMPONENT_DEFINITIONS: Record<BuiltInComponentType, ComponentDefinitionMeta> = {
  terminal: {
    type: 'terminal',
    title: 'Terminal',
    titleKey: 'component.terminal',
    defaultFrame: { x: 120, y: 120, width: 720, height: 420 },
    permissions: ['pty:spawn', 'pty:write'],
    creatable: true
  },
  'file-tree': {
    type: 'file-tree',
    title: 'Files',
    titleKey: 'component.files',
    defaultFrame: { x: 180, y: 160, width: 360, height: 560 },
    permissions: ['fs:choose-directory', 'fs:read', 'fs:write', 'fs:trash', 'fs:watch'],
    creatable: true
  },
  browser: {
    type: 'browser',
    title: 'Browser',
    titleKey: 'component.browser',
    defaultFrame: { x: 240, y: 180, width: 900, height: 620 },
    permissions: ['browser:view', 'browser:automation'],
    creatable: true
  },
  'markdown-note': {
    type: 'markdown-note',
    title: 'Markdown Note',
    titleKey: 'component.markdownNote',
    defaultFrame: { x: 260, y: 220, width: 640, height: 520 },
    permissions: ['note:edit'],
    creatable: true
  },
  'file-preview': {
    type: 'file-preview',
    title: 'File Preview',
    titleKey: 'component.filePreview',
    defaultFrame: { x: 300, y: 260, width: 560, height: 420 },
    permissions: ['fs:read']
  },
  kanban: {
    type: 'kanban',
    title: 'Kanban',
    titleKey: 'component.kanban',
    defaultFrame: { x: 280, y: 220, width: 920, height: 620 },
    permissions: ['kanban:edit'],
    creatable: true
  },
  'quick-launcher': {
    type: 'quick-launcher',
    title: 'Quick Launcher',
    titleKey: 'component.quickLauncher',
    defaultFrame: { x: 320, y: 240, width: 680, height: 520 },
    permissions: ['launcher:open'],
    creatable: true
  },
  'system-monitor': {
    type: 'system-monitor',
    title: 'System Monitor',
    titleKey: 'component.systemMonitor',
    defaultFrame: { x: 340, y: 260, width: 520, height: 360 },
    permissions: ['system:metrics'],
    creatable: true
  },
  calendar: {
    type: 'calendar',
    title: 'Calendar',
    titleKey: 'component.calendar',
    defaultFrame: { x: 360, y: 280, width: 560, height: 460 },
    permissions: [],
    creatable: true
  }
}
