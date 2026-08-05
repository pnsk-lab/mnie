---
name: build-better-ui
description: Create, revise, or review polished product interfaces with a distinctive pink-led design system, compact information architecture, light and dark themes, responsive layouts, accessible contrast, and Material 3 Expressive motion. Use for UI implementation, component design, page layout, data-dense dashboards, visual polish, or frontend design reviews.
---

# Build Better UI

## Apply the system

1. Read [references/design-system.md](references/design-system.md) before making visual decisions.
2. Inspect the existing product and preserve useful interaction patterns, framework conventions, and user expectations.
3. Identify the screen's single primary purpose, required information, primary action, and exceptional states.
4. Build with the design tokens and component rules. Adapt the composition to the content instead of reproducing a reference layout.
5. Remove every element that does not improve understanding or action.

## Enforce content discipline

- Omit UI explanations, state explanations, screen descriptions, and obvious guidance.
- Remove duplicated content and controls aggressively.
- Use concise, natural labels. Do not add awkward English translations.
- Reveal secondary actions only where they become relevant.
- Use real product language and realistic data. Do not invent marketing copy to fill space.

## Preserve craft

- Use one font family and Lucide Icons only.
- Use semantic design tokens; do not scatter arbitrary color, spacing, radius, or shadow values.
- Support light and dark modes for every surface, control, chart, and interaction state.
- Follow Material 3 Expressive motion principles for meaningful state changes.
- Avoid generic AI-generated visual patterns: gradients, glass panels, excessive pills, oversized titles, decorative blobs, uniform card grids, and filler copy.

## Verify

- Test responsive layouts at narrow, medium, and wide widths.
- Test keyboard navigation, visible focus, reduced motion, overflow, and empty or long content.
- Confirm WCAG AA contrast in both themes, including hover, focus, disabled, and selected states.
- Confirm that density, alignment, typography, icon sizing, and motion remain consistent across the full screen.
