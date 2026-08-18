import { describe, expect, it } from 'vite-plus/test'
import { cancelFormForJob, formResponseMarkdown, waitForFormResolution } from './form-requests.ts'

describe('agent form requests', () => {
  it('returns deterministic Markdown for text and multiple checkbox values', () => {
    expect(
      formResponseMarkdown(
        [
          { id: 'name', question: 'Name', formTitle: 'Project setup' },
          { id: 'features', question: 'Features' },
          { id: 'notes', question: 'Notes' },
        ],
        { name: { answers: ['Vertex'] }, features: { answers: ['Search', 'Forms'] } },
      ),
    ).toBe('## Project setup\n\n- **Name:** Vertex\n- **Features:** Search, Forms\n- **Notes:** _Not provided_')
  })

  it('resolves a pending form when the user cancels it', async () => {
    const pending = waitForFormResolution('form:test', 42)
    expect(cancelFormForJob(42, 'Cancelled by the user')).toBe(true)
    await expect(pending).resolves.toEqual({ status: 'cancelled', reason: 'Cancelled by the user' })
  })

  it('removes a pending form when its HTTP request is aborted', async () => {
    const controller = new AbortController()
    const pending = waitForFormResolution('form:aborted', 43, controller.signal)

    controller.abort()

    await expect(pending).resolves.toEqual({ status: 'cancelled', reason: 'The agent stopped waiting for form input' })
    expect(cancelFormForJob(43, 'Too late')).toBe(false)
  })
})
