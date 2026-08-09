type TurnSteerResponse = { turnId: string }

function activeTurnIdFromMismatch(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.match(/expected active turn id `[^`]+` but found `([^`]+)`/)?.[1] || null
}

export async function steerActiveTurn(expectedTurnId: string, steer: (turnId: string) => Promise<TurnSteerResponse>) {
  try {
    return await steer(expectedTurnId)
  } catch (error) {
    const activeTurnId = activeTurnIdFromMismatch(error)
    if (!activeTurnId || activeTurnId === expectedTurnId) throw error
    return steer(activeTurnId)
  }
}

export function completedMonitoredTurn(monitoredTurnId: string | null, completedTurnId: string | null) {
  return !monitoredTurnId || !completedTurnId || monitoredTurnId === completedTurnId
}
