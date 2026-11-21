import type { Locale } from './constants'
import type { AppShortcutSettings } from './schema'

export const canvasShortcutLabels = {
  canvasDeselect: { 'zh-CN': '取消选择节点', 'en-US': 'Deselect nodes' },
  canvasFind: { 'zh-CN': '查找节点', 'en-US': 'Find nodes' },
  canvasCreateComponent: { 'zh-CN': '创建组件菜单', 'en-US': 'Open create menu' },
  canvasGroupSelection: { 'zh-CN': '打组选中节点', 'en-US': 'Group selected nodes' },
  canvasUngroupSelection: { 'zh-CN': '取消选中组', 'en-US': 'Ungroup selected groups' }
} satisfies Record<keyof AppShortcutSettings, Record<Locale, string>>
