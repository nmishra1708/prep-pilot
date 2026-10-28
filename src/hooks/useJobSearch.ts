import { apiFetch } from "../auth/api";
import { useCallback, useState } from "react";
import { normaliseJob, toSearchParams } from "../jobs/search";
import type { Job, JobSearchFilters, JobSearchResponse } from "../jobs/types";

interface ApiError {
  error?: string;
  message?: string;
}

export function useJobSearch() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [searchesUsed, setSearchesUsed] = useState<number | null>(null);
  const [source, setSource] = useState<"serpapi" | "mock" | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const request = useCallback(async (filters: JobSearchFilters, append: boolean, token?: string | null) => {
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setJobs([]);
      setNextPageToken(null);
    }
    setError(null);
    setStatusMessage("");
    try {
      const params = toSearchParams(filters, token);
      const response = await apiFetch(`/api/jobs/search?${params.toString()}`, { signal: AbortSignal.timeout(15_000) });
      let payload: JobSearchResponse & ApiError;
      try {
        payload = await response.json() as JobSearchResponse & ApiError;
      } catch {
        throw new Error("The job search service returned an unreadable response. Retry the search.");
      }
      if (!response.ok) throw new Error(payload.error ?? "Job search failed. Please retry.");
      const normalized = (payload.jobs ?? []).map(normaliseJob);
      setJobs((current) => append
        ? [...current, ...normalized.filter((job) => !current.some((item) => item.id === job.id))]
        : normalized);
      setNextPageToken(payload.nextPageToken ?? null);
      setSearchesUsed(payload.searchesUsed ?? null);
      setSource(payload.source ?? null);
      setStatusMessage(normalized.length ? `${append ? "Loaded" : "Found"} ${normalized.length} job${normalized.length === 1 ? "" : "s"}.` : "No jobs matched. Try broadening your search.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Job search failed. Please retry.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const search = useCallback((filters: JobSearchFilters) => request(filters, false), [request]);
  const loadMore = useCallback((filters: JobSearchFilters) => {
    if (!nextPageToken) return Promise.resolve();
    return request(filters, true, nextPageToken);
  }, [nextPageToken, request]);

  return { jobs, nextPageToken, searchesUsed, source, loading, loadingMore, error, statusMessage, search, loadMore };
}
