import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { InputQuestion, JobLog } from '@vertexade/ui/lib/dashboard-types'

export function useThreadPanelInputActions(jobId: number | null, job: JobLog | null, questions: InputQuestion[]) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [selections, setSelections] = useState<Record<string, string[]>>({})

  useEffect(() => {
    setAnswers({})
    setCustom({})
    setSelections({})
  }, [jobId])

  async function submitAnswers(event: FormEvent) {
    event.preventDefault()
    if (!job) return
    const payload: Record<string, { answers: string[] }> = {}
    for (const question of questions) {
      const values =
        question.type === 'checkbox'
          ? checkboxAnswerValues(selections[question.id] || [], custom[question.id])
          : [answerValue(question.id, answers, custom)].filter(Boolean)
      if (question.required !== false && !values.length) return toast.error('Answer every required field')
      payload[question.id] = { answers: values }
    }
    try {
      await api(`/api/agent-threads/${job.id}/input`, { method: 'POST', body: JSON.stringify({ answers: payload }) })
      toast.success(`Answer sent; ${job.agent_name} is continuing`)
      setAnswers({})
      setCustom({})
      setSelections({})
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async function cancelForm() {
    if (!job) return
    try {
      await api(`/api/agent-threads/${job.id}/input`, { method: 'DELETE' })
      toast.success('Form cancelled')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return { answers, setAnswers, custom, setCustom, selections, setSelections, submitAnswers, cancelForm }
}

export function checkboxAnswerValues(selections: string[], custom: string | undefined): string[] {
  const customAnswer = custom?.trim()
  const includesOther = selections.includes('__other__')
  const selected = selections.filter((value) => value !== '__other__')
  return includesOther && customAnswer ? [...selected, customAnswer] : selected
}

function answerValue(questionId: string, answers: Record<string, string>, custom: Record<string, string>) {
  if (answers[questionId] === '__other__') return custom[questionId]?.trim()
  return answers[questionId]?.trim()
}
