# VertexADE interaction system

The shared UI package owns interaction shape and density. Product screens compose these primitives; they should not recreate their visual rules with local height, padding, border, or hover classes.

## Actions

Use `Button` for labelled actions and `IconButton` for icon-only actions.

- `default`: the primary action in a region. Prefer one per card, dialog footer, or page header.
- `outline`: a normal secondary action.
- `secondary`: a selected toggle or emphasized alternative.
- `ghost`: low-priority, reversible, or overflow-adjacent actions.
- `destructive`: actions with destructive impact.
- `link`: inline navigation inside prose.

Sizes are responsive and include mobile touch targets. Choose `default`, `xs`, `sm`, or `lg`; do not add `h-*`, `min-h-*`, or `size-*` to a button. Icon-only actions use `IconButton` with a required `label`.

Use `loading` and `loadingText` instead of manually swapping icons, labels, disabled state, and spinners.

## Surfaces

Use `Card` for bounded content and choose a deliberate surface:

- `default`: normal grouped content.
- `subtle`: supporting or nested content.
- `elevated`: content that needs stronger visual separation.

Card spacing comes from `size`. Use `CardHeader`, `CardContent`, `CardAction`, and `CardFooter` rather than applying independent padding to every screen.

Use `layout="divided"` for settings panels and other cards with a bordered header and flush internal regions. It owns the zero-gap outer layout, header divider, and shared content padding.

## Lists

Use `List` and `ListItem` for repeated rows. `ListItem` owns row spacing, separators, hover, and focus behavior. Compose it with:

- `ListItemMedia`
- `ListItemContent`
- `ListItemTitle`
- `ListItemDescription`
- `ListItemMeta`
- `ListItemAction`

Set `interactive` only when the complete row is actionable. Use `asChild` for links so semantics and keyboard behavior remain native.

## Page structure and states

Page headings use `PageHeader`, `PageHeaderContent`, `PageEyebrow`, `PageTitle`, `PageDescription`, and `PageActions`. Summary metrics use `StatGrid` and `Stat`.

Top-level routes use `WorkspacePage`. It is fluid across the full application shell, with responsive gutters instead of a page-level maximum width. Keep readability limits on prose, conversations, editors, or other local content that benefits from shorter line lengths; do not constrain the whole workspace.

Use the shared `Empty` family for empty and initial-loading regions. Keep the same region dimensions while content changes to avoid layout jumps.

## Toolbars and filters

Use `Toolbar` for a bounded group of search, filtering, sorting, and view controls. `ToolbarGroup` owns horizontal overflow, `ToolbarLabel` names a control group, and `FilterChip` owns selected state, counts, sizing, and `aria-pressed`. Use the `sticky` option instead of recreating sticky backgrounds and blur behavior.

Use `SearchInput` for text filtering. It owns search semantics, icon placement, responsive touch sizing, input padding, accessible naming, and an optional clear action. Use `density="compact"` inside dense toolbars.

Use `FilterBar`, `FilterBarToggle`, and `FilterBarControls` when filters collapse behind a counted mobile toggle. The bar owns the two-column mobile shell, desktop flow, active-count badge, visibility state, and toolbar accessibility.

## View and state navigation

Use `SegmentedControl` and `SegmentedControlItem` for mutually exclusive view or mode switches. Each item exposes `aria-pressed` and shares selected, hover, focus, spacing, and grouping treatments.

Use the `StateNav` family for richer lifecycle navigation with icons, titles, counts, or descriptions. It owns horizontal overflow, snap behavior, active-page semantics, focus treatment, and compact mobile sizing.

## Status and details

Use `Status` for compact state labels with the semantic tones `neutral`, `info`, `success`, `warning`, and `danger`. Use `StatusPanel` with `StatusPanelContent`, `StatusPanelTitle`, `StatusPanelDescription`, and `StatusPanelActions` for explanatory operational messages. The compound layout keeps actions visible and moves them to a full-width second row on narrow screens. Product screens should map domain states to these tones rather than copying color class sets.

Use `DetailGrid`, `Detail`, `DetailLabel`, and `DetailValue` for read-only label/value metadata. This preserves definition-list semantics and shared density across sidebars, dialogs, and operational cards.

## Tables

Use `TableContainer`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, and `TableCell` for dense, column-aligned data. The container owns horizontal overflow, while the table primitives provide native table semantics, shared density, separators, hover feedback, and selected-row styling.

Use `TableCaption` when the table needs an accessible description. Prefer a `List` when each item has different content or actions and does not benefit from column alignment.

## Sections and action bars

Use `SectionHeader`, `SectionHeaderContent`, `SectionTitle`, `SectionDescription`, and `SectionActions` for headings inside cards, panels, and page sections. The actions stack safely on narrow screens without route-specific layout classes.

Use `ActionBar` for related form or dialog actions. Choose `start`, `between`, or `end` alignment; actions become full-width on mobile and return to intrinsic width on larger screens.

## Forms and choices

Use `FieldGroup`, `Field`, `FieldLabel`, `FieldDescription`, and `FieldError` to associate controls with consistent labels, help text, and validation feedback. Connect labels to controls with `htmlFor` and `id`; reserve `FieldError` for actionable validation failures.

Use `ChoiceList` and the `ChoiceItem` family for checkbox or radio collections with rich labels, descriptions, and trailing metadata. Set `scrollable` for bounded discovery results instead of recreating borders, dividers, hover states, and scrolling in each extension.

## Review checklist

- One clear primary action per region.
- No local action height or padding overrides.
- Icon-only actions have accessible labels.
- Loading actions retain context and cannot be submitted twice.
- Repeated rows use list primitives, not bespoke borders and padding.
- Cards use a declared surface and shared internal spacing.
- Filters use `Toolbar` and `FilterChip`; status colors come from `Status`.
- Search, collapsed filters, view switches, and operational feedback use the shared interaction primitives.
- Read-only metadata uses detail primitives rather than ad hoc grids.
- Column-aligned data uses semantic table primitives with overflow handled by `TableContainer`.
- Section headings and grouped form actions use the shared responsive composition primitives.
- Forms use field primitives with explicit label associations; rich checkbox and radio collections use choice-list primitives.
- Mobile action targets come from the component size, not route-specific media classes.
