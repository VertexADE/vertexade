import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Send, X } from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@vertexade/ui/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { InputQuestion, JobLog } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

type Answers = Record<string, string>
type Selections = Record<string, string[]>
type QuestionControlProps = {
  question: InputQuestion
  answers: Answers
  custom: Answers
  setAnswers: Dispatch<SetStateAction<Answers>>
  setCustom: Dispatch<SetStateAction<Answers>>
  selections: Selections
  setSelections: Dispatch<SetStateAction<Selections>>
}

export function inputQuestionValidationErrors(questions: InputQuestion[], answers: Answers, custom: Answers, selections: Selections) {
  return Object.fromEntries(
    questions.flatMap((question) => {
      if (question.type === 'checkbox') {
        const selected = selections[question.id] || []
        const error = requiredAnswerError(
          question.required,
          selected.length > 0,
          selected.includes('__other__'),
          custom[question.id],
          'Choose at least one answer',
        )
        return error ? [[question.id, error]] : []
      }
      if (question.type === 'select' || question.options?.length) {
        const selected = answers[question.id]
        const error = requiredAnswerError(
          question.required,
          Boolean(selected),
          selected === '__other__',
          custom[question.id],
          'Choose an answer',
        )
        return error ? [[question.id, error]] : []
      }
      return []
    }),
  )
}

function requiredAnswerError(
  required: boolean | undefined,
  hasSelection: boolean,
  needsOther: boolean,
  customAnswer: string | undefined,
  missingSelection: string,
) {
  if (required && !hasSelection) return missingSelection
  return needsOther && !customAnswer?.trim() ? 'Enter the other answer' : null
}

export function submitInputQuestionForm(
  event: FormEvent<HTMLFormElement>,
  questions: InputQuestion[],
  answers: Answers,
  custom: Answers,
  selections: Selections,
  setValidationErrors: Dispatch<SetStateAction<Record<string, string>>>,
  onSubmit: (event: FormEvent<HTMLFormElement>) => void,
) {
  const errors = inputQuestionValidationErrors(questions, answers, custom, selections)
  setValidationErrors(errors)
  if (Object.keys(errors).length) {
    event.preventDefault()
    return
  }
  onSubmit(event)
}

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
  selections: Selections
  setSelections: Dispatch<SetStateAction<Selections>>
  onSubmit(event: FormEvent<HTMLFormElement>): void
  onCancel?(): void
  className?: string
}) {
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  return (
    <form
      onSubmit={(event) => {
        submitInputQuestionForm(event, questions, answers, custom, selections, setValidationErrors, onSubmit)
      }}
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
        <ThreadQuestion
          key={question.id}
          question={question}
          answers={answers}
          custom={custom}
          setAnswers={setAnswers}
          setCustom={setCustom}
          selections={selections}
          setSelections={setSelections}
          validationError={validationErrors[question.id]}
        />
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

function ThreadQuestion(props: QuestionControlProps & { validationError?: string }) {
  const { question, validationError } = props
  return (
    <fieldset className="space-y-2" aria-invalid={validationError ? true : undefined}>
      {question.header && !question.formTitle ? (
        <legend className="font-mono text-xs uppercase text-muted-foreground">{question.header}</legend>
      ) : null}
      <p className="text-sm">{question.question}</p>
      {question.description ? <p className="text-xs text-muted-foreground">{question.description}</p> : null}
      <QuestionControl {...props} />
      {validationError ? (
        <p className="text-xs text-destructive" role="alert">
          {validationError}
        </p>
      ) : null}
    </fieldset>
  )
}

function QuestionControl(props: QuestionControlProps) {
  const { question } = props
  if (question.type === 'checkbox') return <CheckboxQuestion {...props} />
  if (question.type === 'select' && question.options?.length) return <SelectQuestion {...props} />
  if (question.options?.length) return <ChoiceQuestion {...props} />
  return <TextQuestion {...props} />
}

function CheckboxQuestion({ question, custom, setCustom, selections, setSelections }: QuestionControlProps) {
  function toggle(value: string, checked: boolean) {
    setSelections((current) => ({
      ...current,
      [question.id]: checked
        ? [...(current[question.id] || []), value]
        : (current[question.id] || []).filter((candidate) => candidate !== value),
    }))
  }
  return (
    <>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {(question.options || []).map((option) => {
          const value = option.value || option.label
          return (
            <Label key={value} className="grid grid-cols-[auto_1fr] gap-x-2 rounded-md border bg-background p-2">
              <Checkbox
                checked={selections[question.id]?.includes(value) || false}
                onCheckedChange={(next) => toggle(value, Boolean(next))}
                className="row-span-2 mt-0.5"
              />
              <span className="text-xs">{option.label}</span>
              <small className="text-xs text-muted-foreground">{option.description}</small>
            </Label>
          )
        })}
        <Label className="grid grid-cols-[auto_1fr] gap-x-2 rounded-md border bg-background p-2">
          <Checkbox
            checked={selections[question.id]?.includes('__other__') || false}
            onCheckedChange={(next) => toggle('__other__', Boolean(next))}
            className="row-span-2 mt-0.5"
          />
          <span className="text-xs">Other</span>
          <small className="text-xs text-muted-foreground">Enter your own answer</small>
        </Label>
      </div>
      {selections[question.id]?.includes('__other__') ? (
        <OtherAnswer question={question} custom={custom} setCustom={setCustom} required placeholder="Other — enter your own answer" />
      ) : null}
    </>
  )
}

function SelectQuestion({ question, answers, custom, setAnswers, setCustom }: QuestionControlProps) {
  return (
    <>
      <Select
        required={question.required}
        value={answers[question.id]}
        onValueChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
      >
        <SelectTrigger className="w-full" aria-label={question.question}>
          <SelectValue placeholder="Choose an answer" />
        </SelectTrigger>
        <SelectContent>
          {question.options?.map((option) => (
            <SelectItem key={option.value || option.label} value={option.value || option.label}>
              {option.label}
            </SelectItem>
          ))}
          <SelectItem value="__other__">Other</SelectItem>
        </SelectContent>
      </Select>
      {answers[question.id] === '__other__' ? (
        <OtherAnswer question={question} custom={custom} setCustom={setCustom} required placeholder="Enter your own answer" />
      ) : null}
    </>
  )
}

function ChoiceQuestion({ question, answers, custom, setAnswers, setCustom }: QuestionControlProps) {
  return (
    <>
      <RadioGroup
        value={answers[question.id]}
        onValueChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
        className="grid gap-1.5 sm:grid-cols-2"
      >
        {question.options?.map((option) => (
          <Label key={option.value || option.label} className="grid grid-cols-[auto_1fr] gap-x-2 rounded-md border bg-background p-2">
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
      <OtherAnswer
        question={question}
        custom={custom}
        setCustom={setCustom}
        required={answers[question.id] === '__other__'}
        onFocus={() => setAnswers((current) => ({ ...current, [question.id]: '__other__' }))}
        placeholder="Other — enter your own answer"
      />
    </>
  )
}

function OtherAnswer({
  question,
  custom,
  setCustom,
  required = false,
  onFocus,
  placeholder,
}: Pick<QuestionControlProps, 'question' | 'custom' | 'setCustom'> & {
  required?: boolean
  onFocus?(): void
  placeholder: string
}) {
  return (
    <Input
      required={question.required && required}
      aria-label={`Other answer for ${question.question}`}
      type={question.isSecret ? 'password' : 'text'}
      value={custom[question.id] || ''}
      onFocus={onFocus}
      onChange={(event) => setCustom((current) => ({ ...current, [question.id]: event.target.value }))}
      placeholder={placeholder}
    />
  )
}

function TextQuestion({ question, answers, setAnswers }: QuestionControlProps) {
  const value = answers[question.id] || ''
  const onChange = (next: string) => setAnswers((current) => ({ ...current, [question.id]: next }))
  if (question.isSecret || question.type === 'password')
    return (
      <Input
        required={question.required}
        aria-label={question.question}
        type="password"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  if (question.type === 'textarea' || (question.type === undefined && question.multiline !== false))
    return (
      <Textarea
        required={question.required}
        aria-label={question.question}
        className="min-h-20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  return (
    <Input
      required={question.required}
      aria-label={question.question}
      type={typedInputType(question.type)}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function typedInputType(type: InputQuestion['type']) {
  return type === 'number' || type === 'date' || type === 'email' || type === 'url' ? type : 'text'
}
