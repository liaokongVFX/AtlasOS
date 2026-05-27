export const ATLAS_SCHEMA_VERSION = 1

export const DEFAULT_LOCALE = 'zh-CN'
export const LOCALES = ['zh-CN', 'en-US'] as const
export type Locale = (typeof LOCALES)[number]

export const BUILTIN_COMPONENT_TYPES = ['terminal', 'file-tree', 'browser', 'markdown-note', 'file-preview', 'kanban', 'quick-launcher', 'system-monitor', 'calendar'] as const
export const COMPONENT_TYPES = BUILTIN_COMPONENT_TYPES
export type BuiltInComponentType = (typeof BUILTIN_COMPONENT_TYPES)[number]

export const DEFAULT_CANVAS_BACKGROUND = {
  color: '#010102',
  image: {
    src: '',
    opacity: 0.35,
    fit: 'cover',
    fixed: true
  }
} as const

export const DEFAULT_VIEWPORT = {
  x: 0,
  y: 0,
  zoom: 0.85
} as const

export const DEFAULT_APP_SHORTCUTS = {
  canvasDeselect: 'Ctrl+Q',
  canvasFind: 'Ctrl+F',
  canvasCreateComponent: 'Tab'
} as const
