import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExtensionBoardPreferences, PortableSwimlaneConfig } from '@vertexade/platform-contracts'
import { toast } from 'sonner'
import {
  defaultPortableBoardPreferences,
  portableBoardPreferenceKey,
  type PortableColumnPreferences,
  validPortableBoardPreferences,
} from '../components/portable-extension-model'
import { useUiPreferences } from '@vertexade/ui/lib/ui-preferences'

export function usePortableBoardPreferences({
  moduleId,
  surfaceId,
  swimlanes,
  axis,
}: {
  moduleId: string
  surfaceId: string
  swimlanes: PortableSwimlaneConfig | undefined
  axis: string
}) {
  const preferences = useUiPreferences()
  const key = portableBoardPreferenceKey(moduleId, surfaceId)
  const fallback = useMemo(() => defaultPortableBoardPreferences(swimlanes), [swimlanes])
  const initial = preferences.value.extensionBoards[key] || fallback
  const [swimlaneOption, setSwimlaneOption] = useState(initial.swimlaneOption)
  const [nestedSwimlanes, setNestedSwimlanes] = useState(initial.nestedSwimlanes)
  const [columnsByAxis, setColumnsByAxis] = useState(initial.columnsByAxis)
  const hydrated = useRef(false)
  const lastSaved = useRef('')

  useEffect(() => {
    if (!preferences.ready || hydrated.current) return
    const stored = preferences.value.extensionBoards[key] || fallback
    const next = validPortableBoardPreferences(stored, fallback, swimlanes)
    setSwimlaneOption(next.swimlaneOption)
    setNestedSwimlanes(next.nestedSwimlanes)
    setColumnsByAxis(next.columnsByAxis)
    lastSaved.current = JSON.stringify(next)
    hydrated.current = true
  }, [fallback, key, preferences.ready, preferences.value.extensionBoards, swimlanes])

  useEffect(() => {
    if (!hydrated.current) return
    const next = { swimlaneOption, nestedSwimlanes, columnsByAxis } satisfies ExtensionBoardPreferences
    const serialized = JSON.stringify(next)
    if (serialized === lastSaved.current) return
    lastSaved.current = serialized
    void preferences
      .update({ extensionBoards: { ...preferences.value.extensionBoards, [key]: next } })
      .catch((reason) => toast.error(reason instanceof Error ? reason.message : 'Could not save board layout'))
  }, [columnsByAxis, key, nestedSwimlanes, preferences, swimlaneOption])

  const columnPreferences = columnsByAxis[axis] || { order: [], hidden: [] }
  const changeColumnPreferences = useCallback(
    (next: PortableColumnPreferences) => setColumnsByAxis((current) => ({ ...current, [axis]: next })),
    [axis],
  )

  return {
    swimlaneOption,
    setSwimlaneOption,
    nestedSwimlanes,
    setNestedSwimlanes,
    columnPreferences,
    changeColumnPreferences,
  }
}
