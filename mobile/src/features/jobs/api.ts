import { Platform } from 'react-native';
import { authClient } from '@/lib/auth-client';

export type Job = {
  id: string; title: string; generalRemarks: string | null;
  priority: 'low' | 'medium' | 'high' | null; jobComplete: boolean | null;
  version: number; updatedAt: string;
};
export type JobInput = Pick<Job, 'title' | 'generalRemarks' | 'priority' | 'jobComplete'>;

async function request<T>(path: string, method = 'GET', body?: JobInput): Promise<T> {
  const cookie = Platform.OS === 'web' ? undefined : await authClient.getCookie();
  const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'}/api/jobs${path}`, {
    method, credentials: Platform.OS === 'web' ? 'include' : 'omit',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || 'Could not save or load jobs. Please try again.');
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const jobsApi = {
  list: () => request<Job[]>(''),
  get: (id: string) => request<Job>(`/${encodeURIComponent(id)}`),
  create: (body: JobInput) => request<Job>('', 'POST', body),
  update: (id: string, body: JobInput) => request<Job>(`/${encodeURIComponent(id)}`, 'PATCH', body),
  delete: (id: string) => request<void>(`/${encodeURIComponent(id)}`, 'DELETE'),
};
