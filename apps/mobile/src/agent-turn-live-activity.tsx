import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity } from 'expo-widgets'

export type AgentTurnActivityState = 'working' | 'idle' | 'complete'
export type AgentTurnActivityProps = { agent: string; detail: string; state: AgentTurnActivityState; threadId: number; title: string }

function AgentTurnActivity(props: AgentTurnActivityProps) {
  'widget'
  const color = props.state === 'complete' ? '#30D158' : props.state === 'idle' ? '#FFD60A' : '#0A84FF'
  const status = props.state === 'complete' ? 'Complete' : props.state === 'idle' ? 'Needs attention' : 'Working'
  const compact = <Text modifiers={[foregroundStyle(color), font({ weight: 'bold', size: 13 })]}>{status}</Text>
  const banner = <VStack alignment="leading" spacing={5} modifiers={[padding({ all: 14 })]}>
    <HStack><Text modifiers={[font({ weight: 'bold', size: 15 })]}>{props.title}</Text><Spacer /><Text modifiers={[foregroundStyle(color), font({ weight: 'semibold', size: 12 })]}>{status}</Text></HStack>
    <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' }), font({ size: 12 })]}>{props.agent} · {props.detail}</Text>
  </VStack>
  return { banner, compactLeading: <Text modifiers={[foregroundStyle(color)]}>●</Text>, compactTrailing: compact, minimal: <Text modifiers={[foregroundStyle(color)]}>●</Text>, expandedCenter: banner }
}

export default createLiveActivity<AgentTurnActivityProps>('AgentTurnActivity', AgentTurnActivity)
