import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@vertexade/ui/components/ui/radio-group'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { InputQuestion, JobLog } from '@vertexade/ui/lib/dashboard-types'

type Answers = Record<string, string>

export function ThreadInputRequestForm({
  job,
  questions,
  answers,
  custom,
  setAnswers,
  setCustom,
  onSubmit,
}: {
  job: JobLog
  questions: InputQuestion[]
  answers: Answers
  custom: Answers
  setAnswers: Dispatch<SetStateAction<Answers>>
  setCustom: Dispatch<SetStateAction<Answers>>
  onSubmit(event: FormEvent<HTMLFormElement>): void
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="mx-3 mt-3 max-h-[40dvh] shrink-0 space-y-3 overflow-y-auto rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 sm:mx-4"
    >
      <div className="flex justify-between gap-3">
        <strong className="font-mono text-xs text-amber-400">{job.agent_name} needs your input</strong>
        <span className="text-xs text-muted-foreground">{age(job.input_requested_at)}</span>
      </div>
      {questions.map((question) => (
        <fieldset key={question.id} className="space-y-2">
          <legend className="font-mono text-xs uppercase text-muted-foreground">{question.header}</legend>
          <p className="text-sm">{question.question}</p>
          {question.options?.length ? (
            <>
              <RadioGroup
                value={answers[question.id]}
                onValueChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
                className="grid gap-1.5 sm:grid-cols-2"
              >
                {question.options.map((option) => (
                  <Label key={option.label} className="grid grid-cols-[auto_1fr] gap-x-2 rounded-md border bg-background p-2">
                    <RadioGroupItem value={option.label} className="row-span-2 mt-0.5" />
                    <span className="text-xs">{option.label}</span>
                    <small className="text-xs text-muted-foreground">{option.description}</small>
                  </Label>
                ))}
                <Label className="grid grid-cols-[auto_1fr] gap-x-2 rounded-md border bg-background p-2">
                  <RadioGroupItem value="__other__" className="row-span-2 mt-0.5" />
                  <span className="text-xs">Other</span>
                  <small className="text-xs text-muted-foreground">Enter a custom answer</small>
                </Label>
              </RadioGroup>
              <Input
                type={question.isSecret ? 'password' : 'text'}
                value={custom[question.id] || ''}
                onFocus={() => setAnswers((current) => ({ ...current, [question.id]: '__other__' }))}
                onChange={(event) => setCustom((current) => ({ ...current, [question.id]: event.target.value }))}
                placeholder="Custom answer"
              />
            </>
          ) : question.isSecret ? (
            <Input
              type="password"
              autoComplete="off"
              value={answers[question.id] || ''}
              onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            />
          ) : (
            <Textarea
              className="min-h-20"
              value={answers[question.id] || ''}
              onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            />
          )}
        </fieldset>
      ))}
      <div className="flex justify-end">
        <Button size="sm">
          <Send />
          Send answer
        </Button>
      </div>
    </form>
  )
}
