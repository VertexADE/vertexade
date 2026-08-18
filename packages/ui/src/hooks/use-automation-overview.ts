import { useEffect, useMemo, useState } from 'react'
import type { AutomationAuditEvent, AutomationFlowRun, AutomationRecipe, CapabilityExecution } from '@vertexade/platform-contracts'
import { automationCapabilities, automationTemplates } from '../components/automation-recipes-model'
import {
  eventIsAutomation,
  recipeTemplates,
  type AutomationRuntimeStatus,
  type CapabilityResponse,
} from '@vertexade/ui/components/automation-recipe-editor'
import { useReactiveApi } from '@vertexade/ui/hooks/use-reactive-api'
import { api } from '@vertexade/ui/lib/dashboard-api'

type AutomationOverviewResponse = {
  catalog: CapabilityResponse
  recipeResult: { recipes: AutomationRecipe[] }
  runResult: { runs: AutomationFlowRun[] }
  executionResult: { executions: CapabilityExecution[] }
  auditResult: { events: AutomationAuditEvent[] }
  runtimeResult: AutomationRuntimeStatus
}

async function loadAutomationOverview(): Promise<AutomationOverviewResponse> {
  const [catalog, recipeResult, runResult, executionResult, auditResult, runtimeResult] = await Promise.all([
    api<CapabilityResponse>('/api/capabilities'),
    api<{ recipes: AutomationRecipe[] }>('/api/automation-recipes'),
    api<{ runs: AutomationFlowRun[] }>('/api/automation-runs?limit=20'),
    api<{ executions: CapabilityExecution[] }>('/api/capability-executions?limit=20'),
    api<{ events: AutomationAuditEvent[] }>('/api/automation-audit?limit=40'),
    api<AutomationRuntimeStatus>('/api/automation-runtime'),
  ])
  return { catalog, recipeResult, runResult, executionResult, auditResult, runtimeResult }
}

export function useAutomationOverview() {
  const query = useReactiveApi({ key: 'automation-overview', load: loadAutomationOverview, accepts: eventIsAutomation })
  const [runtime, setRuntime] = useState<AutomationRuntimeStatus | null>(null)

  useEffect(() => {
    if (query.data) setRuntime(query.data.runtimeResult)
  }, [query.data])
  const projection = useMemo(() => {
    if (!query.data)
      return {
        capabilities: [],
        templates: recipeTemplates,
        recipes: [],
        runs: [],
        executions: [],
        auditEvents: [],
      }
    return {
      capabilities: automationCapabilities(query.data.catalog),
      templates: automationTemplates(query.data.catalog),
      recipes: query.data.recipeResult.recipes,
      runs: query.data.runResult.runs,
      executions: query.data.executionResult.executions,
      auditEvents: query.data.auditResult.events,
    }
  }, [query.data])

  return {
    ...projection,
    runtime,
    setRuntime,
    load: query.refresh,
    loading: query.loading,
    error: query.error,
    ready: query.ready,
    updatedAt: query.updatedAt,
  }
}
