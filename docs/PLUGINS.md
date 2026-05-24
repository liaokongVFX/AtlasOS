# AtlasOS Plugin Development

AtlasOS plugins are trusted local folders. A plugin can contribute canvas node types through a renderer module, and can optionally run native work in an isolated Electron `utilityProcess`.

The current plugin API version is `1`.

## Architecture

```
plugin-folder/
  atlas-plugin.json
  dist/
    renderer.js
  native/
    main.js
```

AtlasOS loads plugins in three steps:

1. The main process scans the configured plugin root, validates `atlas-plugin.json`, and persists a local folder reference.
2. When the plugin is enabled, AtlasOS exposes the renderer entry through `atlas-plugin://<plugin-id>/<entry>`.
3. The renderer dynamic-imports that module and calls `registerPlugin(api)`. The plugin registers nodes with `api.registerNode(...)`.

Plugin component data is saved inside normal canvas documents. If a plugin is disabled, missing, or fails to load, AtlasOS keeps the node data and shows a missing-plugin placeholder.

## Quick Start

Use the calculator example as the shortest working reference:

```text
examples/plugins/calculator
```

In AtlasOS:

1. Open `Settings` from the top bar or the AtlasOS tray menu.
2. Set `Plugin root` to the folder that will contain local plugin folders.
3. Select `Plugins` in the settings sidebar.
4. Copy `examples/plugins/calculator` into that root, then choose `Scan`.
5. Select `Calculator` and enable it.
6. Double-click the canvas and create a `Calculator` node.

You can still use `Add folder` for a plugin that lives outside the configured root.

## Manifest

Every plugin folder must contain `atlas-plugin.json`.

```json
{
  "id": "acme.calculator",
  "name": "Calculator",
  "version": "1.0.0",
  "atlasApiVersion": 1,
  "description": "A compact calculator node.",
  "renderer": {
    "entry": "dist/renderer.js"
  },
  "permissions": [],
  "configuration": [
    {
      "id": "precision",
      "label": "Display precision",
      "description": "Significant digits used when formatting calculated results.",
      "type": "number",
      "default": 12,
      "min": 4,
      "max": 16,
      "step": 1
    }
  ],
  "nodes": [
    {
      "id": "calculator",
      "title": "Calculator",
      "defaultFrame": {
        "x": 160,
        "y": 160,
        "width": 320,
        "height": 430
      },
      "permissions": [],
      "creatable": true
    }
  ]
}
```

Rules:

- `id` must be stable, lowercase, and globally unique, for example `acme.calculator`.
- Node ids must be unique inside the plugin and use lowercase kebab case.
- Entrypoints must be relative paths inside the plugin folder.
- `renderer.entry` should point to bundled standalone ESM.
- `native.entry` is optional and should be used only when renderer code needs OS or long-running work.
- Permissions are descriptive today and should still be declared precisely. Use strings like `native:filesystem` or `native:network`.
- `configuration` is optional and describes host-rendered plugin settings.

Runtime component type is namespaced by AtlasOS:

```text
plugin:<plugin-id>/<node-id>
```

For the example above:

```text
plugin:acme.calculator/calculator
```

## Renderer Contract

Renderer modules must export `registerPlugin(api)` or default-export the same function.

```js
export function registerPlugin(api) {
  const { React } = api
  const h = React.createElement

  function MyNode({ component, updateState }) {
    return h('div', null, component.title)
  }

  api.registerNode(
    api.sdk.defineNode({
      id: 'my-node',
      Renderer: MyNode
    })
  )
}
```

Use the host-provided API instead of importing app internals:

- `api.React` is the host React runtime.
- `api.icons` exposes approved host icons.
- `api.sdk` exposes small helpers such as `defineNode`, `readState`, `readConfig`, and `readBindings`.
- `api.plugin.config` contains the plugin settings saved in AtlasOS Settings.
- `api.invoke(command, input)` calls the plugin native runtime when one exists.
- `api.registerNode(definition)` registers one node declared by the manifest.

Renderer modules should avoid side effects outside `registerPlugin(api)`.

## SDK Package

AtlasOS includes a local SDK package for plugin projects:

```text
sdk/atlasos-plugin-sdk
```

Use it as a dev dependency for TypeScript types and small authoring helpers:

```json
{
  "devDependencies": {
    "@atlasos/plugin-sdk": "file:../../../sdk/atlasos-plugin-sdk"
  }
}
```

Recommended TypeScript shape:

```ts
import type { AtlasPluginNodeProps, AtlasRendererPluginApi } from '@atlasos/plugin-sdk'
import { defineNode, definePlugin, readState } from '@atlasos/plugin-sdk'

type CounterState = {
  count: number
}

const DEFAULT_STATE: CounterState = {
  count: 0
}

export const registerPlugin = definePlugin((api: AtlasRendererPluginApi) => {
  const { React } = api
  const h = React.createElement

  function CounterNode({ component, updateState }: AtlasPluginNodeProps<{}, CounterState>) {
    const state = readState(component, DEFAULT_STATE)
    return h('button', { onClick: () => updateState({ count: state.count + 1 }) }, state.count)
  }

  api.registerNode(
    defineNode<{}, CounterState>({
      id: 'counter',
      create: () => ({ state: DEFAULT_STATE }),
      getSearchTokens: () => ['counter'],
      Renderer: CounterNode
    })
  )
})
```

Bundle this source into standalone ESM before installing the plugin. The final renderer entry may bundle SDK helpers, but should not bundle React; use `api.React`.

## Node Definition

`api.registerNode` accepts:

- `id`: must match a manifest node id.
- `title`: optional override for the manifest title.
- `defaultFrame`: optional override for the manifest frame.
- `permissions`: optional extra permissions merged with manifest permissions.
- `creatable`: optional override for whether the node appears in the create menu.
- `icon`: optional icon from `api.icons`.
- `Renderer`: React component rendered inside the node body.
- `create`: optional initial component patch.
- `duplicate`: optional patch when duplicating a node.
- `getSearchTokens`: optional tokens for node finder.
- `getDetail`: optional detail line for node finder.
- `getSubtitle`: optional small subtitle in the node header.

Keep `create` deterministic. Do not generate external resources from it unless the user explicitly asked for that node action.

## Component Data

Each node has:

- `config`: durable user preferences or node settings.
- `state`: durable interaction state.
- `bindings`: references to local paths or external resources.

Best practice:

- Store only JSON-serializable values.
- Keep large content in files and store a path in `bindings`.
- Use `api.sdk.readState(component, defaults)` and related helpers to tolerate old documents.
- Treat unknown keys as forward-compatible data.
- Avoid storing secrets in canvas data.

## Plugin Configuration

Use manifest `configuration` for plugin-wide settings. AtlasOS renders these fields in the plugin detail view and stores the values outside canvas documents.

Supported field types:

- `string`: text input.
- `number`: number input with optional `min`, `max`, and `step`.
- `boolean`: checkbox.
- `select`: menu backed by `options`.

Example:

```json
{
  "configuration": [
    {
      "id": "model",
      "label": "Model",
      "type": "select",
      "default": "small",
      "options": [
        { "label": "Small", "value": "small" },
        { "label": "Large", "value": "large" }
      ]
    }
  ]
}
```

Renderer plugins read settings from `api.plugin.config`:

```ts
const model = typeof api.plugin.config.model === 'string' ? api.plugin.config.model : 'small'
```

Best practice:

- Use plugin configuration for global plugin behavior.
- Use node `config` for per-node preferences.
- Use node `state` for interaction state.
- Keep configuration values primitive: string, number, or boolean.
- Never store secrets in plugin configuration.

## Styling

Plugins render inside AtlasOS dark node chrome. Match the existing design system:

- Use `var(--color-canvas)` as the deepest background.
- Use `var(--color-surface-1)` through `var(--color-surface-4)` for hierarchy.
- Use 1px `var(--color-hairline)` borders.
- Use `var(--color-primary)` and `var(--color-primary-hover)` only for selected or primary actions.
- Prefer 8px control radius and 12px panels.
- Do not add gradients, broad shadows, or a second accent palette.

Inline styles are acceptable for simple plugins. Larger plugins can ship CSS from their renderer bundle, but should still rely on AtlasOS CSS variables.

## Native Runtime

Use a native runtime when renderer code needs OS access, expensive work, or long-running background tasks. Declare it in the manifest:

```json
{
  "native": {
    "entry": "native/main.js"
  },
  "permissions": ["native:example"]
}
```

AtlasOS starts the native entry with `utilityProcess.fork(...)` when the plugin is enabled or first invoked. The native process receives:

```js
{
  type: 'atlas:init',
  pluginId,
  manifest,
  config,
  sourcePath
}
```

Renderer code calls:

```js
await api.invoke('command-name', { value: 1 })
```

The native process receives:

```js
{
  type: 'atlas:invoke',
  requestId,
  command,
  input
}
```

It should reply:

```js
process.parentPort.postMessage({
  type: 'atlas:invoke-result',
  requestId,
  ok: true,
  result: { done: true }
})
```

For failures:

```js
process.parentPort.postMessage({
  type: 'atlas:invoke-result',
  requestId,
  ok: false,
  error: 'Human-readable error'
})
```

Diagnostics can be sent with:

```js
process.parentPort.postMessage({
  type: 'atlas:log',
  level: 'info',
  message: 'Started'
})
```

## Build Checklist

Before distributing a plugin folder:

- `atlas-plugin.json` parses and every entrypoint exists.
- Renderer entry is standalone ESM.
- Every registered node id is declared in the manifest.
- Node frames have sensible defaults for 1100px wide windows and smaller.
- Renderer UI uses AtlasOS CSS variables.
- State, config, and bindings are backward-compatible.
- Plugin-wide configuration fields have stable ids and safe defaults.
- Native commands validate input and return structured errors.
- Reloading the plugin does not lose existing node data.

## Calculator Example Notes

The calculator example demonstrates:

- Renderer-only plugin installation.
- A manifest-declared creatable node.
- Host React usage through `api.React`.
- Host icon usage through `api.icons.Calculator`.
- Host-rendered plugin settings through `configuration` and `api.plugin.config`.
- Persistent state through `component.state` and `updateState`.
- Node finder integration through `getSearchTokens` and `getDetail`.
- Selected-node keyboard input that avoids hijacking dialogs, text fields, and host shortcuts.

Use it as the baseline for new simple node plugins.
