# Pink Product Interface System

Use this system as a visual grammar, not a page template. Create layouts from product needs and never reproduce the supplied references.

## Contents

- [Character](#character)
- [Color](#color)
- [Typography](#typography)
- [Spacing and geometry](#spacing-and-geometry)
- [Elevation and surfaces](#elevation-and-surfaces)
- [Layout](#layout)
- [Components](#components)
- [Data visualization](#data-visualization)
- [Motion](#motion)
- [Responsive behavior](#responsive-behavior)
- [Accessibility](#accessibility)
- [Anti-patterns](#anti-patterns)

## Character

- Build a quiet, precise product surface with compact controls, strong alignment, and deliberate negative space.
- Create hierarchy with type, spacing, surface tone, and thin dividers before adding containers.
- Keep high-density regions compact and low-density regions open. Do not force both into the same card rhythm.
- Use pink as the recognizable action and selection signature. Do not tint the entire product pink.
- Prefer asymmetric, content-led compositions over generic centered sections and equal card grids.
- Let real data, labels, and controls provide visual interest. Avoid decorative illustration unless the product requires it.

## Color

Define semantic variables once and map them to Tailwind utilities through `@theme` or the project's theme layer. Never use raw hex values inside components.

### Brand scale

| Token      | Value     | Use                    |
| ---------- | --------- | ---------------------- |
| `pink-50`  | `#FFF1F7` | Light selected surface |
| `pink-100` | `#FFE3EF` | Light hover surface    |
| `pink-200` | `#FFC6DC` | Soft accent border     |
| `pink-300` | `#FF9CC4` | Dark-mode muted accent |
| `pink-400` | `#FA6CA8` | Dark-mode primary      |
| `pink-500` | `#EA3F8B` | Brand signature        |
| `pink-600` | `#CB256F` | Light-mode primary     |
| `pink-700` | `#A91D5B` | Light pressed state    |
| `pink-800` | `#851A4A` | Strong text accent     |
| `pink-900` | `#6E183F` | Deep accent            |
| `pink-950` | `#430720` | Dark accent foreground |

### Semantic roles

| Role             | Light      | Dark                                            |
| ---------------- | ---------- | ----------------------------------------------- |
| `canvas`         | `#FAFAFB`  | `#0B0B0F`                                       |
| `surface`        | `#FFFFFF`  | `#111218`                                       |
| `surface-raised` | `#FFFFFF`  | `#171820`                                       |
| `surface-sunken` | `#F3F3F6`  | `#08090C`                                       |
| `border`         | `#DDDDE4`  | `#292A33`                                       |
| `border-subtle`  | `#EBEBEF`  | `#1D1E25`                                       |
| `text`           | `#17171C`  | `#F4F4F6`                                       |
| `text-muted`     | `#666670`  | `#A5A5AF`                                       |
| `text-faint`     | `#85858F`  | `#777782`                                       |
| `primary`        | `pink-600` | `pink-400`                                      |
| `primary-hover`  | `pink-700` | `pink-300`                                      |
| `primary-soft`   | `pink-50`  | `color-mix(in srgb, pink-400 14%, transparent)` |
| `on-primary`     | `#FFFFFF`  | `pink-950`                                      |
| `success`        | `#167A4B`  | `#59D991`                                       |
| `danger`         | `#B42342`  | `#FF8298`                                       |
| `warning`        | `#946200`  | `#F1C75B`                                       |

- Reserve primary pink for primary actions, active navigation, focus, selection, and the product's principal data series.
- Use neutral surfaces for at least 80% of the visible area.
- Keep semantic success, danger, and warning colors distinct from pink.
- Meet a contrast ratio of at least 4.5:1 for normal text and 3:1 for large text, icons, controls, and focus indicators.

## Typography

- Use `Geist`, falling back to `Noto Sans JP`, `Inter`, then `ui-sans-serif`, as one family across the interface.
- Use weights 400, 500, and 600 only. Avoid artificial weight variety.
- Use tabular numerals for metrics, prices, timestamps, tables, and charts.
- Keep headings compact and sentence-cased. Do not use oversized display type inside product screens.

| Role            | Size / line height | Weight       |
| --------------- | ------------------ | ------------ |
| Page title      | `24 / 30`          | 600          |
| Section title   | `18 / 24`          | 600          |
| Component title | `14 / 20`          | 600          |
| Body            | `14 / 20`          | 400          |
| Control         | `13 / 18`          | 500          |
| Supporting      | `12 / 17`          | 400          |
| Metric          | `28 / 32`          | 600, tabular |

## Spacing and geometry

- Use a 4px base grid and the scale `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
- Use `12–16px` internal padding for dense components and `20–24px` for page sections.
- Use a maximum of three radii: `6px` for small controls, `10px` for standard surfaces, and `14px` for prominent containers.
- Use full pills only for switches, compact filters, status chips, and avatar controls.
- Keep control heights consistent: `32px` compact, `40px` default, and `48px` touch-prominent.
- Align text and numeric columns to a shared grid. Right-align comparable numbers.

## Elevation and surfaces

- Separate regions with a one-pixel border or a small tone shift.
- Use shadows only for floating menus, dialogs, and dragged objects.
- Avoid stacking bordered cards inside bordered cards.
- Treat cards as grouped interactive units, not as the default wrapper for every section.
- Keep the main canvas visually continuous; use section spacing and dividers for long reading flows.

## Layout

- Use an application shell only when persistent navigation is necessary.
- Keep desktop navigation between `224px` and `256px`; use a `52–56px` top bar when global actions require it.
- Keep primary content fluid with a readable maximum width determined by the task: `760px` for forms, `1120px` for mixed content, and `1440px` for data workspaces.
- Place global navigation at the edge, local navigation near the content, and contextual actions beside the object they affect.
- Use one dominant region and one supporting region. Avoid grids where every panel has equal visual weight.
- Center an empty-state action only when the entire workspace is genuinely empty. Otherwise anchor it to the relevant section.

## Components

### Buttons

- Use one filled pink primary button per decision region.
- Use neutral secondary buttons and low-chrome tertiary actions.
- Pair icons with labels unless the icon is universally understood and has an accessible name.
- Keep destructive actions red and visually separate from the primary pink action.

### Navigation

- Mark the active destination with a soft neutral or pink-tinted surface plus strong text.
- Keep inactive destinations quiet; reveal secondary navigation only when needed.
- Use a moving underline or shared selection surface for tabs instead of recoloring every element.

### Inputs

- Use persistent labels when the value could be ambiguous. Never use placeholders as the only label.
- Use a neutral border at rest, a pink focus ring, and local error feedback.
- Keep search visually compact until it becomes the screen's main task.

### Tables and lists

- Prefer rows and separators over individual cards for repeated comparable items.
- Keep row height between `36px` and `48px` according to density.
- Freeze headers only when scrolling would remove essential context.
- Make selection visible with both surface change and an indicator; do not rely on pink text alone.

### Icons

- Use Lucide Icons exclusively at `16px`, `18px`, or `20px` with consistent `1.75` stroke weight.
- Keep decorative icons out of headings and metric cards.
- Use filled icons only when the selected state requires stronger differentiation.

### Feedback

- Place validation and failure feedback beside the action or field that caused it.
- Use short corrective text without explaining the interface or narrating state.
- Use skeletons only when the layout is known; use a compact progress indicator for indeterminate work.

## Data visualization

- Use pink for the principal series, neutral gray for reference lines, and semantic green or red only when direction has meaning.
- Use direct labels where space permits; avoid legends that force repeated eye travel.
- Keep grid lines subtle but visible in both themes.
- Use a small endpoint marker and current-value label instead of decorative glow.
- Use tabular numerals and consistent precision across related metrics.
- Preserve chart aspect and readable labels on narrow screens; allow horizontal scrolling only for irreducibly dense timelines.
- Never communicate series or gain/loss using color alone; add labels, shape, or icon direction.

## Motion

- Follow Material 3 Expressive: use spring-based spatial motion for prominent navigation or selection and restrained effects for repeated utility actions.
- Animate tab indicators, segmented selections, switches, expandable regions, and shared selection surfaces.
- Preserve spatial continuity; move or reshape the selected element instead of fading unrelated replacements.
- Keep utility transitions near `120–180ms` and larger spatial transitions near `220–360ms`.
- Animate transform, opacity, color, and clip where possible; avoid layout-janking properties.
- Avoid bounce on every control. Reserve expressive overshoot for a small number of high-value moments.
- Respect `prefers-reduced-motion` by removing travel and overshoot while retaining immediate state feedback.

## Responsive behavior

- Recompose rather than uniformly shrink.
- Collapse persistent navigation into a drawer or compact rail at medium widths.
- Use a single content column on narrow screens and keep the primary action reachable.
- Turn dense comparison grids into horizontal snap rows or prioritized lists only when comparison remains understandable.
- Preserve information hierarchy and task order across breakpoints.
- Avoid hiding required data or controls behind unexplained icons.

## Accessibility

- Support keyboard operation and visible focus for every interactive element.
- Use a two-pixel pink focus ring with sufficient contrast against both the control and its surroundings.
- Maintain comfortable hit areas without making every visual control oversized.
- Expose names, roles, values, and errors to assistive technology.
- Test 200% zoom, long localized labels, high contrast, dark mode, and reduced motion.

## Anti-patterns

- Do not use gradients, glassmorphism, glow, grain overlays, or decorative blobs.
- Do not place every section in a rounded card.
- Do not use pills for ordinary buttons, inputs, or navigation rows.
- Do not center all content or default to a hero layout inside an application.
- Do not pair an oversized heading with generic explanatory copy.
- Do not repeat the same icon-title-description-card pattern.
- Do not add trend badges, charts, avatars, or activity feeds unless the product data requires them.
- Do not copy the composition, branding, or component proportions of a reference product.
