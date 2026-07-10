export const API_BASE = "/api";

// ── Fetch helpers ───────────────────────────────────────────────────

async function fetchJson<T>(
  endpoint: string,
  options: RequestInit | undefined,
  opts: { credentials?: boolean; unwrapData?: boolean }
): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options?.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    ...(opts.credentials ? { credentials: "include" } : {}), // send HttpOnly cookie automatically
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const json = await response.json();
  return opts.unwrapData ? (json.data !== undefined ? json.data : json) : json;
}

export async function fetchSetupAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  return fetchJson<T>(endpoint, options, { unwrapData: true });
}

export async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  return fetchJson<T>(endpoint, options, { credentials: true });
}

// ── Auth ────────────────────────────────────────────────────────────

/** Check if session cookie is valid */
export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch("/auth/check", { credentials: "include" });
    const data = await res.json();
    return data.success && data.data?.authenticated;
  } catch {
    return false;
  }
}

/** Login with token — server sets HttpOnly cookie */
export async function login(token: string): Promise<boolean> {
  try {
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Logout — server clears cookie */
export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
}
