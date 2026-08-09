import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { InputQuestion, JobLog } from '@vertexade/ui/lib/dashboard-types'

export function useThreadPanelInputActions(jobId: number | null, job: JobLog | null, questions: InputQuestion[]) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})

  useEffect(() => {
    setAnswers({})
    setCustom({})
  }, [jobId])

  async function submitAnswers(event: FormEvent) {
    event.preventDefault()
    if (!job) return
    const payload: Record<string, { answers: string[] }> = {}
    for (const question of questions) {
      const value = answerValue(question.id, answers, custom)
      if (!value) return toast.error(`Answer every ${job.agent_name} question`)
      payload[question.id] = { answers: [value] }
    }
    try {
      await api(`/api/agent-threads/${job.id}/input`, { method: 'POST', body: JSON.stringify({ answers: payload }) })
      toast.success(`Answer sent; ${job.agent_name} is continuing`)
      setAnswers({})
      setCustom({})
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return { answers, setAnswers, custom, setCustom, submitAnswers }
}

function answerValue(questionId: string, answers: Record<string, string>, custom: Record<string, string>) {
  if (answers[questionId] === '__other__') return custom[questionId]?.trim()
  return answers[questionId]?.trim()
}
