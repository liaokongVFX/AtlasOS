# Calculator Plugin

This is a renderer-only AtlasOS plugin that contributes one canvas node:

- Plugin id: `atlas.calculator`
- Node id: `calculator`
- Component type at runtime: `plugin:atlas.calculator/calculator`
- Plugin setting: `precision`

The plugin is intentionally self-contained. `dist/renderer.js` can be installed directly without building.

## Try It

1. Open AtlasOS.
2. Open `Settings` from the top bar or tray menu.
3. Select `Plugins` in the settings sidebar.
4. Copy this folder into the configured plugin root and choose `Scan`, or choose `Add folder` and select `examples/plugins/calculator`.
5. Enable `Calculator`.
6. Adjust `Display precision` in the plugin detail view if needed.
7. Double-click the canvas and choose `Calculator`.
8. Select the calculator node to use keyboard input without clicking the keypad first: digits, `.`, operators, `Enter` or `=`, `Backspace`, and `C`.

## Source Layout

- `atlas-plugin.json` declares the plugin id, API version, renderer entry, plugin setting, and node contribution.
- `dist/renderer.js` is the standalone ESM file loaded by AtlasOS.
- `src/renderer.ts` shows the recommended TypeScript authoring shape using `@atlasos/plugin-sdk`.

## Development

The checked-in `dist/renderer.js` is already runnable. To rebuild from TypeScript in a plugin project, install dependencies and run:

```powershell
npm install
npm run build
```

Renderer entries should be bundled to standalone ESM and should not import AtlasOS application internals at runtime. Use the `api` object passed to `registerPlugin(api)`.
