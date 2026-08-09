import { describe, expect, it } from 'vite-plus/test'
import type { PortableCollectionSurface } from '@vertexade/platform-contracts'
import { PORTABLE_SOURCE_POLL_INTERVAL_MS, portableSourceRequestPath, requestPortableSource, resolvePortableSourceValues } from './index.ts'

const surface = {
  contractVersion: 1,
  kind: 'collection',
  id: 'work-items',
  title: 'Work items',
  source: {
    path: '/board',
    itemsPath: 'items',
  },
  item: {
    idPath: 'id',
    titlePath: 'title',
    fieldsPath: 'fields',
    fieldNamePath: 'name',
    fieldValuePath: 'value',
  },
  views: {
    list: true,
  },
  sourceControls: [
    {
      id: 'iteration',
      label: 'Iteration',
      queryParameter: 'iteration',
      optionsPath: 'iterations',
      optionValuePath: 'path',
      optionLabelPath: 'name',
      selectedPath: 'selectedIteration',
    },
  ],
} satisfies PortableCollectionSurface

describe('portable source refresh', () => {
  it('forces an upstream refresh when a source board opens', () => {
    expect(portableSourceRequestPath(surface, {}, true)).toBe('/board?force_refresh=1')
  })

  it('preserves source controls while forcing a polling refresh', () => {
    expect(portableSourceRequestPath(surface, { iteration: 'VertexADE\\2026 Q3' }, true)).toBe(
      '/board?iteration=VertexADE%5C2026+Q3&force_refresh=1',
    )
  })

  it('uses a provider-friendly polling interval', () => {
    expect(PORTABLE_SOURCE_POLL_INTERVAL_MS).toBe(60_000)
  })

  it('loads source data through the extension client', async () => {
    const request = async (path: string) => ({ path })
    const extension = { request } as never

    await expect(requestPortableSource(extension, surface, { iteration: 'Sprint 1' }, false)).resolves.toEqual({
      path: '/board?iteration=Sprint+1',
    })
  })

  it('derives missing source controls from the response', () => {
    const current = {}
    expect(resolvePortableSourceValues(surface, current, { selectedIteration: 'Sprint 2' })).toEqual({
      iteration: 'Sprint 2',
    })
    expect(resolvePortableSourceValues(surface, { iteration: 'Sprint 1' }, { selectedIteration: 'Sprint 2' })).toEqual({
      iteration: 'Sprint 1',
    })
  })
})
