import type { Dispatch, SetStateAction } from 'react'
import type { FileReference } from '@vertexade/ui/components/markdown-content'
import type { ReviewSuggestion } from '@vertexade/ui/components/thread-review-suggestions'
import type { InputQuestion, Job, JobLog } from '@vertexade/ui/lib/dashboard-types'

export type ThreadPanelActionOptions = {
  jobId: number | null
  job: JobLog | null
  setJob: Dispatch<SetStateAction<JobLog | null>>
  questions: InputQuestion[]
  suggestions: ReviewSuggestion[]
  setSuggestions: Dispatch<SetStateAction<ReviewSuggestion[]>>
  setFileReference: Dispatch<SetStateAction<FileReference | null>>
  setActiveTab: Dispatch<SetStateAction<string | null>>
  setChangesActive: Dispatch<SetStateAction<boolean>>
  onReviewStarted?(job: Job): void
}
