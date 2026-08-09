import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { parseSonarQubeComment, PullRequestCommentBody } from '@vertexade/ui/components/sonarqube-comment'

const sonarCloudComment = [
  `## [![Quality Gate Passed](https://sonarsource.github.io/sonarcloud-github-static-resources/v2/checks/QualityGateBadge/qg-passed-20px.png 'Quality Gate Passed')](https://sonarcloud.io/dashboard?id=vertexade_vertexade&pullRequest=299) **Quality Gate passed**  `,
  'Issues  ',
  `![](https://sonarsource.github.io/sonarcloud-github-static-resources/v2/common/passed-16px.png '') [0 New issues](https://sonarcloud.io/project/issues?id=vertexade_vertexade&pullRequest=299&issueStatuses=OPEN,CONFIRMED&sinceLeakPeriod=true)  `,
  `![](https://sonarsource.github.io/sonarcloud-github-static-resources/v2/common/accepted-16px.png '') [0 Accepted issues](https://sonarcloud.io/project/issues?id=vertexade_vertexade&pullRequest=299&issueStatuses=ACCEPTED)`,
  '',
  'Measures  ',
  `![](https://sonarsource.github.io/sonarcloud-github-static-resources/v2/common/passed-16px.png '') [0 Security Hotspots](https://sonarcloud.io/project/security_hotspots?id=vertexade_vertexade&pullRequest=299&issueStatuses=OPEN,CONFIRMED&sinceLeakPeriod=true)  `,
  `![](https://sonarsource.github.io/sonarcloud-github-static-resources/v2/common/passed-16px.png '') [0.0% Coverage on New Code](https://sonarcloud.io/component_measures?id=vertexade_vertexade&pullRequest=299&metric=new_coverage&view=list)  `,
  `![](https://sonarsource.github.io/sonarcloud-github-static-resources/v2/common/passed-16px.png '') [0.0% Duplication on New Code](https://sonarcloud.io/component_measures?id=vertexade_vertexade&pullRequest=299&metric=new_duplicated_lines_density&view=list)  `,
  '  ',
  '<!-- sqra-placement-anchor -->',
  '[See analysis details on SonarQube Cloud](https://sonarcloud.io/dashboard?id=vertexade_vertexade&pullRequest=299)',
].join('\n')

describe('SonarQube comments', () => {
  it('extracts the quality gate, issue counts, and measures from the live SonarCloud template', () => {
    const summary = parseSonarQubeComment('sonarqubecloud', sonarCloudComment)

    expect(summary).toMatchObject({
      gate: 'passed',
      analysisUrl: 'https://sonarcloud.io/dashboard?id=vertexade_vertexade&pullRequest=299',
      issues: [
        { value: '0', label: 'New issues', tone: 'success' },
        { value: '0', label: 'Accepted issues', tone: 'neutral' },
      ],
      measures: [
        { value: '0', label: 'Security Hotspots', tone: 'success' },
        { value: '0.0%', label: 'Coverage on New Code', tone: 'success' },
        { value: '0.0%', label: 'Duplication on New Code', tone: 'success' },
      ],
    })
  })

  it('renders recognized bot comments as a compact quality summary', () => {
    const markup = renderToStaticMarkup(<PullRequestCommentBody author="sonarqubecloud" content={sonarCloudComment} />)

    expect(markup).toContain('data-sonarqube-comment="true"')
    expect(markup).toContain('Quality Gate passed')
    expect(markup).toContain('Open analysis')
    expect(markup).toContain('Coverage on New Code')
    expect(markup).not.toContain('qg-passed-20px.png')
  })

  it('preserves the generic Markdown renderer for every other author', () => {
    const markup = renderToStaticMarkup(<PullRequestCommentBody author="octocat" content={sonarCloudComment} />)

    expect(markup).not.toContain('data-sonarqube-comment')
    expect(markup).toContain('qg-passed-20px.png')
    expect(markup).toContain('<h2')
  })

  it('uses a danger state for failed quality gates', () => {
    const failed = sonarCloudComment
      .replaceAll('Quality Gate Passed', 'Quality Gate Failed')
      .replace('Quality Gate passed', 'Quality Gate failed')
    const markup = renderToStaticMarkup(<PullRequestCommentBody author="sonarqubecloud[bot]" content={failed} />)

    expect(markup).toContain('Quality Gate failed')
    expect(markup).toContain('data-tone="danger"')
  })
})
