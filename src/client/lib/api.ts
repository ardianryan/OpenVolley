export class ApiError extends Error {
  status: number;
  retryAfterSec?: number;

  constructor(message: string, status: number, retryAfterSec?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options?.headers,
      },
    });
  } catch {
    throw new ApiError(
      typeof navigator !== 'undefined' && !navigator.onLine
        ? 'Koneksi internet perangkat Anda sedang terputus'
        : 'Tidak dapat terhubung ke server turnamen',
      0
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const retryHeader = res.headers.get('retry-after');
    const retrySec = retryHeader ? Number(retryHeader) : undefined;
    throw new ApiError(
      (data as { error?: string }).error || `Permintaan gagal (${res.status})`,
      res.status,
      Number.isFinite(retrySec) ? retrySec : undefined
    );
  }
  return data as T;
}
