export function routeSegments(path: string) {
  return path.split('/').filter(Boolean)
}

export function routeParameters(path: string) {
  return routeSegments(path)
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1))
}

export function assertRoutePath(path: string, label: string) {
  if (!path.startsWith('/') || path.includes('..')) {
    throw new Error(`${label} paths must be absolute and cannot traverse directories`)
  }
  const parameters = routeParameters(path)
  if (parameters.some((parameter) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(parameter)) || new Set(parameters).size !== parameters.length) {
    throw new Error(`${label} has invalid or duplicate parameters: ${path}`)
  }
}

export function matchRouteSegments(pattern: string[], actual: string[]) {
  if (pattern.length !== actual.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index]
    const received = actual[index]
    if (expected === undefined || received === undefined) return null
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(received)
    } else if (expected !== received) {
      return null
    }
  }
  return params
}
