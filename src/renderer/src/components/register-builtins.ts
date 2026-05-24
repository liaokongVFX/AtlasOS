import { createBuiltInSystemPlugin } from './builtins'
import { registerSystemRendererPlugin } from '../plugins/system-runtime'

let builtInDefinitionsRegistered = false

export function registerBuiltInComponentDefinitions(): void {
  if (builtInDefinitionsRegistered) return

  registerSystemRendererPlugin(createBuiltInSystemPlugin())
  builtInDefinitionsRegistered = true
}
