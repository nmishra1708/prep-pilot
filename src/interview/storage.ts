import type { InterviewReport } from "./types";

import { getCurrentUserId, scopedDatabaseName } from "../storage/userScope";

const DATABASE = "say-it-interviews";
const STORE = "sessions";
const VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Local interview storage is not available in this browser."));
      return;
    }
    const request = indexedDB.open(scopedDatabaseName(DATABASE), VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local interview storage."));
  });
}

export async function saveInterview(report: InterviewReport): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put({ ...report, userId: getCurrentUserId() ?? undefined });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save interview."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Interview save was cancelled."));
  }).finally(() => db.close());
}

export async function listInterviews(): Promise<InterviewReport[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => {
      db.close();
      resolve((request.result as InterviewReport[]).sort((a, b) => b.createdAt - a.createdAt));
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error("Could not load interview history."));
    };
  });
}

export async function deleteAllInterviews(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not delete interview data."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Data deletion was cancelled."));
  }).finally(() => db.close());
}
