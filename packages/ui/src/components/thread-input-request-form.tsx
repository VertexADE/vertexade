import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { Send, X } from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@vertexade/ui/components/ui/radio-group'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { InputQuestion, JobLog } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

type Answers = Record<string, string>

export function ThreadInputRequestForm({
  job,
  questions,
  answers,
  custom,
  setAnswers,
  setCustom,
  selections,
  setSelections,
  onSubmit,
  onCancel,
  className,
}: {
  job: JobLog
  questions: InputQuestion[]
  answers: Answers
  custom: Answers
  setAnswers: Dispatch<SetStateAction<Answers>>
  setCustom: Dispatch<SetStateAction<Answers>>
  selections: Record<string, string[]>
  setSelections: Dispatch<SetStateAction<Record<string, string[]>>>
  onSubmit(event: FormEvent<HTMLFormElement>): void
  onCancel?(): void
  className?: string
}) {
  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        'mx-3 mt-3 max-h-[40dvh] shrink-0 space-y-3 overflow-y-auto rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 sm:mx-4',
        className,
      )}
    >
      <div className="flex justify-between gap-3">
        <strong className="font-mono text-xs text-amber-400">{questions[0]?.formTitle || `${job.agent_name} needs your input`}</strong>
        <span className="text-xs text-muted-foreground">{age(job.input_requested_at)}</span>
      </div>
      {questions[0]?.formDescription ? <p className="text-sm text-muted-foreground">{questions[0].formDescription}</p> : null}
      {questions.map((question) => (
        <fieldset key={question.id} className="space-y-2">
          {question.header && !question.formTitle ? (
            <legend className="font-mono text-xs uppercase text-muted-foreground">{question.header}</legend>
          ) : null}
          <p className="text-sm">{question.question}</p>
          {question.description ? <p className="text-xs text-muted-foreground">{question.description}</p> : null}
          {question.type === 'checkbox' ? (
            <>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {(question.options || []).map((option) => {
                  const value = option.value || option.label
                  const checked = selections[question.id]?.includes(value) || false
                  return (
                    <Label key={value} className="grid grid-cols-[auto_1fr] gap-x-2 rounded-md border bg-background p-2">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          setSelections((current) => ({
                            ...current,
                            [question.id]: next
                              ? [...(current[question.id] || []), value]
                              : (current[question.id] || []).filter((candidate) => candidate !== value),
                          }))
                        }
                        className="row-span-2 mt-0.5"
                      />
                      <span className="text-xs">{option.label}</span>
                      <small className="text-xs text-muted-foreground">{option.description}</small>
                    </Label>
                  )
                })}
              </div>
              <Input
                type={question.isSecret ? 'password' : 'text'}
                value={custom[question.id] || ''}
                onChange={(event) => setCustom((current) => ({ ...current, [question.id]: event.target.value }))}
                placeholder="Other — enter your own answer"
              />
            </>
          ) : question.options?.length ? (
            <>
              <RadioGroup
                value={answers[question.id]}
                onValueChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
                className="grid gap-1.5 sm:grid-cols-2"
              >
                {question.options.map((option) => (
                  <Label key={option.label} className="grid grid-cols-[auto_1fr] gap-x-2 rounded-md border bg-background p-2">
                    <RadioGroupItem value={option.value || option.label} className="row-span-2 mt-0.5" />
                    <span className="text-xs">{option.label}</span>
                    <small className="text-xs text-muted-foreground">{option.description}</small>
                  </Label>
                ))}
                <Label className="grid grid-cols-[auto_1fr] gap-x-2 rounded-md border bg-background p-2">
                  <RadioGroupItem value="__other__" className="row-span-2 mt-0.5" />
                  <span className="text-xs">Other</span>
                  <small className="text-xs text-muted-foreground">Enter your own answer</small>
                </Label>
              </RadioGroup>
              <Input
                type={question.isSecret ? 'password' : 'text'}
                value={custom[question.id] || ''}
                onFocus={() => setAnswers((current) => ({ ...current, [question.id]: '__other__' }))}
                onChange={(event) => setCustom((current) => ({ ...current, [question.id]: event.target.value }))}
                placeholder="Other — enter your own answer"
              />
            </>
          ) : question.isSecret ? (
            <Input
              type="password"
              autoComplete="off"
              value={answers[question.id] || ''}
              onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            />
          ) : question.multiline !== false ? (
            <Textarea
              className="min-h-20"
              value={answers[question.id] || ''}
              onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            />
          ) : (
            <Input
              value={answers[question.id] || ''}
              onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            />
          )}
        </fieldset>
      ))}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <X /> Cancel
          </Button>
        ) : null}
        <Button size="sm">
          <Send />
          Send answer
        </Button>
      </div>
    </form>
  )
}
