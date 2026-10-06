import { apiRequest } from "@/lib/api";

export type Job = {
  id: string;
  title: string;
  generalRemarks: string | null;
  priority: "low" | "medium" | "high" | null;
  jobComplete: boolean | null;
  version: number;
  updatedAt: string;
  arrivalTime: string | null;
  distanceKm: number | null;
  tags: string[];
  materials: Material[];
};
export type Material = {
  id: string;
  material: string;
  quantity: number;
  unit: "m" | "pcs";
  position: number;
};
export type JobSummary = Pick<
  Job,
  "id" | "title" | "jobComplete" | "priority" | "version" | "updatedAt"
>;
export type JobInput = Pick<
  Job,
  "title" | "generalRemarks" | "priority" | "jobComplete"
>;

const request = <T>(path: string, method = "GET", body?: JobInput) =>
  apiRequest<T>(`/jobs${path}`, method, body);
export const jobsApi = {
  list: () => request<JobSummary[]>(""),
  get: (id: string) => request<Job>(`/${encodeURIComponent(id)}`),
  create: (body: JobInput) => request<Job>("", "POST", body),
  update: (id: string, body: JobInput) =>
    request<Job>(`/${encodeURIComponent(id)}`, "PATCH", body),
  delete: (id: string) => request<void>(`/${encodeURIComponent(id)}`, "DELETE"),
};
