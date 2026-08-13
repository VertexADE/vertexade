import { Platform } from 'react-native'
import AgentTurnActivity, { type AgentTurnActivityProps, type AgentTurnActivityState } from './agent-turn-live-activity'

export async function updateAgentTurnLiveActivity(props: Omit<AgentTurnActivityProps, 'state'> & { state: AgentTurnActivityState }) {
  if (Platform.OS !== 'ios') return
  const instances = AgentTurnActivity.getInstances()
  if (props.state === 'complete') {
    await Promise.all(instances.map((instance) => instance.end('default', props, new Date())))
    return
  }
  if (instances.length) await Promise.all(instances.map((instance) => instance.update(props)))
  else AgentTurnActivity.start(props, `vertexade://thread/${props.threadId}`)
}
