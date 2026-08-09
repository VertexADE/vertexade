export type PreviewRun = (command: string, args: string[], options?: Record<string, unknown>) => Promise<string>

export type PreviewPort = {
  containerPort: number
  protocol: 'tcp' | 'udp'
  public?: boolean
}

export type PreviewServicePlan = {
  name: string
  runtimeName: string
  source: 'compose' | 'dockerfile' | 'moon'
  ports: PreviewPort[]
  context?: string
  dockerfile?: string
  image?: string
  project?: string
  task?: string
}

export type PreviewTool = {
  id: string
  name: string
  sourceFile: string
  version?: string
}

export type PreviewPlan = {
  source: 'tilt-compose' | 'compose' | 'moon-compose' | 'tilt-dockerfile' | 'dockerfile' | 'moon'
  sourceFile: string
  services: PreviewServicePlan[]
  tools: PreviewTool[]
  warnings: string[]
  compose?: Record<string, any>
}

export const ignoredDirectories = new Set(['.git', '.next', '.output', '.turbo', 'build', 'coverage', 'dist', 'node_modules', 'vendor'])
export const composeNames = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
export const validServiceName = /[^a-z0-9-]+/g
export const toolFiles = [
  { id: 'mise', name: 'mise', files: ['mise.toml', '.mise.toml'] },
  { id: 'pnpm', name: 'pnpm', files: ['pnpm-lock.yaml'] },
  { id: 'npm', name: 'npm', files: ['package-lock.json'] },
  { id: 'yarn', name: 'Yarn', files: ['yarn.lock'] },
  { id: 'bun', name: 'Bun', files: ['bun.lock', 'bun.lockb'] },
  { id: 'turbo', name: 'Turborepo', files: ['turbo.json'] },
  { id: 'nx', name: 'Nx', files: ['nx.json'] },
  { id: 'bazel', name: 'Bazel', files: ['MODULE.bazel', 'WORKSPACE', 'WORKSPACE.bazel'] },
  {
    id: 'gradle',
    name: 'Gradle',
    files: ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts'],
  },
  { id: 'maven', name: 'Maven', files: ['pom.xml'] },
  { id: 'cargo', name: 'Cargo', files: ['Cargo.toml'] },
  { id: 'go', name: 'Go', files: ['go.mod'] },
  { id: 'uv', name: 'uv', files: ['uv.lock'] },
  { id: 'poetry', name: 'Poetry', files: ['poetry.lock'] },
] as const
