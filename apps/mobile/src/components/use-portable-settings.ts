import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPlatformClient } from '@vertexade/platform-client'
import type { ModuleCatalogEntry, PortableSettingsAction, PortableSettingsSurface } from '@vertexade/platform-contracts'
import {
  portableSettingsValidationErrors,
  portableSettingsValues,
  type PortableSettingsValues,
} from '@vertexade/platform-contracts/portable'
import { confirmDestructive } from './confirm-destructive'

export function usePortableSettings({
  module,
  server,
  settings,
  onSaved,
}: {
  module: ModuleCatalogEntry
  server: string
  settings: PortableSettingsSurface
  onSaved?(): void
}) {
  const extension = useMemo(() => createPlatformClient({ baseUrl: server }).extension(module.id), [module.id, server])
  const [source, setSource] = useState<Record<string, unknown>>({})
  const [values, setValues] = useState<PortableSettingsValues>({})
  const [actionResults, setActionResults] = useState<Record<string, unknown>>({})
  const [activity, setActivity] = useState({ loading: true, busy: '', message: '', error: '' })
  const updateActivity = useCallback((change: Partial<typeof activity>) => {
    setActivity((current) => ({ ...current, ...change }))
  }, [])

  const load = useCallback(async () => {
    updateActivity({ loading: true, error: '' })
    try {
      const result = await extension.loadSettings<Record<string, unknown>>(settings)
      setSource(result)
      setValues(portableSettingsValues(result, settings))
    } catch (reason) {
      updateActivity({ error: failureMessage(reason, 'Settings could not be loaded') })
    } finally {
      updateActivity({ loading: false })
    }
  }, [extension, settings, updateActivity])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async () => {
    const validationError = portableSettingsValidationErrors(settings, values, source)[0]
    if (validationError) {
      updateActivity({ error: validationError, message: '' })
      return
    }
    beginAction('submit', updateActivity)
    try {
      await extension.saveSettings(settings, values)
      updateActivity({ message: settings.submit?.successMessage || 'Settings saved.' })
      await load()
      onSaved?.()
    } catch (reason) {
      updateActivity({ error: failureMessage(reason, 'Settings could not be saved') })
    } finally {
      updateActivity({ busy: '' })
    }
  }, [extension, load, onSaved, settings, source, updateActivity, values])

  const run = useCallback(
    async (actionId: string) => {
      const action = settings.actions?.find((candidate) => candidate.id === actionId)
      if (!action || !(await actionConfirmed(action))) return
      beginAction(action.id, updateActivity)
      try {
        const result = await extension.executeSettingsAction(settings, action, values)
        await applyActionResult(action, result, load, onSaved, setActionResults)
        if (action.successMessage) updateActivity({ message: action.successMessage })
      } catch (reason) {
        updateActivity({ error: failureMessage(reason, `${action.label} failed`) })
      } finally {
        updateActivity({ busy: '' })
      }
    },
    [extension, load, onSaved, settings, updateActivity, values],
  )

  return { source, values, setValues, actionResults, ...activity, load, save, run }
}

function beginAction(id: string, updateActivity: (change: { busy: string; error: string; message: string }) => void) {
  updateActivity({ busy: id, error: '', message: '' })
}

async function actionConfirmed(action: PortableSettingsAction) {
  if (!action.confirm) return true
  return confirmDestructive(action.confirm.title, action.confirm.description, action.confirm.confirmLabel)
}

async function applyActionResult(
  action: PortableSettingsAction,
  result: unknown,
  load: () => Promise<void>,
  onSaved: (() => void) | undefined,
  setActionResults: (update: (current: Record<string, unknown>) => Record<string, unknown>) => void,
) {
  if (action.intent === 'discover') {
    setActionResults((current) => ({ ...current, [action.id]: result }))
    return
  }
  await load()
  onSaved?.()
}

function failureMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}
