import type { Job } from "./types";
import { getEnv } from "../config";

export function useSaasJobsBackend(): boolean {
  const v = String(process.env.CONTROL_PLANE_JOBS_BACKEND || "file")
    .trim()
    .toLowerCase();
  return v === "saas" || v === "mongo";
}

/** Collection URL without trailing slash. Default derived from SAAS_VALIDATE_URL. */
export function saasJobsCollectionUrl(): string {
  const explicit = process.env.CONTROL_PLANE_JOBS_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const validateUrl =
    process.env.SAAS_VALIDATE_URL ||
    "http://127.0.0.1:3002/internal/validate-key";
  const base = validateUrl.replace(/\/validate-key\/?$/, "");
  return `${base}/control-plane/jobs`;
}

class JobStoreError extends Error {
  code: "job_not_found" | "store_unavailable";
  constructor(code: "job_not_found" | "store_unavailable", message: string) {
    super(message);
    this.code = code;
  }
}

function isJob(value: unknown): value is Job {
  return Boolean(value && typeof value === "object" && typeof (value as Job).id === "string");
}

async function saasFetch(
  method: "GET" | "PUT",
  jobId: string,
  body?: Job,
  mustExist = false
): Promise<Job | null> {
  const secret = getEnv().internalSecret;
  if (!secret) {
    throw new JobStoreError(
      "store_unavailable",
      "SAAS_INTERNAL_SECRET is required for CONTROL_PLANE_JOBS_BACKEND=saas"
    );
  }
  const url = new URL(`${saasJobsCollectionUrl()}/${encodeURIComponent(jobId)}`);
  if (method === "PUT" && mustExist) url.searchParams.set("mustExist", "1");
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-SaaS-Secret": secret,
      },
      body: method === "PUT" ? JSON.stringify({ job: body }) : undefined,
    });
  } catch {
    throw new JobStoreError("store_unavailable", "Job store unavailable");
  }

  if (res.status === 404 || res.status === 410) {
    if (method === "GET") return null;
    throw new JobStoreError("job_not_found", `job_not_found:${jobId}`);
  }
  if (!res.ok) {
    throw new JobStoreError("store_unavailable", "Job store unavailable");
  }
  const parsed = (await res.json()) as { job?: unknown };
  if (!isJob(parsed.job)) {
    throw new JobStoreError("store_unavailable", "Job store returned an invalid document");
  }
  return parsed.job;
}

export const saasJobStore = {
  async create(job: Job): Promise<Job> {
    const saved = await saasFetch("PUT", job.id, job, false);
    return saved || job;
  },

  async get(id: string): Promise<Job | null> {
    if (!id) return null;
    return saasFetch("GET", id);
  },

  async update(job: Job): Promise<Job> {
    const saved = await saasFetch("PUT", job.id, job, true);
    return saved || job;
  },
};

export { JobStoreError };
