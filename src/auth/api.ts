let refreshInFlight: Promise<boolean> | null = null;
const publicAuthPaths = new Set([
  "/api/auth/csrf",
  "/api/auth/signup",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/refresh",
  "/api/auth/verify-email",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
]);

function csrfCookie() {
  const entry = document.cookie.split("; ").find((cookie) => cookie.startsWith("csrf_token="));
  return entry ? decodeURIComponent(entry.slice("csrf_token=".length)) : "";
}

async function getCsrfToken() {
  const existing = csrfCookie();
  if (existing) return existing;
  const response = await fetch("/api/auth/csrf", { credentials: "include" });
  if (!response.ok) throw new Error("Could not initialize a secure session. Reload the page and try again.");
  const result = await response.json() as { csrfToken?: string };
  return result.csrfToken ?? csrfCookie();
}

function isStateChanging(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

async function request(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = init.method ?? (input instanceof Request ? input.method : "GET");
  const headers = new Headers(init.headers);
  if (isStateChanging(method)) headers.set("X-CSRF-Token", await getCsrfToken());
  return fetch(input, { ...init, method, headers, credentials: "include" });
}

async function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = request("/api/auth/refresh", { method: "POST" })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => { refreshInFlight = null; });
  }
  const refreshed = await refreshInFlight;
  if (!refreshed && typeof window !== "undefined") window.dispatchEvent(new Event("auth:expired"));
  return refreshed;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const isPublicAuthEndpoint = publicAuthPaths.has(new URL(url, window.location.origin).pathname);
  const response = await request(input, init);
  if (response.status !== 401 || isPublicAuthEndpoint) return response;
  if (!await refreshSession()) return response;
  return request(input, init);
}

export async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "The request could not be completed.");
  return body;
}
