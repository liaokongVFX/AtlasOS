# Repository Guidance

## Engineering Practice

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them rather than picking silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop, name what is confusing, and ask.

### Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- Do not build features beyond what was asked.
- Do not add abstractions for single-use code.
- Do not add flexibility or configurability that was not requested.
- Do not add error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical Changes

**Touch only what is required. Clean up only your own mess.**

When editing existing code:
- Do not improve adjacent code, comments, or formatting.
- Do not refactor things that are not broken.
- Match existing style, even when you would choose a different style.
- If you notice unrelated dead code, mention it rather than deleting it.

When your changes create orphans:
- Remove imports, variables, and functions that your changes made unused.
- Do not remove pre-existing dead code unless asked.

Every changed line should trace directly to the user's request.

### Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" becomes "Write tests for invalid inputs, then make them pass."
- "Fix the bug" becomes "Write a test that reproduces it, then make it pass."
- "Refactor X" becomes "Ensure tests pass before and after."

For multi-step tasks, state a brief plan:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let agents loop independently. Weak criteria, such as "make it work", require clarification.

## Visual Style

- Follow the dark style system documented in `D:\projects\AtlasOS\docs\DESIGN.md` for all renderer UI.
- Treat `#010102` / `--color-canvas` as the anchor background. Do not replace it with true black or a light-mode surface.
- Use the surface ladder (`--color-surface-1` through `--color-surface-4`) plus 1px hairline borders for hierarchy instead of atmospheric gradients or broad drop shadows.
- Use lavender-blue (`--color-primary`, `--color-primary-hover`, `--color-primary-focus`) sparingly for primary actions, focus states, selected states, and link emphasis.
- Avoid introducing another chromatic accent for normal UI. Semantic danger/success colors should be rare and tied to actual destructive, error, or status states.
- Prefer 8px button/input radii, 12px cards/panels, and 16px product or media frames. Avoid pill-shaped CTAs unless the component is specifically a tab/status pill.
- Keep typography close to the documented Linear-like system: Inter / SF Pro style sans for UI, JetBrains Mono / SF Mono for terminal and code contexts, with restrained weights.
- When adding editor or syntax-highlighted surfaces, keep colors within the same dark palette and lavender accent family rather than importing a separate theme palette.
