import {
  cleanupExpiredReleases,
  deleteExpiredAuditRecords,
} from "./release-cleanup";

export const MAXIMUM_RELEASES_PER_SWEEP = 100;

export interface ScheduledMaintenanceEnvironment {
  RELEASE_DB: D1Database;
  RELEASE_DOCUMENTS: R2Bucket;
}

export interface ScheduledMaintenanceSummary {
  releasesExamined: number;
  releasesCompleted: number;
  releasesFailed: number;
  releasesSkipped: number;
  auditRecordsDeleted: number;
}

export async function runScheduledMaintenance(
  environment: ScheduledMaintenanceEnvironment,
  now: number,
): Promise<ScheduledMaintenanceSummary> {
  const results = await cleanupExpiredReleases(
    environment.RELEASE_DB,
    environment.RELEASE_DOCUMENTS,
    now,
    MAXIMUM_RELEASES_PER_SWEEP,
  );
  const auditRecordsDeleted = await deleteExpiredAuditRecords(environment.RELEASE_DB, now);

  return {
    releasesExamined: results.length,
    releasesCompleted: results.filter(({ outcome }) =>
      outcome === "completed" || outcome === "already_completed").length,
    releasesFailed: results.filter(({ outcome }) => outcome === "failed").length,
    releasesSkipped: results.filter(({ outcome }) =>
      outcome === "not_due" || outcome === "not_found").length,
    auditRecordsDeleted,
  };
}
