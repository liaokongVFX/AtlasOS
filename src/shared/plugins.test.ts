import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ATLAS_PLUGIN_API_VERSION,
  atlasPluginManifestSchema,
  parsePluginRendererModuleUrl,
  pluginComponentType,
  pluginRendererModuleUrl
} from './plugins'

const defaultFrame = { x: 120, y: 120, width: 360, height: 240 }

describe('atlasPluginManifestSchema', () => {
  it('accepts a trusted local plugin manifest with renderer and native contributions', () => {
    const manifest = atlasPluginManifestSchema.parse({
      id: 'acme.timer',
      name: 'Timer',
      version: '1.0.0',
      atlasApiVersion: ATLAS_PLUGIN_API_VERSION,
      renderer: { entry: 'dist/renderer.js' },
      native: { entry: 'native/main.js' },
      permissions: ['native:timer'],
      configuration: [
        {
          id: 'intervalMinutes',
          label: 'Interval minutes',
          type: 'number',
          default: 25,
          min: 1,
          max: 120
        }
      ],
      nodes: [
        {
          id: 'focus-timer',
          title: 'Focus Timer',
          defaultFrame,
          permissions: ['native:timer']
        }
      ]
    })

    expect(manifest.nodes[0]).toMatchObject({
      id: 'focus-timer',
      creatable: true
    })
    expect(manifest.configuration[0]).toMatchObject({
      id: 'intervalMinutes',
      options: []
    })
  })

  it('rejects duplicate node ids before they can collide in the component registry', () => {
    expect(() =>
      atlasPluginManifestSchema.parse({
        id: 'acme.timer',
        name: 'Timer',
        version: '1.0.0',
        atlasApiVersion: ATLAS_PLUGIN_API_VERSION,
        nodes: [
          { id: 'focus-timer', title: 'Focus Timer', defaultFrame },
          { id: 'focus-timer', title: 'Second Timer', defaultFrame }
        ]
      })
    ).toThrow(/Duplicate plugin node id/)
  })

  it('rejects duplicate plugin config field ids', () => {
    expect(() =>
      atlasPluginManifestSchema.parse({
        id: 'acme.timer',
        name: 'Timer',
        version: '1.0.0',
        atlasApiVersion: ATLAS_PLUGIN_API_VERSION,
        configuration: [
          { id: 'intervalMinutes', label: 'Interval minutes', type: 'number' },
          { id: 'intervalMinutes', label: 'Second interval', type: 'number' }
        ],
        nodes: []
      })
    ).toThrow(/Duplicate plugin config field id/)
  })

  it('accepts the checked-in calculator example plugin', async () => {
    const pluginRoot = join(process.cwd(), 'examples', 'plugins', 'calculator')
    const raw = await readFile(join(pluginRoot, 'atlas-plugin.json'), 'utf8')
    const manifest = atlasPluginManifestSchema.parse(JSON.parse(raw))
    const rendererEntry = await stat(join(pluginRoot, manifest.renderer?.entry ?? ''))

    expect(manifest.id).toBe('atlas.calculator')
    expect(manifest.configuration.map((field) => field.id)).toEqual(['precision'])
    expect(manifest.nodes.map((node) => node.id)).toEqual(['calculator'])
    expect(rendererEntry.isFile()).toBe(true)
  })
})

describe('plugin renderer URL helpers', () => {
  it('namespaces plugin component types by plugin id and node id', () => {
    expect(pluginComponentType('acme.timer', 'focus-timer')).toBe('plugin:acme.timer/focus-timer')
  })

  it('round-trips renderer module URLs without exposing absolute local paths', () => {
    const url = pluginRendererModuleUrl('acme.timer', 'dist\\renderer module.js')

    expect(url).toBe('atlas-plugin://acme.timer/dist/renderer%20module.js')
    expect(parsePluginRendererModuleUrl(url)).toEqual({
      pluginId: 'acme.timer',
      relativePath: 'dist/renderer module.js'
    })
  })
})
