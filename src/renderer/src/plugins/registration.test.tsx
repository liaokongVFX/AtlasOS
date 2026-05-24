import { describe, expect, it, vi, afterEach } from 'vitest'
import { ATLAS_PLUGIN_API_VERSION, type AtlasPluginManifest } from '@shared/plugins'
import type { CanvasComponent } from '@shared/schema'
import { getComponentDefinition, unregisterComponentDefinitionsByPlugin } from '../components/registry'
import { createRendererPluginApi, type HostRendererPluginNodeDefinition } from './registration'

const defaultFrame = { x: 120, y: 120, width: 360, height: 240 }

function createManifest(pluginId: string): AtlasPluginManifest {
  return {
    id: pluginId,
    name: 'Timer',
    version: '1.0.0',
    atlasApiVersion: ATLAS_PLUGIN_API_VERSION,
    permissions: ['native:timer'],
    configuration: [],
    nodes: [
      {
        id: 'focus-timer',
        title: 'Focus Timer',
        defaultFrame,
        permissions: ['node:timer'],
        creatable: true
      }
    ]
  }
}

const component = {
  id: 'component-1',
  type: 'plugin:acme.timer/focus-timer',
  title: 'Focus Timer',
  frame: defaultFrame,
  zIndex: 1,
  config: {},
  state: {},
  bindings: {},
  createdAt: '2026-05-21T00:00:00.000Z',
  updatedAt: '2026-05-21T00:00:00.000Z'
} satisfies CanvasComponent

describe('createRendererPluginApi', () => {
  afterEach(() => {
    unregisterComponentDefinitionsByPlugin('acme.timer')
    unregisterComponentDefinitionsByPlugin('atlas.system-timer')
  })

  it('registers external plugin nodes as namespaced component definitions', () => {
    const manifest = createManifest('acme.timer')
    const invoke = vi.fn()
    const Renderer = () => null

    createRendererPluginApi({ id: manifest.id, manifest, config: { precision: 12 } }, { invoke }).registerNode({
      id: 'focus-timer',
      title: 'Timer Node',
      permissions: ['node:timer', 'extra:timer'],
      Renderer
    })

    const definition = getComponentDefinition('plugin:acme.timer/focus-timer')
    const element = definition.Renderer({
      canvasId: 'canvas-1',
      component,
      updateConfig: vi.fn(),
      updateState: vi.fn(),
      setTitle: vi.fn()
    })

    expect(definition).toMatchObject({
      type: 'plugin:acme.timer/focus-timer',
      title: 'Timer Node',
      defaultFrame,
      permissions: ['native:timer', 'node:timer', 'extra:timer'],
      creatable: true,
      pluginId: 'acme.timer'
    })
    expect(element.props.plugin).toMatchObject({ id: 'acme.timer', config: { precision: 12 } })
    expect(element.props.invoke).toBe(invoke)
  })

  it('keeps host-only hooks behind the system plugin registration option', () => {
    const externalManifest = createManifest('acme.timer')
    const systemManifest = createManifest('atlas.system-timer')
    const Renderer = () => null
    const acceptsFile = vi.fn(() => true)
    const createFromFile = vi.fn()
    const hostNode = {
      id: 'focus-timer',
      titleKey: 'component.terminal',
      Renderer,
      acceptsFile,
      createFromFile
    } satisfies HostRendererPluginNodeDefinition

    createRendererPluginApi({ id: externalManifest.id, manifest: externalManifest, config: {} }, { invoke: vi.fn() }).registerNode(hostNode)
    createRendererPluginApi(
      { id: systemManifest.id, manifest: systemManifest, config: {} },
      {
        componentTypeForNode: (nodeId) => nodeId,
        includeHostHooks: true,
        invoke: vi.fn()
      }
    ).registerNode(hostNode)

    const externalDefinition = getComponentDefinition('plugin:acme.timer/focus-timer')
    const systemDefinition = getComponentDefinition('focus-timer')

    expect(externalDefinition.titleKey).toBeUndefined()
    expect(externalDefinition.acceptsFile).toBeUndefined()
    expect(externalDefinition.createFromFile).toBeUndefined()
    expect(systemDefinition).toMatchObject({
      type: 'focus-timer',
      titleKey: 'component.terminal',
      pluginId: 'atlas.system-timer'
    })
    expect(systemDefinition.acceptsFile).toBe(acceptsFile)
    expect(systemDefinition.createFromFile).toBe(createFromFile)
  })
})
