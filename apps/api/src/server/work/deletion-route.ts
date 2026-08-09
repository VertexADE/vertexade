export function workDeletionRoute(request: Request, pathname: string) {
  const preview = request.method === 'GET' ? pathname.match(/^\/api\/work-items\/([^/]+)\/delete-preview$/) : null
  const remove = request.method === 'DELETE' ? pathname.match(/^\/api\/work-items\/([^/]+)$/) : null
  return preview ? { match: preview, preview: true } : remove ? { match: remove, preview: false } : null
}
