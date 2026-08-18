import type { Dispatch, SetStateAction } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { ThreadInputRequestForm } from '@vertexade/ui/components/thread-input-request-form'
import type { InputQuestion, JobLog } from '@vertexade/ui/lib/dashboard-types'

type Answers = Record<string, string>

const setAnswers: Dispatch<SetStateAction<Answers>> = () => undefined
const setSelections: Dispatch<SetStateAction<Record<string, string[]>>> = () => undefined

const questions: InputQuestion[] = [
  {
    id: 'environment',
    header: 'Target',
    question: 'Environment',
    type: 'select',
    required: true,
    formTitle: 'Launch details',
    formDescription: 'Confirm the target and release metadata.',
    options: [
      { label: 'Production', value: 'production', description: 'Ship to customers.' },
      { label: 'Staging', value: 'staging', description: 'Validate before shipping.' },
    ],
  },
  { id: 'notes', header: 'Notes', question: 'Release notes', type: 'textarea', required: true },
  { id: 'date', header: 'Schedule', question: 'Release date', type: 'date', required: true },
  { id: 'retries', header: 'Limits', question: 'Retry limit', type: 'number' },
  { id: 'owner', header: 'Contact', question: 'Owner email', type: 'email' },
  { id: 'callback', header: 'Endpoint', question: 'Callback URL', type: 'url' },
  { id: 'token', header: 'Secret', question: 'Release token', type: 'password', isSecret: true },
]

describe('ThreadInputRequestForm', () => {
  it('renders Vertex Form inline with the dedicated control for every question type', () => {
    const markup = renderToStaticMarkup(
      <ThreadInputRequestForm
        job={{ agent_name: 'Codex', input_requested_at: new Date().toISOString() } as JobLog}
        questions={questions}
        answers={{}}
        custom={{}}
        selections={{}}
        setAnswers={setAnswers}
        setCustom={setAnswers}
        setSelections={setSelections}
        onSubmit={() => undefined}
      />,
    )

    expect(markup).toContain('Launch details')
    expect(markup).toContain('data-slot="select-trigger"')
    expect(markup).toContain('aria-label="Environment"')
    expect(markup).toContain('<textarea')
    expect(markup).toContain('aria-label="Release notes"')
    expect(markup).toContain('type="date"')
    expect(markup).toContain('type="number"')
    expect(markup).toContain('type="email"')
    expect(markup).toContain('type="url"')
    expect(markup).toContain('type="password"')
    expect(markup).not.toContain('role="dialog"')
  })
})
