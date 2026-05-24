import { z } from 'zod'
import { frameSchema } from './schema'

export const ATLAS_PLUGIN_API_VERSION = 1
export const ATLAS_PLUGIN_MANIFEST_FILE = 'atlas-plugin.json'
export const ATLAS_PLUGIN_RENDERER_PROTOCOL = 'atlas-plugin'

export const pluginIdSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)

export const pluginNodeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)

export const pluginPermissionSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$/)

export const pluginConfigFieldIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9_.-]*$/)

export const pluginConfigValueSchema = z.union([z.string(), z.number(), z.boolean()])

export const pluginConfigSchema = z.record(pluginConfigFieldIdSchema, pluginConfigValueSchema)

const pluginConfigOptionSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(160)
})

export const pluginConfigFieldSchema = z
  .object({
    id: pluginConfigFieldIdSchema,
    label: z.string().min(1).max(80),
    description: z.string().max(240).optional(),
    type: z.enum(['string', 'number', 'boolean', 'select']),
    default: pluginConfigValueSchema.optional(),
    options: z.array(pluginConfigOptionSchema).default([]),
    placeholder: z.string().max(120).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional()
  })
  .superRefine((field, context) => {
    if (field.default !== undefined) {
      const defaultType = typeof field.default
      const expectedType = field.type === 'select' ? 'string' : field.type
      if (defaultType !== expectedType) {
        context.addIssue({
          code: 'custom',
          message: `Default value for ${field.id} must be ${expectedType}`,
          path: ['default']
        })
      }
    }

    if (field.type === 'select') {
      if (field.options.length === 0) {
        context.addIssue({
          code: 'custom',
          message: `Select config field ${field.id} must define options`,
          path: ['options']
        })
      }

      if (typeof field.default === 'string' && !field.options.some((option) => option.value === field.default)) {
        context.addIssue({
          code: 'custom',
          message: `Default value for ${field.id} must match one of its options`,
          path: ['default']
        })
      }
    }

    if (field.type !== 'number' && (field.min !== undefined || field.max !== undefined || field.step !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: `Only number config fields can define min, max, or step`,
        path: ['type']
      })
    }

    if (field.type === 'number' && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      context.addIssue({
        code: 'custom',
        message: `Number config field ${field.id} has min greater than max`,
        path: ['min']
      })
    }
  })

export const pluginEntrypointSchema = z.object({
  entry: z.string().min(1).max(260)
})

export const pluginNodeContributionSchema = z.object({
  id: pluginNodeIdSchema,
  title: z.string().min(1).max(80),
  defaultFrame: frameSchema,
  permissions: z.array(pluginPermissionSchema).default([]),
  creatable: z.boolean().default(true)
})

export const atlasPluginManifestSchema = z
  .object({
    id: pluginIdSchema,
    name: z.string().min(1).max(80),
    version: z.string().min(1).max(40),
    atlasApiVersion: z.literal(ATLAS_PLUGIN_API_VERSION),
    description: z.string().max(400).optional(),
    renderer: pluginEntrypointSchema.optional(),
    native: pluginEntrypointSchema.optional(),
    permissions: z.array(pluginPermissionSchema).default([]),
    configuration: z.array(pluginConfigFieldSchema).default([]),
    nodes: z.array(pluginNodeContributionSchema).default([])
  })
  .superRefine((manifest, context) => {
    const nodeIds = new Set<string>()
    const configFieldIds = new Set<string>()

    for (const [index, node] of manifest.nodes.entries()) {
      if (!nodeIds.has(node.id)) {
        nodeIds.add(node.id)
        continue
      }

      context.addIssue({
        code: 'custom',
        message: `Duplicate plugin node id: ${node.id}`,
        path: ['nodes', index, 'id']
      })
    }

    for (const [index, field] of manifest.configuration.entries()) {
      if (!configFieldIds.has(field.id)) {
        configFieldIds.add(field.id)
        continue
      }

      context.addIssue({
        code: 'custom',
        message: `Duplicate plugin config field id: ${field.id}`,
        path: ['configuration', index, 'id']
      })
    }
  })

export const installedPluginRecordSchema = z.object({
  id: pluginIdSchema,
  sourcePath: z.string().min(1),
  enabled: z.boolean().default(false),
  config: pluginConfigSchema.default({}),
  installedAt: z.string(),
  updatedAt: z.string()
})

export const installedPluginsStateSchema = z.object({
  plugins: z.array(installedPluginRecordSchema).default([])
})

export const pluginSettingsSchema = z.object({
  rootPath: z.string().min(1)
})

export const pluginStatusSchema = z.enum(['disabled', 'enabled', 'running', 'error', 'missing'])

export const pluginDiagnosticEntrySchema = z.object({
  timestamp: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string()
})

export const pluginInfoSchema = installedPluginRecordSchema.extend({
  manifest: atlasPluginManifestSchema.nullable(),
  status: pluginStatusSchema,
  rendererEntryUrl: z.string().url().nullable().default(null),
  diagnostics: z.array(pluginDiagnosticEntrySchema).default([])
})

export type AtlasPluginManifest = z.infer<typeof atlasPluginManifestSchema>
export type PluginConfigField = z.infer<typeof pluginConfigFieldSchema>
export type PluginConfigValue = z.infer<typeof pluginConfigValueSchema>
export type PluginConfig = z.infer<typeof pluginConfigSchema>
export type InstalledPluginRecord = z.infer<typeof installedPluginRecordSchema>
export type InstalledPluginsState = z.infer<typeof installedPluginsStateSchema>
export type PluginSettings = z.infer<typeof pluginSettingsSchema>
export type PluginStatus = z.infer<typeof pluginStatusSchema>
export type PluginDiagnosticEntry = z.infer<typeof pluginDiagnosticEntrySchema>
export type PluginInfo = z.infer<typeof pluginInfoSchema>

export function pluginComponentType(pluginId: string, nodeId: string): string {
  return `plugin:${pluginId}/${nodeId}`
}

function encodePluginPath(path: string): string {
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export function pluginRendererModuleUrl(pluginId: string, relativePath: string): string {
  return `${ATLAS_PLUGIN_RENDERER_PROTOCOL}://${pluginId}/${encodePluginPath(relativePath)}`
}

export function parsePluginRendererModuleUrl(url: string): { pluginId: string; relativePath: string } {
  const parsed = new URL(url)

  if (parsed.protocol !== `${ATLAS_PLUGIN_RENDERER_PROTOCOL}:`) {
    throw new Error('Invalid plugin renderer URL')
  }

  const pluginId = pluginIdSchema.parse(parsed.hostname)
  const relativePath = parsed.pathname
    .slice(1)
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join('/')

  if (!relativePath) throw new Error('Plugin renderer URL is missing an entry path')

  return { pluginId, relativePath }
}
