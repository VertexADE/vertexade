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
})
