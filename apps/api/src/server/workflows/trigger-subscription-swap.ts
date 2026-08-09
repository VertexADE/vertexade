type Dispose = () => void

function disposeAll(subscriptions: Iterable<Dispose>) {
  let failure: unknown
  for (const dispose of subscriptions) {
    try {
      dispose()
    } catch (error) {
      failure ||= error
    }
  }
  return failure
}

function replaceMap(target: Map<string, Dispose>, source: Map<string, Dispose>) {
  target.clear()
  for (const [id, dispose] of source) target.set(id, dispose)
}

export async function replaceTriggerSubscriptions(
  current: Map<string, Dispose>,
  triggerIds: Iterable<string>,
  subscribe: (triggerId: string) => Promise<Dispose | null>,
) {
  const next = new Map<string, Dispose>()
  try {
    for (const triggerId of triggerIds) {
      const dispose = await subscribe(triggerId)
      if (dispose) next.set(triggerId, dispose)
    }
  } catch (error) {
    disposeAll(next.values())
    throw error
  }

  const previousIds = [...current.keys()]
  const disposalError = disposeAll(current.values())
  if (!disposalError) {
    replaceMap(current, next)
    return
  }

  disposeAll(next.values())
  const restored = new Map<string, Dispose>()
  for (const triggerId of previousIds) {
    try {
      const dispose = await subscribe(triggerId)
      if (dispose) restored.set(triggerId, dispose)
    } catch {}
  }
  replaceMap(current, restored)
  throw disposalError
}
