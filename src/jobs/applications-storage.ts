import type { ApplicationRecord } from "./types";
import { getCurrentUserId, scopedDatabaseName } from "../storage/userScope";

const DATABASE = "say-it-job-tracker";
const STORE = "applications";
const VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Local application storage is not available in this browser."));
      return;
    }
    const request = indexedDB.open(scopedDatabaseName(DATABASE), VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "job.id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open application storage."));
  });
}

export async function listApplications(): Promise<ApplicationRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result as ApplicationRecord[]);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Could not load applications."));
    };
  });
}

export async function putApplication(record: ApplicationRecord): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put({ ...record, userId: getCurrentUserId() ?? undefined });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save this application."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Application save was cancelled."));
  }).finally(() => db.close());
}

export async function deleteApplication(jobId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(jobId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove this application."));
  }).finally(() => db.close());
}
