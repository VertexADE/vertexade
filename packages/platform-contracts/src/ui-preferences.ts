export type UiDensity = 'compact' | 'comfortable'

export type WorkViewPreferences = {
  repository?: string
  kind?: string
  sort?:
    | 'recent'
    | 'oldest'
    | 'priority-high'
    | 'priority-low'
    | 'created-newest'
    | 'created-oldest'
    | 'title-asc'
    | 'title-desc'
    | 'status'
  attentionOnly?: boolean
  showDone?: boolean
  mobileState?: 'backlog' | 'active' | 'review' | 'deploy' | 'done'
  view?: 'board' | 'list' | 'completed'
}

export type ExtensionBoardPreferences = {
  swimlaneOption: string
  nestedSwimlanes: boolean
  columnsByAxis: Record<string, { order: string[]; hidden: string[] }>
}

export type UiPreferences = {
  focusOrder: number[]
  extensionPins: string[]
  extensionBoards: Record<string, ExtensionBoardPreferences>
  density: UiDensity
  work: WorkViewPreferences
}

export type UiPreferencesPatch = Partial<UiPreferences>
