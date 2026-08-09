# Dashboard server modules

`dashboard-server.ts` is the composition root. It owns process-wide state, creates
the services, configures the runtime context, and delegates HTTP requests.

- `read-model.ts` builds dashboard projections and shared presentation helpers.
- `repository-runtime.ts` synchronizes repositories and manages automatic reviews.
- `review-runtime.ts` launches and monitors worktrees and review jobs.
- `thread-runtime.ts` manages agent threads, schedules, follow-ups, and steering.
- `system-api.ts`, `pull-request-api.ts`, and `thread-api.ts` own their route groups.
- `runtime-context.ts` is the dependency boundary between the composition root and
  feature modules. The root configures it once, then supplies the read-model store
  with its focused setter because that store is initialized after startup.

Feature modules must not import `dashboard-server.ts` or one another. Add a
dependency to `configureDashboardRuntime` when a feature needs a shared service.
This keeps the dependency graph one-way and prevents circular initialization.
