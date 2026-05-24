# AtlasOS Plugin SDK

This package contains the public renderer plugin types and small identity helpers used by AtlasOS trusted local plugins.

Runtime values are passed by AtlasOS through `registerPlugin(api)`. Plugins should use `api.React`, `api.icons`, `api.plugin.config`, `api.sdk`, and `api.registerNode` instead of importing AtlasOS internals.

For local development inside this repository:

```json
{
  "devDependencies": {
    "@atlasos/plugin-sdk": "file:../../../sdk/atlasos-plugin-sdk"
  }
}
```

Bundle plugin renderer entries into standalone ESM before installing the plugin directory in AtlasOS. The bundled file should export `registerPlugin(api)` or default-export the register function.

Declare plugin-wide settings in `atlas-plugin.json` with `configuration`. AtlasOS renders those fields in Settings and passes the saved primitive values to renderer code as `api.plugin.config`.
