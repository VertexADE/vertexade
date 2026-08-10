import { ArchitectureContextPanel } from '@vertexade/ui/components/architecture-context-panel'
import { ImpactAnalysisPanel } from '@vertexade/ui/components/impact-analysis-panel'
import { PullRequestEvidencePanel } from '@vertexade/ui/components/pull-request-evidence-panel'
import { TestIntelligencePanel } from '@vertexade/ui/components/test-intelligence-panel'

type PullRequestIntelligenceTabProps = {
  tab: 'impact' | 'evidence'
  repositoryId: number
  pullRequestNumber: number
  onNavigate?(tab: 'impact' | 'conversation'): void
}

export default function PullRequestIntelligenceTab({ tab, repositoryId, pullRequestNumber, onNavigate }: PullRequestIntelligenceTabProps) {
  if (tab === 'evidence') {
    return (
      <PullRequestEvidencePanel
        repositoryId={repositoryId}
        pullRequestNumber={pullRequestNumber}
        onOpenImpact={() => onNavigate?.('impact')}
        onOpenDiscussion={() => onNavigate?.('conversation')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ImpactAnalysisPanel repositoryId={repositoryId} pullRequestNumber={pullRequestNumber} />
      <ArchitectureContextPanel repositoryId={repositoryId} pullRequestNumber={pullRequestNumber} />
      <TestIntelligencePanel repositoryId={repositoryId} pullRequestNumber={pullRequestNumber} />
    </div>
  )
}
