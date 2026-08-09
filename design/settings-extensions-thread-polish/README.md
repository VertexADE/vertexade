# Settings, extensions, and thread polish

This design pass uses the generated reference as direction for hierarchy and interaction, while real product data and the existing component system remain authoritative.

## Design decisions carried into the app

- Settings uses a searchable, persistent section navigator on desktop and a touch-friendly horizontal navigator on mobile.
- Platform-level counts and the Extension store shortcut stay visible without turning Settings into a marketing page.
- Extensions can be scanned by capability and lifecycle, with enabled state, connection health, Configure, and Open available directly on every card.
- Agent threads identify the provider, detected model, reasoning level, and reconciled run state in the list, dialog header, and shared timeline.
- Codex, Claude Code, OpenCode, and ACP use the same provider-neutral components; differences come from detected thread data instead of provider-specific layout branches.
- Running, input-required, resumable, failed, and completed states use consistent language and tones across desktop, tablet, and mobile.

## Reference and captures

- `refined/settings-extensions-threads-direction.png` — imagegen direction.
- `implemented/settings-desktop.png` and `settings-mobile.png` — responsive Settings captures.
- `implemented/extensions-desktop.png` and `extensions-mobile.png` — responsive Extension store captures.
- `implemented/threads-desktop.png` and `threads-mobile.png` — responsive thread list captures.
- `implemented/thread-dialog-codex-desktop.png`, `thread-dialog-claude-mobile.png`, and `thread-dialog-opencode-tablet.png` — real provider thread captures.

## Imagegen prompt

The built-in image generation tool received the current Extension store and mobile thread list/detail captures as references. It was asked for a high-fidelity dark developer-tool design sheet covering Settings, Extensions, and Agent threads, with concise status, provider identity, model/reasoning context, a chronological action timeline, sticky steer/continue controls, and a responsive mobile inset. The prompt explicitly excluded decorative illustration, glassmorphism, cyberpunk styling, oversized marketing areas, fake editors, and generic admin templates.
