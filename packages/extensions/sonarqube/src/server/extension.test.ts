import { describe, expect, it } from 'vite-plus/test'
import { migrateSonarQubeConfig } from './extension.ts'

describe('SonarQube configuration migration', () => {
  it('rewrites the earlier single project key to the canonical project list', () => {
    expect(
      migrateSonarQubeConfig({
        url: 'https://sonar.example/',
        projectKey: ' checkout ',
        token: 'secret',
      }),
    ).toEqual({
      url: 'https://sonar.example',
      projectKeys: ['checkout'],
      token: 'secret',
    })
  })
})
