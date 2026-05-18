export const ATLAS_SCHEMA_VERSION = 1

export const COMPONENT_TYPES = ['terminal', 'file-tree', 'browser', 'markdown-note', 'file-preview'] as const

export const DEFAULT_CANVAS_BACKGROUND = {
  color: '#0d1117',
  grid: {
    enabled: true,
    size: 24,
    opacity: 0.18,
    variant: 'dots'
  },
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
