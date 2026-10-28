function openDatabase(name: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: storeName === "sessions" ? "id" : "job.id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not read the previous browser data."));
  });
}

function readAll(name: string, store: string) {
  return openDatabase(name, store).then((db) => new Promise<unknown[]>((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).getAll();
    request.onsuccess = () => { db.close(); resolve(request.result as unknown[]); };
    request.onerror = () => { db.close(); reject(request.error ?? new Error("Could not migrate browser data.")); };
  }));
}

async function writeAll(name: string, store: string, values: unknown[]) {
  const db = await openDatabase(name, store);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    values.forEach((value) => transaction.objectStore(store).put(value));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not migrate browser data."));
  }).finally(() => db.close());
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not remove previous browser storage."));
    request.onblocked = () => reject(new Error("Close other Say it. See it. tabs and try again to migrate local data."));
  });
}

function addOwner(record: unknown, userId: string) {
  return record && typeof record === "object" && !Array.isArray(record)
    ? { ...record, userId }
    : record;
}

export async function claimLegacyBrowserData(userId: string) {
  if (!("indexedDB" in window)) return;
  const interviewRecords = await readAll("say-it-interviews", "sessions");
  const applications = await readAll("say-it-job-tracker", "applications");
  if (interviewRecords.length) {
    await writeAll(`say-it-interviews-${userId}`, "sessions", interviewRecords.map((record) => addOwner(record, userId)));
  }
  if (applications.length) {
    await writeAll(`say-it-job-tracker-${userId}`, "applications", applications.map((record) => addOwner(record, userId)));
  }
  await deleteDatabase("say-it-interviews");
  await deleteDatabase("say-it-job-tracker");
}

export async function deleteUserBrowserData(userId: string) {
  if (!("indexedDB" in window)) return;
  await Promise.all([
    deleteDatabase(`say-it-interviews-${userId}`),
    deleteDatabase(`say-it-job-tracker-${userId}`),
  ]);
}
