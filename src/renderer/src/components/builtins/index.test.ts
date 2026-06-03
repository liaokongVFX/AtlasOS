import { describe, expect, it } from 'vitest'
import { BUILTIN_COMPONENT_TYPES } from '@shared/constants'
import { translate } from '../../i18n'
import { createBuiltInComponentDefinitions, createBuiltInSystemPlugin } from '.'
import { getComponentDefinition } from '../registry'
import { registerBuiltInComponentDefinitions } from '../register-builtins'
import { BUILT_IN_SYSTEM_PLUGIN_ID, BUILT_IN_SYSTEM_PLUGIN_MANIFEST } from './manifest'

describe('built-in component definitions', () => {
  it('registers each built-in node through the adapter in stable order', () => {
    const definitions = createBuiltInComponentDefinitions()
    const types = definitions.map((definition) => definition.id)

    expect(types).toEqual([...BUILTIN_COMPONENT_TYPES])
    expect(new Set(types).size).toBe(types.length)
    expect(definitions.every((definition) => typeof definition.Renderer === 'function')).toBe(true)
    expect(definitions.every((definition) => definition.icon)).toBe(true)
  })

  it('keeps file preview as a file-drop-only node', () => {
    const definitions = createBuiltInComponentDefinitions()
    const filePreview = definitions.find((definition) => definition.id === 'file-preview')

    expect(filePreview?.creatable).toBe(false)
    expect(typeof filePreview?.acceptsFile).toBe('function')
    expect(typeof filePreview?.createFromFile).toBe('function')
  })

  it('describes built-ins as a privileged system plugin', () => {
    const plugin = createBuiltInSystemPlugin()

    expect(plugin.manifest).toBe(BUILT_IN_SYSTEM_PLUGIN_MANIFEST)
    expect(plugin.manifest.id).toBe(BUILT_IN_SYSTEM_PLUGIN_ID)
    expect(plugin.manifest.nodes.map((node) => node.id)).toEqual([...BUILTIN_COMPONENT_TYPES])
  })

  it('installs built-ins through the system plugin registration path', () => {
    registerBuiltInComponentDefinitions()

    const terminal = getComponentDefinition('terminal')
    const filePreview = getComponentDefinition('file-preview')
    const quickLauncher = getComponentDefinition('quick-launcher')
    const systemMonitor = getComponentDefinition('system-monitor')
    const calendar = getComponentDefinition('calendar')
    const sketch = getComponentDefinition('sketch')
    const claudeHistory = getComponentDefinition('claude-history')
    const codexHistory = getComponentDefinition('codex-history')

    expect(terminal.type).toBe('terminal')
    expect(terminal.pluginId).toBe(BUILT_IN_SYSTEM_PLUGIN_ID)
    expect(terminal.titleKey).toBe('component.terminal')
    expect(filePreview.type).toBe('file-preview')
    expect(filePreview.pluginId).toBe(BUILT_IN_SYSTEM_PLUGIN_ID)
    expect(filePreview.creatable).toBe(false)
    expect(quickLauncher.type).toBe('quick-launcher')
    expect(quickLauncher.pluginId).toBe(BUILT_IN_SYSTEM_PLUGIN_ID)
    expect(quickLauncher.permissions).toContain('launcher:open')
    expect(systemMonitor.type).toBe('system-monitor')
    expect(systemMonitor.pluginId).toBe(BUILT_IN_SYSTEM_PLUGIN_ID)
    expect(systemMonitor.permissions).toContain('system:metrics')
    expect(calendar.type).toBe('calendar')
    expect(calendar.pluginId).toBe(BUILT_IN_SYSTEM_PLUGIN_ID)
    expect(calendar.permissions).toEqual([])
    expect(sketch.type).toBe('sketch')
    expect(sketch.pluginId).toBe(BUILT_IN_SYSTEM_PLUGIN_ID)
    expect(sketch.permissions).toEqual(['sketch:edit'])
    expect(sketch.titleKey).toBe('component.sketch')
    expect([translate('zh-CN', 'sketch.stats', { elements: 0 }), translate('en-US', 'sketch.stats', { elements: 0 })]).toContain(
      sketch.getDetail?.({ state: { sketchScene: null } } as never)
    )
    expect(claudeHistory.type).toBe('claude-history')
    expect(claudeHistory.pluginId).toBe(BUILT_IN_SYSTEM_PLUGIN_ID)
    expect(claudeHistory.permissions).toEqual(['claude:history', 'pty:spawn', 'pty:write'])
    expect(claudeHistory.titleKey).toBe('component.claudeHistory')
    expect(codexHistory.type).toBe('codex-history')
    expect(codexHistory.pluginId).toBe(BUILT_IN_SYSTEM_PLUGIN_ID)
    expect(codexHistory.permissions).toEqual(['codex:history', 'pty:spawn', 'pty:write'])
    expect(codexHistory.titleKey).toBe('component.codexHistory')
  })
})
