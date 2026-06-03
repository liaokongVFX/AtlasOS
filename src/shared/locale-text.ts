import { DEFAULT_LOCALE, type Locale } from './constants'

export type SharedI18nKey =
  | 'canvas.homeName'
  | 'canvas.newCanvasName'
  | 'canvas.untitledName'
  | 'filesystem.chooseFolder'
  | 'main.openAtlas'
  | 'main.quitAtlas'
  | 'main.settings'
  | 'main.trayTooltip'
  | 'plugin.installTitle'

type SharedI18nValues = Record<string, string | number>

const messages: Record<Locale, Record<SharedI18nKey, string>> = {
  'zh-CN': {
    'canvas.homeName': '主页',
    'canvas.newCanvasName': '画布 {index}',
    'canvas.untitledName': '未命名画布',
    'filesystem.chooseFolder': '选择文件夹',
    'main.openAtlas': '打开',
    'main.quitAtlas': '退出',
    'main.settings': '设置',
    'main.trayTooltip': 'AtlasOS - 双击打开',
    'plugin.installTitle': '安装 AtlasOS 插件'
  },
  'en-US': {
    'canvas.homeName': 'Home',
    'canvas.newCanvasName': 'Canvas {index}',
    'canvas.untitledName': 'Untitled Canvas',
    'filesystem.chooseFolder': 'Choose folder',
    'main.openAtlas': 'Open',
    'main.quitAtlas': 'Quit',
    'main.settings': 'Settings',
    'main.trayTooltip': 'AtlasOS - Double-click to open',
    'plugin.installTitle': 'Install AtlasOS plugin'
  }
}

function formatMessage(template: string, values?: SharedI18nValues): string {
  if (!values) return template

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  )
}

export function translateShared(locale: Locale | undefined, key: SharedI18nKey, values?: SharedI18nValues): string {
  return formatMessage(messages[locale ?? DEFAULT_LOCALE]?.[key] ?? messages[DEFAULT_LOCALE][key], values)
}
