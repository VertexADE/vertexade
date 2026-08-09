import { describe, expect, it, vi } from 'vite-plus/test'
import { completedMonitoredTurn, steerActiveTurn } from './turn-control.ts'

describe('Codex turn control', () => {
  it('retries steering with the authoritative active turn after a recovered thread mismatch', async () => {
    const steer = vi.fn(async (turnId: string) => {
      if (turnId === 'queued-turn') throw new Error('expected active turn id `queued-turn` but found `running-turn`')
      return { turnId }
    })

    await expect(steerActiveTurn('queued-turn', steer)).resolves.toEqual({ turnId: 'running-turn' })
    expect(steer).toHaveBeenNthCalledWith(1, 'queued-turn')
    expect(steer).toHaveBeenNthCalledWith(2, 'running-turn')
  })

  it('does not retry unrelated steering failures', async () => {
    const steer = vi.fn().mockRejectedValue(new Error('Turn already completed'))
    await expect(steerActiveTurn('turn-1', steer)).rejects.toThrow('Turn already completed')
    expect(steer).toHaveBeenCalledOnce()
  })

  it('waits for the monitored queued turn when another turn completes first', () => {
    expect(completedMonitoredTurn('queued-turn', 'running-turn')).toBe(false)
    expect(completedMonitoredTurn('queued-turn', 'queued-turn')).toBe(true)
  })
})
