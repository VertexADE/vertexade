import { useEffect, useState } from 'react'
import type { UiPreferences, UiPreferencesPatch } from '@vertexade/platform-contracts'
import { BehaviorSubject } from 'rxjs'
import { api } from './dashboard-api'

const defaults: UiPreferences = {
  focusOrder: [],
  extensionPins: [],
  extensionBoards: {},
  density: 'comfortable',
  work: {},
}

const preferences = new BehaviorSubject<UiPreferences>(defaults)
let loaded = false
let loadPromise: Promise<UiPreferences> | undefined
let patchQueue = Promise.resolve<UiPreferences>(defaults)

function mergePreferences(current: UiPreferences, patch: UiPreferencesPatch): UiPreferences {
  return {
    ...current,
    ...patch,
    work: patch.work ? { ...current.work, ...patch.work } : current.work,
    extensionBoards: patch.extensionBoards ? { ...current.extensionBoards, ...patch.extensionBoards } : current.extensionBoards,
  }
}

export function loadUiPreferences() {
  loadPromise ??= api<UiPreferences>('/api/ui-preferences')
    .then((value) => {
      loaded = true
      preferences.next(value)
      return value
    })
    .finally(() => {
      loadPromise = undefined
    })
  return loadPromise
}

export function updateUiPreferences(patch: UiPreferencesPatch) {
  const previous = preferences.value
  preferences.next(mergePreferences(previous, patch))
  patchQueue = patchQueue
    .catch(() => preferences.value)
    .then(() =>
      api<UiPreferences>('/api/ui-preferences', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    )
    .then((value) => {
      loaded = true
      preferences.next(value)
      return value
    })
    .catch((error) => {
      preferences.next(previous)
      throw error
    })
  return patchQueue
}

export function useUiPreferences() {
  const [value, setValue] = useState(preferences.value)
  useEffect(() => {
    const subscription = preferences.subscribe(setValue)
    if (!loaded) void loadUiPreferences().catch(() => {})
    return () => subscription.unsubscribe()
  }, [])
  return { value, ready: loaded, update: updateUiPreferences }
}
