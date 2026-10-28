import { useCallback, useEffect, useState } from "react";
import type { PageResult } from "../features/interviewStudy/types";
import { apiFetch } from "../auth/api";

type CollectionState<T> = {
  items: T[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  save: (item: Partial<T> & { id?: string }) => Promise<T>;
  restore: (item: T) => Promise<T>;
  remove: (id: string) => Promise<void>;
};

function useCollection<T extends { id: string }>(resource: "interviews" | "study-items"): CollectionState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch(`/api/${resource}?limit=100`);
      if (!response.ok) throw new Error(`Could not load ${resource}.`);
      const result = await response.json() as PageResult<T>;
      const remainingPages = await Promise.all(Array.from({ length: Math.max(0, result.pages - 1) }, async (_, index) => {
        const page = await apiFetch(`/api/${resource}?limit=100&page=${index + 2}`);
        if (!page.ok) throw new Error(`Could not load page ${index + 2} of ${resource}.`);
        return (await page.json() as PageResult<T>).items;
      }));
      setItems([...result.items, ...remainingPages.flat()]);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not load ${resource}.`);
    } finally {
      setLoading(false);
    }
  }, [resource]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (item: Partial<T> & { id?: string }) => {
    const method = item.id ? "PUT" : "POST";
    const response = await apiFetch(`/api/${resource}${item.id ? `/${encodeURIComponent(item.id)}` : ""}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(item),
    });
    const body = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Save failed. Please check the entered details.");
    await refresh();
    return body;
  }, [refresh, resource]);

  const restore = useCallback(async (item: T) => {
    const response = await apiFetch(`/api/${resource}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(item),
    });
    const body = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Could not undo deletion.");
    await refresh();
    return body;
  }, [refresh, resource]);

  const remove = useCallback(async (id: string) => {
    const response = await apiFetch(`/api/${resource}/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? "Delete failed.");
    }
    await refresh();
  }, [refresh, resource]);

  return { items, loading, error, refresh, save, restore, remove };
}

export function useInterviews() {
  return useCollection<import("../features/interviewStudy/types").Interview>("interviews");
}

export function useStudyItems() {
  return useCollection<import("../features/interviewStudy/types").StudyItem>("study-items");
}
