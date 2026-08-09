# VertexADE product UI direction

This directory contains the image-generated north stars for the product-wide UI
reinvention. They are design references, not screenshots to embed in the
application.

## Audited surface

The baseline visual audit covered 25 distinct pages at 1440×1000 and 390×844:

- Focus, Work, Agents, Pull requests, Delivery, Automations, Inbox, Extensions,
  System health, and Settings.
- Work, agent-session, and pull-request detail pages.
- ACP, Airtable, Azure DevOps, Claude Code, CodeRabbit, Codex, Container
  previews, GitHub, Linear, OpenCode, Sentry, and SonarQube extension pages.

The initial 50-route/view matrix had no rendering, response, console, or
horizontal-overflow failures. Visual inspection identified recurring product
issues:

- Wide screens hide destination labels in an icon-only rail, weakening
  discoverability and location awareness.
- Bright blue is used for selection, links, icons, and primary actions, so
  hierarchy is often color-driven instead of structural.
- Nested rounded cards and toolbars make unrelated surfaces feel the same and
  add framing without adding meaning.
- Loading, disabled, and non-portable extension states use oversized empty
  containers with little useful next-step context.
- Mobile pages often stack modes, metrics, search, filters, and state tabs
  before showing the first useful item.
- Dense agent and review content needs clearer internal rhythm and metadata
  grouping.

## Product principles

1. **One graphite canvas, explicit panes.** Use separators and background steps
   before adding another card.
2. **Structure before color.** Typography, alignment, and spacing establish
   hierarchy. Color communicates state or selection.
3. **Compact, not cramped.** A 4px/8px rhythm, 6–8px radii, concise metadata,
   and predictable row heights keep engineering data scannable.
4. **Persistent orientation.** Wide layouts show labeled navigation. Compact
   desktop can collapse it. Mobile keeps a stable app bar and five-item dock.
5. **Operational states are useful states.** Loading, disabled, empty, and
   degraded surfaces explain what is happening and provide the next action.
6. **Details on demand.** Mobile prioritizes the first useful item and moves
   secondary filters and metadata behind deliberate controls.

## Reference synthesis

VertexADE uses the named references as interaction principles rather than a
collection of copied visual styles:

- **Linear:** sparse hierarchy, keyboard-first navigation, durable views, and
  dense lists that remain calm.
- **Slack:** persistent orientation, contextual side rails, and conversations
  that keep related activity together.
- **Todoist:** one ordered Today queue, explicit priority, and quick completion
  without losing history.
- **Codex and T3 Code:** operational agent sessions with compact tool activity,
  visible model and repository context, and a composer anchored to the work.
- **CodeRabbit and Greptile:** evidence-led code review, explicit review/check/
  merge state, and one recommended next action.

Top-level workspace headers are text-first for consistent scanning. Icons are
reserved for entity identity, state, and actions where they add information.

The resulting product model is original to VertexADE: Focus ranks attention,
Work owns outcomes, Agents owns execution, Pull requests owns review, and the
operational pages provide delivery, automation, integration, and runtime truth.

## Visual language

- Near-black graphite canvas with two restrained neutral elevation steps.
- Cool-gray hairline borders; almost no shadows.
- Violet selection and primary action accents, with blue reserved for links and
  information.
- Mint for success, amber for attention, and coral for failure.
- Geist for interface text and monospaced identifiers or machine metadata.
- 6–8px surface radii; pills only for compact status or taxonomy.

## Image-generated north stars

- `vertexade-work-desktop-north-star.png`: desktop shell and board system.
- `vertexade-agents-desktop-north-star.png`: dense master-detail session system.
- `vertexade-work-mobile-north-star.png`: mobile hierarchy and navigation.

The built-in image generation tool used the current rendered pages as edit
targets. Prompts preserved VertexADE's real information architecture while
asking for an original, production-ready interface informed by the calm density
of Linear and Graphite. They explicitly excluded copied branding, glassmorphism,
neon effects, large gradients, marketing layouts, and decorative illustration.

## Implementation mapping

- `apps/web/src/styles.css`: color tokens, typography, canvas, density, mobile
  ergonomics, and Work board treatment.
- `packages/ui/src/components/app-nav.tsx`: wide labeled navigation, compact
  rail, command bar, mobile app bar, and mobile dock.
- `packages/ui/src/components/workspace-layout.tsx`: page width, header,
  toolbar, master-detail, and content-pane rhythm.
- `packages/ui/src/components/ui/*`: buttons, cards, inputs, tabs, badges,
  tables, dialogs, and empty/loading states.
- Route-specific components should use these primitives and only add local
  structure when the domain requires it.

## Detail workspace contract

Pull-request and Work-item details use the same orientation model while
preserving their different jobs:

- The entity header answers identity, ownership, scope, and recency once.
- The next-decision band contains one recommendation and the actions that can
  move it forward. Secondary maintenance stays in overflow menus.
- Pull requests lead from review/check/merge state into discussion, changes,
  checks, and commits. Embedded pages use natural document scrolling so code
  evidence is not trapped inside a second scroll container.
- Work items lead from the intended outcome into the current decision,
  lifecycle, result, timeline, runs, delivery, and durable context.
- Desktop inspectors hold supporting scope and automation facts. On compact
  screens they move after the primary content instead of disappearing.
- URL-backed tabs remain canonical, and mobile review decisions stay reachable
  above the application dock without obscuring the content hierarchy.

## Agent thread workspace contract

Agent conversations have one canonical experience: `ThreadPanel`. Work items wrap
that panel in `ThreadDialog`, while the Agents master-detail workspace and direct
thread route embed it without a dialog shell. Every entry point therefore keeps
the same activity timeline, review results, file changes, follow-up composer,
queued directions, input requests, and run actions. New thread-specific views
must compose this panel instead of projecting the run into another chat model.
