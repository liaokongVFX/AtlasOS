# Repository Guidance

## Visual Style

- Follow the dark style system documented in `D:\projects\AtlasOS\docs\DESIGN.md` for all renderer UI.
- Treat `#010102` / `--color-canvas` as the anchor background. Do not replace it with true black or a light-mode surface.
- Use the surface ladder (`--color-surface-1` through `--color-surface-4`) plus 1px hairline borders for hierarchy instead of atmospheric gradients or broad drop shadows.
- Use lavender-blue (`--color-primary`, `--color-primary-hover`, `--color-primary-focus`) sparingly for primary actions, focus states, selected states, and link emphasis.
- Avoid introducing another chromatic accent for normal UI. Semantic danger/success colors should be rare and tied to actual destructive, error, or status states.
- Prefer 8px button/input radii, 12px cards/panels, and 16px product or media frames. Avoid pill-shaped CTAs unless the component is specifically a tab/status pill.
- Keep typography close to the documented Linear-like system: Inter / SF Pro style sans for UI, JetBrains Mono / SF Mono for terminal and code contexts, with restrained weights.
- When adding editor or syntax-highlighted surfaces, keep colors within the same dark palette and lavender accent family rather than importing a separate theme palette.
