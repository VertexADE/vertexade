import { Pressable, ScrollView, Text, View } from 'react-native'
import type { Dispatch, SetStateAction } from 'react'
import type { ModuleCatalogEntry, PortableSettingsAction, PortableSettingsSurface } from '@vertexade/platform-contracts'
import type { PortableSettingsValues } from '@vertexade/platform-contracts/portable'
import { PortableSettingsFieldEditor as FieldEditor } from './portable-settings-field'
import { portableSettingsStyles as styles } from './portable-settings-styles'

type SettingsContentProps = {
  module: ModuleCatalogEntry
  settings: PortableSettingsSurface
  source: Record<string, unknown>
  values: PortableSettingsValues
  setValues: Dispatch<SetStateAction<PortableSettingsValues>>
  actionResults: Record<string, unknown>
  busy: string
  message: string
  error: string
  save(): Promise<void>
  run(actionId: string): Promise<void>
}

export function PortableSettingsContent(props: SettingsContentProps) {
  const { module, settings } = props
  return (
    <ScrollView testID={`settings-${module.id}`} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SettingsHeader settings={settings} />
      <SettingsSections {...props} />
      <SettingsActions actions={actionsByIntent(settings, 'discover')} {...props} />
      <SettingsFeedback error={props.error} message={props.message} />
      <SettingsFooter settings={settings} busy={props.busy} run={props.run} save={props.save} />
    </ScrollView>
  )
}

function SettingsHeader({ settings }: { settings: PortableSettingsSurface }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{settings.title}</Text>
      {settings.description ? <Text style={styles.description}>{settings.description}</Text> : null}
    </View>
  )
}

function SettingsSections(props: SettingsContentProps) {
  return settingsSections(props.settings).map((section) => <SettingsSection key={section.id} section={section} {...props} />)
}

function SettingsSection({ section, source, values, setValues, actionResults }: SettingsContentProps & { section: ResolvedSection }) {
  return (
    <View style={styles.section}>
      {section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : null}
      {section.description ? <Text style={styles.description}>{section.description}</Text> : null}
      {section.definitions.map((field) => (
        <SettingsField
          key={field.name}
          field={field}
          source={source}
          values={values}
          setValues={setValues}
          actionResults={actionResults}
        />
      ))}
    </View>
  )
}

function SettingsField({
  field,
  source,
  values,
  setValues,
  actionResults,
}: Pick<SettingsContentProps, 'source' | 'values' | 'setValues' | 'actionResults'> & {
  field: PortableSettingsSurface['fields'][number]
}) {
  return (
    <FieldEditor
      field={field}
      value={values[field.name]}
      source={source}
      optionSource={{ ...source, ...values }}
      actionResults={actionResults}
      onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
    />
  )
}

function SettingsActions({ actions, busy, run }: SettingsContentProps & { actions: PortableSettingsAction[] }) {
  return actions.map((action) => (
    <Pressable
      testID={`settings-action-${action.id}`}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      key={action.id}
      disabled={Boolean(busy)}
      style={styles.secondaryButton}
      onPress={() => void run(action.id)}
    >
      <Text style={styles.secondaryButtonText}>{busy === action.id ? 'Working…' : action.label}</Text>
    </Pressable>
  ))
}

function SettingsFeedback({ error, message }: { error: string; message: string }) {
  return (
    <>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
    </>
  )
}

function SettingsFooter({
  settings,
  busy,
  run,
  save,
}: Pick<SettingsContentProps, 'settings' | 'busy' | 'run' | 'save'>) {
  return (
    <View style={styles.footer}>
      {actionsByIntent(settings, 'reset').map((action) => (
        <Pressable
          testID={`settings-action-${action.id}`}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          key={action.id}
          disabled={Boolean(busy)}
          style={styles.dangerButton}
          onPress={() => void run(action.id)}
        >
          <Text style={styles.dangerButtonText}>{action.label}</Text>
        </Pressable>
      ))}
      {settings.submit ? (
        <Pressable
          testID="settings-submit"
          accessibilityRole="button"
          accessibilityLabel={settings.submit.label}
          disabled={Boolean(busy)}
          style={styles.primaryButton}
          onPress={() => void save()}
        >
          <Text style={styles.primaryButtonText}>{busy === 'submit' ? 'Saving…' : settings.submit.label}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

type SettingsSection = NonNullable<PortableSettingsSurface['sections']>[number]
type ResolvedSection = SettingsSection & { definitions: PortableSettingsSurface['fields'] }

function settingsSections(settings: PortableSettingsSurface): ResolvedSection[] {
  if (!settings.sections?.length) {
    return [{ id: 'settings', title: '', description: '', fields: [], definitions: settings.fields }]
  }
  return settings.sections.map((section) => ({
    ...section,
    definitions: settings.fields.filter((field) => section.fields.includes(field.name)),
  }))
}

function actionsByIntent(settings: PortableSettingsSurface, intent: PortableSettingsAction['intent']) {
  return (settings.actions || []).filter((action) => action.intent === intent)
}
