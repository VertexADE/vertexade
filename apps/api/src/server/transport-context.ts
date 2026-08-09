export const TRANSPORT_CLIENT_IP_HEADER = 'x-vertexade-transport-client-ip'

export function transportClientIdentity(request: Request) {
  return request.headers.get(TRANSPORT_CLIENT_IP_HEADER) || 'unknown'
}
