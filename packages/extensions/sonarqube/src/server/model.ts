import {
  firstProviderValue as firstValue,
  providerRecord as sonarRecord,
  providerText as textValue,
  providerValues as values,
  type ProviderDataRecord,
} from '@vertexade/platform-server/provider-data'

export type SonarQubeConfig = {
  url: string
  projectKeys: string[]
  token: string
}

export type SonarValue = ProviderDataRecord

export { sonarRecord }

function optionalNumber(...candidates: unknown[]) {
  return Number(firstValue(...candidates) ?? 0) || null
}

function plainText(value: unknown) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function sonarProject(value: unknown) {
  const project = sonarRecord(value)
  return {
    key: String(project.key || ''),
    name: String(project.name || project.key || ''),
    qualifier: String(project.qualifier || 'TRK'),
    visibility: String(project.visibility || ''),
    last_analysis_date: String(project.lastAnalysisDate || ''),
  }
}

export function sonarFinding(issue: SonarValue, config: SonarQubeConfig) {
  const component = String(issue.component || '')
  const inferredProject = config.projectKeys.find((key) => component.startsWith(`${key}:`))
  const project = textValue(issue.project, inferredProject, config.projectKeys[0])

  return {
    id: String(issue.key),
    key: String(issue.key),
    title: textValue(issue.message, 'SonarQube issue'),
    message: component,
    severity: textValue(issue.severity, issue.impacts?.[0]?.severity, 'MAJOR'),
    status: textValue(issue.issueStatus, issue.status),
    type: textValue(issue.type, issue.impacts?.[0]?.softwareQuality),
    line: optionalNumber(issue.line, issue.textRange?.startLine),
    effort: textValue(issue.effort, issue.debt),
    created_at: textValue(issue.creationDate),
    updated_at: textValue(issue.updateDate),
    project,
    link: `${config.url}/project/issues?id=${encodeURIComponent(project)}&issues=${encodeURIComponent(issue.key)}&open=${encodeURIComponent(issue.key)}`,
  }
}

function normalizeLocation(value: unknown) {
  const location = sonarRecord(value)
  const range = sonarRecord(location.textRange)
  return {
    component: String(location.component || ''),
    message: String(location.msg || location.message || ''),
    start_line: Number(range.startLine || 0),
    end_line: Number(range.endLine || range.startLine || 0),
    start_offset: Number(range.startOffset || 0),
    end_offset: Number(range.endOffset || 0),
  }
}

function issueAssignee(issue: SonarValue) {
  return issue.assignee ? { name: String(issue.assignee), email: '', type: 'user' } : null
}

function issueImpacts(issue: SonarValue) {
  return values(issue.impacts)
    .map(sonarRecord)
    .map((impact) => ({
      quality: String(impact.softwareQuality || ''),
      severity: String(impact.severity || ''),
    }))
}

function issueComments(issue: SonarValue) {
  return values(issue.comments)
    .map(sonarRecord)
    .map((comment) => ({
      key: String(comment.key || ''),
      login: String(comment.login || ''),
      markdown: String(comment.markdown || comment.htmlText || ''),
      created_at: String(comment.createdAt || ''),
    }))
}

function issueFlows(issue: SonarValue) {
  return values(issue.flows)
    .map(sonarRecord)
    .map((flow) => ({
      description: String(flow.description || ''),
      locations: values(flow.locations).map(normalizeLocation),
    }))
}

function ruleDetails(rule: SonarValue, ruleKey: string) {
  if (!Object.keys(rule).length) return null
  const tags = [...values(rule.tags), ...values(rule.sysTags)].map(String)

  return {
    key: textValue(rule.key, ruleKey),
    name: textValue(rule.name),
    language: textValue(rule.langName, rule.lang),
    severity: textValue(rule.severity),
    type: textValue(rule.type),
    status: textValue(rule.status),
    description: plainText(firstValue(rule.mdDesc, rule.htmlDesc)),
    tags: [...new Set(tags)],
  }
}

function sourceDetails(source: SonarValue) {
  return values(source.sources)
    .map(sonarRecord)
    .map((sourceLine) => ({
      line: Number(sourceLine.line || 0),
      code: plainText(sourceLine.code || ''),
      scm_author: String(sourceLine.scmAuthor || ''),
      scm_date: String(sourceLine.scmDate || ''),
      duplicated: Boolean(sourceLine.duplicated),
      is_new: Boolean(sourceLine.isNew),
    }))
}

function changelogDetails(changelog: SonarValue) {
  return values(changelog.changelog)
    .map(sonarRecord)
    .map((item) => ({
      created_at: String(item.creationDate || ''),
      user: String(item.userName || item.user || ''),
      avatar: String(item.avatar || ''),
      diffs: values(item.diffs)
        .map(sonarRecord)
        .map((diff) => ({
          key: String(diff.key || ''),
          old_value: String(diff.oldValue || ''),
          new_value: String(diff.newValue || ''),
        })),
    }))
}

type SonarFindingDetailsInput = {
  issue: SonarValue
  component: SonarValue
  projectComponent: SonarValue
  rule: SonarValue
  changelog: SonarValue
  source: SonarValue
  detailErrors: string[]
  config: SonarQubeConfig
}

export function sonarFindingDetails({
  issue,
  component,
  projectComponent,
  rule,
  changelog,
  source,
  detailErrors,
  config,
}: SonarFindingDetailsInput) {
  const ruleKey = String(issue.rule || '')
  return {
    ...sonarFinding(issue, config),
    rule_key: ruleKey,
    component: String(issue.component || ''),
    component_name: String(component.name || component.longName || issue.component || ''),
    project_name: String(projectComponent.name || issue.project || ''),
    author: String(issue.author || ''),
    assignee: issueAssignee(issue),
    clean_code_attribute: String(issue.cleanCodeAttribute || rule.cleanCodeAttribute || ''),
    impacts: issueImpacts(issue),
    labels: values(issue.tags).map(String),
    comments: issueComments(issue),
    flows: issueFlows(issue),
    rule: ruleDetails(rule, ruleKey),
    source: sourceDetails(source),
    changelog: changelogDetails(changelog),
    detail_errors: detailErrors.filter(Boolean),
  }
}
