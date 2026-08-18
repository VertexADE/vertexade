import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vite-plus/test'
import { drizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { InvalidJobTransitionError, JobLifecycle } from './job-lifecycle.ts'

function jobDatabase(status = 'starting') {
  const database = new DatabaseSync(':memory:')
  database.exec(`CREATE TABLE jobs (
    id INTEGER PRIMARY KEY, status TEXT NOT NULL, pid INTEGER, agent_id TEXT, pid_start_identity TEXT,
    exit_code INTEGER, latest_activity TEXT, activity_at TEXT, turn_started_at TEXT, finished_at TEXT, result_text TEXT,
    input_request_id TEXT, input_questions TEXT, input_requested_at TEXT
  )`)
  database.prepare('INSERT INTO jobs (id,status,result_text) VALUES (1,?,?)').run(status, 'result')
  return database
}

describe('JobLifecycle', () => {
  it('moves a launched job through running and completed states', () => {
    const database = jobDatabase()
    const lifecycle = new JobLifecycle(drizzleDashboardDatabase(database))

    lifecycle.markRunning(1, { pid: 42, agentId: 'codex' })
    lifecycle.markFinished(1, 0, '')

    expect(database.prepare('SELECT status,pid,agent_id,exit_code,turn_started_at FROM jobs WHERE id=1').get()).toEqual({
      status: 'completed',
      pid: 42,
      agent_id: 'codex',
      exit_code: 0,
      turn_started_at: expect.any(String),
    })
  })

  it('clears interaction state when a process fails', () => {
    const database = jobDatabase('running')
    database.prepare('UPDATE jobs SET input_request_id=?,input_questions=?,input_requested_at=? WHERE id=1').run('request', '[]', 'now')
    const lifecycle = new JobLifecycle(drizzleDashboardDatabase(database))

    lifecycle.markFailed(1, 'agent crashed')

    expect(
      database.prepare('SELECT status,latest_activity,input_request_id,input_questions,input_requested_at FROM jobs WHERE id=1').get(),
    ).toEqual({
      status: 'failed',
      latest_activity: 'agent crashed',
      input_request_id: null,
      input_questions: null,
      input_requested_at: null,
    })
  })

  it('rejects a terminal job regressing directly to failed', () => {
    const lifecycle = new JobLifecycle(drizzleDashboardDatabase(jobDatabase('completed')))
    expect(() => lifecycle.markFailed(1, 'late error')).toThrow(InvalidJobTransitionError)
  })

  it('records a user cancellation and allows a later explicit retry', () => {
    const databaseInstance = jobDatabase('running')
    const lifecycle = new JobLifecycle(drizzleDashboardDatabase(databaseInstance))
    lifecycle.markCancelled(1)
    expect(databaseInstance.prepare('SELECT status,latest_activity,finished_at FROM jobs WHERE id=1').get()).toMatchObject({
      status: 'cancelled',
      latest_activity: 'Stopped by user',
    })
    lifecycle.markStarting(1, 'Retrying stopped run')
    expect(databaseInstance.prepare('SELECT status,latest_activity FROM jobs WHERE id=1').get()).toEqual({
      status: 'starting',
      latest_activity: 'Retrying stopped run',
    })
  })

  it('allows an explicit follow-up to restart a completed job', () => {
    const databaseInstance = jobDatabase('completed')
    const lifecycle = new JobLifecycle(drizzleDashboardDatabase(databaseInstance))
    lifecycle.markStarting(1, 'Starting follow-up', { clearResult: true })
    expect(databaseInstance.prepare('SELECT status,result_text FROM jobs WHERE id=1').get()).toEqual({
      status: 'starting',
      result_text: null,
    })
  })

  it('claims a terminal job exactly once and can restore it after launch failure', () => {
    const databaseInstance = jobDatabase('completed')
    const lifecycle = new JobLifecycle(drizzleDashboardDatabase(databaseInstance))
    expect(lifecycle.claimStarting(1, 'Preparing follow-up')).toBe(true)
    expect(() => lifecycle.claimStarting(1, 'Duplicate follow-up')).toThrow(InvalidJobTransitionError)
    lifecycle.restore(1, { status: 'completed', activity: 'Done', finishedAt: '2026-07-21' })
    expect(databaseInstance.prepare('SELECT status,latest_activity,finished_at FROM jobs WHERE id=1').get()).toEqual({
      status: 'completed',
      latest_activity: 'Done',
      finished_at: '2026-07-21',
    })
  })
})
