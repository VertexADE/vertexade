type ProviderThreadAgent = {
  deleteThread?(threadId: string): Promise<void>
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function missingProviderThread(error: unknown) {
  return /not found|does not exist|unknown (?:thread|session)|no (?:thread|session)/i.test(message(error))
}

export async function removeProviderThread(agent: ProviderThreadAgent, threadId?: string | null, ephemeral = false) {
  if (!threadId || ephemeral) return true
  if (!agent.deleteThread) return false
  try {
    await agent.deleteThread(threadId)
    return true
  } catch (error) {
    return missingProviderThread(error)
  }
}
