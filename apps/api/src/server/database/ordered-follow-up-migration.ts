export const orderedFollowUpMigration = {
  version: 43,
  name: 'ordered-job-follow-up-queue',
  migrate(database: { exec(sql: string): unknown }) {
    database.exec(`
      ALTER TABLE job_follow_up_queue ADD COLUMN position INTEGER;
      UPDATE job_follow_up_queue SET position=id WHERE position IS NULL;
      DROP INDEX job_follow_up_queue_position;
      CREATE INDEX job_follow_up_queue_position ON job_follow_up_queue(job_id,status,position,id);
    `)
  },
}
