import type { ContextData } from "./types";
import type { Row } from "./lib/form";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public field?: string,
  ) {
    super(message);
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw new ApiError("Cannot reach the server. Is the API running?", 0);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new ApiError(data?.message ?? `Request failed (${res.status})`, res.status, data?.field);
  return data as T;
}

// Data layer isolated — baaki UI sirf in functions ko jaanti hai.
export const api = {
  context: () => req<ContextData>("/api/context"),
};

// Har master ke liye ek hi generic CRUD — key = shared/masters.ts ka key
export const masterApi = (key: string) => ({
  list: (companyId: number) => req<Row[]>(`/api/masters/${key}?companyId=${companyId}`),
  create: (companyId: number, v: Record<string, unknown>) =>
    req<Row>(`/api/masters/${key}?companyId=${companyId}`, { method: "POST", body: JSON.stringify(v) }),
  update: (id: number, v: Record<string, unknown>) => req<Row>(`/api/masters/${key}/${id}`, { method: "PUT", body: JSON.stringify(v) }),
  remove: (id: number) => req<{ ok: true }>(`/api/masters/${key}/${id}`, { method: "DELETE" }),
});
