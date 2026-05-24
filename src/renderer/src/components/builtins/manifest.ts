import { BUILTIN_COMPONENT_TYPES } from '@shared/constants'
import { ATLAS_PLUGIN_API_VERSION, atlasPluginManifestSchema } from '@shared/plugins'
import { COMPONENT_DEFINITIONS } from '../component-definitions'

export const BUILT_IN_SYSTEM_PLUGIN_ID = 'atlas.builtins'

export const BUILT_IN_SYSTEM_PLUGIN_MANIFEST = atlasPluginManifestSchema.parse({
  id: BUILT_IN_SYSTEM_PLUGIN_ID,
  name: 'AtlasOS Built-ins',
  version: '1.0.0',
  atlasApiVersion: ATLAS_PLUGIN_API_VERSION,
  description: 'Privileged system plugin that registers AtlasOS built-in canvas nodes.',
  permissions: [],
  configuration: [],
  nodes: BUILTIN_COMPONENT_TYPES.map((type) => {
    const definition = COMPONENT_DEFINITIONS[type]

    return {
      id: definition.type,
      title: definition.title,
      defaultFrame: definition.defaultFrame,
      permissions: definition.permissions,
      creatable: definition.creatable ?? false
    }
  })
})
