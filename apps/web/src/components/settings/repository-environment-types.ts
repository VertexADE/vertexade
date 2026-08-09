export type SnapshotPath = {
  id: string
  path: string
  kind?: 'file' | 'directory'
}

export type SecretVariable = {
  id: string
  name: string
  configured: boolean
  value: string
  changed: boolean
}

export type ManagedEnvFile = {
  id: string
  path: string
  configured: boolean
  content: string
  changed: boolean
}

export type EnvironmentProfile = {
  id: string
  persisted: boolean
  scope: string
  snapshotPaths: SnapshotPath[]
  variables: SecretVariable[]
  envFiles: ManagedEnvFile[]
  startCommand: string
  stopCommand: string
  inheritsFrom: string[]
}

export type EnvironmentProfileResponse = {
  scope: string
  snapshotPaths: Array<{ path: string; kind: 'file' | 'directory' }>
  variables: Array<{ name: string; configured: true }>
  envFiles: Array<{ path: string; configured: true }>
  startCommand: string
  stopCommand: string
  inheritsFrom: string[]
}

let rowId = 0

export function nextRowId(prefix: string) {
  rowId += 1
  return `${prefix}-${rowId}`
}

export function emptyProfile(scope = '', persisted = false): EnvironmentProfile {
  return {
    id: nextRowId('profile'),
    persisted,
    scope,
    snapshotPaths: [],
    variables: [],
    envFiles: [],
    startCommand: '',
    stopCommand: '',
    inheritsFrom: [],
  }
}

export function editableProfile(profile: EnvironmentProfileResponse): EnvironmentProfile {
  return {
    ...profile,
    id: nextRowId('profile'),
    persisted: true,
    snapshotPaths: profile.snapshotPaths.map((entry) => ({ ...entry, id: nextRowId('snapshot') })),
    variables: profile.variables.map((entry) => ({
      ...entry,
      id: nextRowId('variable'),
      value: '',
      changed: false,
    })),
    envFiles: profile.envFiles.map((entry) => ({
      ...entry,
      id: nextRowId('env-file'),
      content: '',
      changed: false,
    })),
  }
}

export function profilePayload(profile: EnvironmentProfile) {
  return {
    scope: profile.scope.trim(),
    snapshotPaths: profile.snapshotPaths.map(({ path }) => ({ path: path.trim() })),
    variables: profile.variables.map(({ name, value, changed }) => ({
      name: name.trim(),
      ...(changed ? { value } : {}),
    })),
    envFiles: profile.envFiles.map(({ path, content, changed }) => ({
      path: path.trim(),
      ...(changed ? { content } : {}),
    })),
    startCommand: profile.startCommand,
    stopCommand: profile.stopCommand,
  }
}
