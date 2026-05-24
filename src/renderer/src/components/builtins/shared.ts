import type { ComponentType } from '@shared/schema'
import type { BuiltInComponentType } from '@shared/constants'
import {
  componentTypeForFileSource,
  createFileComponentPatch,
  type CanvasFileSource,
  type FileComponentPatch
} from '../../lib/file-component-factory'
import { COMPONENT_DEFINITIONS } from '../component-definitions'
import type { HostRendererPluginNodeDefinition } from '../../plugins/registration'

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function fileSourceMatches(type: ComponentType): (file: CanvasFileSource) => boolean {
  return (file) => componentTypeForFileSource(file) === type
}

export function createFileComponentFromSource(type: ComponentType): (file: CanvasFileSource) => Promise<FileComponentPatch> {
  return (file) => createFileComponentPatch(file, type)
}

export function builtInNodeMeta(type: BuiltInComponentType): Pick<
  HostRendererPluginNodeDefinition,
  'creatable' | 'defaultFrame' | 'id' | 'permissions' | 'title' | 'titleKey'
> {
  const definition = COMPONENT_DEFINITIONS[type]

  return {
    id: definition.type,
    title: definition.title,
    titleKey: definition.titleKey,
    defaultFrame: definition.defaultFrame,
    permissions: definition.permissions,
    creatable: definition.creatable
  }
}
