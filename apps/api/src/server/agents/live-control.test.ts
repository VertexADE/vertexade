import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vite-plus/test'
import { agentControlEvent, sendAgentControlCommand } from './live-control.ts'

function child(write: (value: string, callback: (error?: Error | null) => void) => void) {
  return Object.assign(new EventEmitter(), { stdin: { writable: true, write } }) as any
}

describe('live agent control', () => {
  it('waits for the matching acknowledgement', async () => {
    const process = child((value, callback) => {
      callback()
      const command = JSON.parse(value)
      queueMicrotask(() => {
        process.emit(agentControlEvent, { event: 'steer_accepted', command_id: 'other' })
        process.emit(agentControlEvent, {
          event: 'steer_accepted',
          command_id: command.command_id,
          turn_id: 'turn-1',
        })
      })
    })
    await expect(
      sendAgentControlCommand(process, {
        type: 'steer',
        command_id: 'command-1',
        prompt: 'Change direction',
      }),
    ).resolves.toMatchObject({ turn_id: 'turn-1' })
  })

  it('surfaces a rejected steering request', async () => {
    const process = child((value, callback) => {
      callback()
      const command = JSON.parse(value)
      queueMicrotask(() =>
        process.emit(agentControlEvent, {
          event: 'steer_rejected',
          command_id: command.command_id,
          message: 'Turn already completed',
        }),
      )
    })
    await expect(
      sendAgentControlCommand(process, {
        type: 'steer',
        command_id: 'command-2',
        prompt: 'Change direction',
      }),
    ).rejects.toThrow('Turn already completed')
  })
})
