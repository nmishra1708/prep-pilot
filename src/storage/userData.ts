import { deleteUserBrowserData as deleteBrowserDatabases } from "./legacyMigration";
import { listApplications } from "../jobs/applications-storage";
import { listInterviews } from "../interview/storage";
import { apiFetch } from "../auth/api";

async function serializeBlobs(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
    }
    return { type: value.type, size: value.size, base64: btoa(binary) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(serializeBlobs));
  if (value && typeof value === "object") {
    return Object.fromEntries(await Promise.all(
      Object.entries(value).map(async ([key, item]) => [key, await serializeBlobs(item)]),
    ));
  }
  return value;
}

export async function exportUserData(userId: string) {
  const response = await apiFetch("/api/data/export");
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error ?? "Could not export account data.");
  }
  const serverData = await response.json();
  const [interviews, applications] = await Promise.all([listInterviews(), listApplications()]);
  const preferences = Object.fromEntries(Object.keys(localStorage)
    .filter((key) => key.endsWith(`-${userId}`) || key.includes(`-${userId}-`))
    .map((key) => [key, localStorage.getItem(key)]));
  return serializeBlobs({
    exportedAt: new Date().toISOString(),
    userId,
    serverData,
    mockInterviewSessions: interviews,
    jobApplications: applications,
    localPreferences: preferences,
  });
}

export async function deleteUserBrowserData(userId: string) {
  await deleteBrowserDatabases(userId);
  for (const key of Object.keys(localStorage)) {
    if (key.endsWith(`-${userId}`) || key.includes(`-${userId}-`)) localStorage.removeItem(key);
  }
}
