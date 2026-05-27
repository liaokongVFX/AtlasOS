import { describe, expect, it } from 'vitest'
import { BUILTIN_COMPONENT_TYPES } from '@shared/constants'
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
  })
})
