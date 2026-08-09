import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { PortableItemAction } from '@vertexade/platform-contracts'
import { type PortableCollectionItem } from '@vertexade/platform-contracts/portable'
import { type PlatformExtensionClient } from '@vertexade/platform-client'
import { colors } from '@/theme'
import { portableCollectionStyles as styles } from './portable-collection-styles'

import { ActionInput } from './portable-action-input'
import { MobileAgentOptions } from './mobile-agent-options'
import { defaultValue, visibleInputs, type SourceData } from './portable-action-values'
import { usePortableAction } from './use-portable-action'
export function PortableCollectionActionModal({ action, item, data, extension, server, onClose, onCompleted }: {
  action: PortableItemAction
  item: PortableCollectionItem | null
  data: SourceData
  extension: PlatformExtensionClient
  server: string
  onClose: () => void
  onCompleted: () => Promise<void>
}) {
  const {
    values, setValues, agent, setAgent, busy, error, jobId, jobStatus, jobResult, setJobResult,
    refinement, setRefinement, jobComplete, execute, completeWorkflow, refineWorkflow,
  } = usePortableAction({ action, item, data, extension, onClose, onCompleted })
  return <Modal animationType="slide" presentationStyle="pageSheet" visible onRequestClose={onClose}>
    <View testID="action-modal" style={styles.modal}><View style={styles.modalHeader}><View style={styles.modalHeading}><Text style={styles.modalEyebrow}>EXTENSION ACTION</Text><Text style={styles.modalTitle}>{action.label}</Text><Text style={styles.subtitle}>{item?.title}</Text></View><Pressable testID="action-cancel" onPress={onClose}><Text style={styles.close}>Cancel</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.modalContent}>{!jobId ? <>{visibleInputs(action.inputs || [], values).map((input) => <ActionInput data={data} input={input} item={item} key={input.name} values={values} onChange={(value) => setValues((current) => ({ ...current, [input.name]: value }))} value={values[input.name] ?? defaultValue(input)} />)}{action.intent === 'launch-work' ? <MobileAgentOptions server={server} value={agent} onChange={setAgent} /> : null}</> : <><View style={styles.detailBox}><Text style={styles.fieldName}>WORKFLOW STATUS</Text><Text style={styles.fieldValue}>{jobStatus || 'Starting…'}</Text></View>{jobResult ? <View style={styles.inputGroup}><Text style={styles.inputLabel}>Review and edit result</Text><TextInput multiline numberOfLines={14} style={[styles.search, styles.workflowResult]} value={jobResult} onChangeText={setJobResult} /></View> : null}{jobComplete && action.job?.refineAction ? <View style={styles.inputGroup}><Text style={styles.inputLabel}>Refinement request</Text><TextInput multiline style={[styles.search, styles.textarea]} value={refinement} onChangeText={setRefinement} /><Pressable disabled={busy || !refinement.trim()} onPress={() => void refineWorkflow()} style={[styles.secondaryButton, (busy || !refinement.trim()) && styles.disabled]}><Text style={styles.secondaryButtonText}>Refine</Text></Pressable></View> : null}</>}{error ? <Text style={styles.error}>{error}</Text> : null}</ScrollView>
      {!jobId ? <Pressable disabled={busy} onPress={() => void execute()} style={[styles.modalPrimary, busy && styles.disabled]}>{busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryButtonText}>{action.label}</Text>}</Pressable> : jobComplete && action.job?.completeAction ? <Pressable disabled={busy} onPress={() => void completeWorkflow()} style={[styles.modalPrimary, busy && styles.disabled]}>{busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryButtonText}>{action.job.completeAction.label}</Text>}</Pressable> : null}
    </View>
  </Modal>
}
