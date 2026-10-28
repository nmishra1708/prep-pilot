import { useCallback, useEffect, useState } from "react";
import { deleteApplication, listApplications, putApplication } from "../jobs/applications-storage";
import type { ApplicationRecord, Job, JobStatus } from "../jobs/types";

function sortApplications(records: ApplicationRecord[]) {
  return [...records].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function useApplications() {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setApplications(sortApplications(await listApplications()));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load saved applications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsert = useCallback(async (
    job: Job,
    status: JobStatus,
    changes: Partial<Pick<ApplicationRecord, "appliedAt" | "notes" | "savedAt">> = {},
  ) => {
    const existing = applications.find((item) => item.job.id === job.id);
    const now = new Date().toISOString();
    const next: ApplicationRecord = {
      job,
      status,
      savedAt: changes.savedAt ?? existing?.savedAt ?? now,
      appliedAt: changes.appliedAt === undefined ? existing?.appliedAt ?? null : changes.appliedAt,
      notes: changes.notes ?? existing?.notes ?? "",
      updatedAt: now,
    };
    try {
      await putApplication(next);
      setApplications((current) => sortApplications([
        ...current.filter((item) => item.job.id !== job.id),
        next,
      ]));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this application.");
      throw reason;
    }
    return next;
  }, [applications]);

  const remove = useCallback(async (jobId: string) => {
    try {
      await deleteApplication(jobId);
      setApplications((current) => current.filter((item) => item.job.id !== jobId));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove this application.");
      throw reason;
    }
  }, []);

  return { applications, loading, error, refresh, upsert, remove };
}
