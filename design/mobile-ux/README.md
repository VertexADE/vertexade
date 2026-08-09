# Mobile UX refinement

These assets document the 390 x 844 mobile review used for the Work and Threads refinement.

## Screen set

| Screen           | Live capture                      | Imagegen refinement                        | Implemented                                 |
| ---------------- | --------------------------------- | ------------------------------------------ | ------------------------------------------- |
| Work board       | `before/work-board-mobile.png`    | `refined/work-board-mobile-refined.png`    | `implemented/work-board-mobile.png`         |
| Work filters     | —                                 | `refined/work-board-mobile-refined.png`    | `implemented/work-board-filters-mobile.png` |
| Work detail      | `before/work-detail-mobile.png`   | `refined/work-detail-mobile-refined.png`   | `implemented/work-detail-mobile.png`        |
| Threads          | `before/threads-mobile.png`       | `refined/threads-mobile-refined.png`       | `implemented/threads-mobile.png`            |
| Thread filters   | —                                 | `refined/threads-mobile-refined.png`       | `implemented/threads-filters-mobile.png`    |
| Threads at 320px | —                                 | —                                          | `implemented/threads-narrow-mobile.png`     |
| Thread detail    | `before/thread-dialog-mobile.png` | `refined/thread-dialog-mobile-refined.png` | `implemented/thread-dialog-mobile.png`      |
| Thread actions   | —                                 | `refined/thread-dialog-mobile-refined.png` | `implemented/thread-dialog-more-mobile.png` |

## Patterns carried into the app

- Use one compact summary strip and keep the Work card hierarchy focused on title, delivery signal, recent activity, and its primary action.
- Show the current Work phase completely on mobile instead of relying on a clipped horizontal lifecycle.
- Keep shared-memory actions contained and make the absolute memory path an optional detail.
- Present repository and branch context instead of raw worktree paths, and clean Markdown from the short activity preview.
- Keep one context-aware thread action visible and move secondary actions into a touch-friendly More menu.

The generated screens are design references, not pixel-perfect specifications. Existing product behavior and data remain authoritative.
