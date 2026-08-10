export function listenerOrigin(host: string, port: number): string {
  const hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return new URL(`http://${hostname}:${port}`).origin
}
