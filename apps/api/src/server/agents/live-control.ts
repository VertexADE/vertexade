import type { ChildProcess } from 'node:child_process'

export const agentControlEvent = 'vertexade:agent-control-event'

type AgentControlCommand = {
  type: string
  command_id: string
  [key: string]: unknown
}

type AgentControlEvent = {
  event?: string
  command_id?: string
  message?: string
  [key: string]: unknown
}

export function publishAgentControlEvent(child: ChildProcess, event: AgentControlEvent) {
  child.emit(agentControlEvent, event)
}

export function sendAgentControlCommand(child: ChildProcess, command: AgentControlCommand, timeoutMs = 10_000) {
  if (!child.stdin?.writable) return Promise.reject(new Error('The live agent connection is no longer available'))

  return new Promise<AgentControlEvent>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, event?: AgentControlEvent) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off(agentControlEvent, onControlEvent)
      child.off('close', onClose)
      if (error) reject(error)
      else resolve(event || {})
    }
    const onControlEvent = (event: AgentControlEvent) => {
      if (event.command_id !== command.command_id) return
      if (event.event === `${command.type}_accepted`) finish(undefined, event)
      if (event.event === `${command.type}_rejected`) finish(new Error(event.message || `The agent rejected the ${command.type} command`))
    }
    const onClose = () => finish(new Error('The active agent turn ended before it confirmed the command'))
    const timer = setTimeout(() => finish(new Error(`The agent did not confirm the ${command.type} command`)), timeoutMs)
    timer.unref()
    child.on(agentControlEvent, onControlEvent)
    child.once('close', onClose)
    child.stdin!.write(`${JSON.stringify(command)}\n`, (error) => {
      if (error) finish(error instanceof Error ? error : new Error(String(error)))
    })
  })
}
