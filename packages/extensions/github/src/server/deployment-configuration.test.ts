import { describe, expect, it } from 'vite-plus/test'
import { defaultGitHubDeploymentTargets, matchDeploymentJob, normalizeGitHubDeploymentTargets } from './deployment-configuration.ts'

describe('GitHub deployment configuration', () => {
  it('normalizes multiple targets and matches jobs with the safe template placeholders', () => {
    const targets = normalizeGitHubDeploymentTargets([
      {
        id: 'payments',
        label: 'Payments',
        repository: 'acme/payments',
        workflow: 'deploy.yml',
        branch: 'release',
        event: 'workflow_dispatch',
        services: ['api'],
        environments: ['test', 'production'],
        production_environment: 'production',
        comparison_environment: 'test',
        job_name_template: 'Ship {service} through {*} to {environment}',
      },
    ])

    expect(targets[0]).toMatchObject({ id: 'payments', productionEnvironment: 'production', comparisonEnvironment: 'test' })
    expect(matchDeploymentJob('Ship api through release gate to production', targets[0])).toEqual({
      service: 'api',
      environment: 'production',
    })
  })

  it('retains the existing environment-variable defaults', () => {
    expect(
      defaultGitHubDeploymentTargets({
        DEPLOYMENT_REPOSITORY: 'acme/platform',
        DEPLOYMENT_WORKFLOW: 'release.yml',
        DEPLOYMENT_ENVIRONMENTS: 'dev,prod',
      })[0],
    ).toMatchObject({
      repository: 'acme/platform',
      workflow: 'release.yml',
      environments: ['dev', 'prod'],
      productionEnvironment: 'prod',
      comparisonEnvironment: 'dev',
    })
  })

  it('rejects invalid environment references and unsafe free-form target values', () => {
    expect(() =>
      normalizeGitHubDeploymentTargets([
        {
          id: 'one',
          repository: 'not-a-repository',
          workflow: 'deploy.yml',
          environments: ['dev'],
          production_environment: 'prod',
        },
      ]),
    ).toThrow()
    expect(() =>
      normalizeGitHubDeploymentTargets([
        {
          id: 'one',
          repository: 'acme/repo',
          workflow: 'deploy.yml',
          environments: ['dev'],
          job_name_template: 'Deploy {service}',
        },
      ]),
    ).toThrow('exactly one')
    expect(() =>
      normalizeGitHubDeploymentTargets([
        {
          id: 'one',
          repository: 'acme/repo',
          workflow: 'deploy.yml',
          environments: ['dev'],
          job_name_template: 'Deploy {service} {*} {*} to {environment}',
        },
      ]),
    ).toThrow('at most one')
  })

  it('rejects unexpectedly large provider job names before regular-expression matching', () => {
    const target = normalizeGitHubDeploymentTargets([
      {
        id: 'one',
        repository: 'acme/repo',
        workflow: 'deploy.yml',
        environments: ['dev'],
        job_name_template: 'Deploy {service} to {environment}',
      },
    ])[0]
    expect(matchDeploymentJob(`Deploy ${'x'.repeat(600)} to dev`, target)).toBeNull()
  })
})
