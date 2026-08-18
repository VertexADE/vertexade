import { lazy } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, FileText, MessageSquareText } from 'lucide-react'
import { LazyBoundary } from '@vertexade/ui/components/lazy-boundary'
import { WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Button } from '@vertexade/ui/components/ui/button'
import { localBackendId } from '@vertexade/ui/lib/backend-registry'

type ThreadDetailSearch = { view?: 'details' }

export const Route = createFileRoute('/threads_/$threadId')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ThreadDetailSearch => ({
    view: search.view === 'details' ? 'details' : undefined,
  }),
  component: ThreadDetailPage,
})

const LazyThreadPanel = lazy(() =>
  import('@vertexade/ui/components/thread-panel').then(({ ThreadPanel }) => ({
    default: ThreadPanel,
  })),
)

function ThreadDetailPage() {
  const { threadId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const jobId = Number(threadId)
  const details = search.view === 'details'

  return (
    <WorkspacePage className="h-[calc(100svh-6.25rem-env(safe-area-inset-bottom))] min-h-0 px-0 py-0 md:h-[calc(100svh-3.25rem)] md:p-4">
      <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background md:rounded-lg md:border md:border-border/55 md:bg-card/10">
        <div className="flex h-10 shrink-0 items-center border-b px-2 md:px-3">
          <Button asChild variant="ghost" size="sm" className="px-2">
            <Link to="/threads">
              <ArrowLeft />
              Threads
            </Link>
          </Button>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">Thread #{localBackendId(jobId)}</span>
          <Button asChild variant="ghost" size="sm" className="ml-1 px-2">
            <Link to="/threads/$threadId" params={{ threadId }} search={details ? {} : { view: 'details' }}>
              {details ? <MessageSquareText /> : <FileText />}
              {details ? 'Conversation' : 'Details'}
            </Link>
          </Button>
        </div>
        <LazyBoundary label="thread conversation" resetKey={threadId}>
          <LazyThreadPanel
            jobId={jobId}
            activityOnly={!details}
            showCompactHeader={!details}
            onClose={() => void navigate({ to: '/threads' })}
            onForked={(job) => void navigate({ to: '/threads/$threadId', params: { threadId: String(job.id) } })}
            onReviewStarted={(job) => void navigate({ to: '/threads/$threadId', params: { threadId: String(job.id) } })}
          />
        </LazyBoundary>
      </section>
    </WorkspacePage>
  )
}
