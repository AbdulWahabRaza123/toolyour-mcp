import fs from "fs";
import path from "path";
import type { Job } from "./types";
import { JOB_TTL_MS } from "./types";
import { JobStoreError, saasJobStore, useSaasJobsBackend } from "./store-saas";

function dataDir(): string {
  return (
    process.env.CONTROL_PLANE_DATA_DIR ||
    path.join(process.cwd(), ".data", "control-plane")
  );
}

function jobsPath(): string {
  return path.join(dataDir(), "jobs.json");
}

type JobMap = Record<string, Job>;

function readAll(): JobMap {
  const file = jobsPath();
  if (!fs.existsSync(file)) return {};
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as JobMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map: JobMap): void {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = jobsPath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2), "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    fs.unlinkSync(tmp);
  }
}

function sweep(map: JobMap, now = Date.now()): JobMap {
  let changed = false;
  const next: JobMap = {};
  for (const [id, job] of Object.entries(map)) {
    if (job.expiresAt && now >= job.expiresAt) {
      changed = true;
      continue;
    }
    next[id] = job;
  }
  if (changed) writeAll(next);
  return next;
}

const fileJobStore = {
  async create(job: Job): Promise<Job> {
    const map = sweep(readAll());
    map[job.id] = job;
    writeAll(map);
    return job;
  },

  async get(id: string): Promise<Job | null> {
    const map = sweep(readAll());
    return map[id] || null;
  },

  async update(job: Job): Promise<Job> {
    const map = sweep(readAll());
    if (!map[job.id]) {
      throw new JobStoreError("job_not_found", `job_not_found:${job.id}`);
    }
    map[job.id] = job;
    writeAll(map);
    return job;
  },
};

function backend() {
  return useSaasJobsBackend() ? saasJobStore : fileJobStore;
}

export const jobStore = {
  create(job: Job): Promise<Job> {
    return backend().create(job);
  },

  get(id: string): Promise<Job | null> {
    return backend().get(id);
  },

  update(job: Job): Promise<Job> {
    return backend().update(job);
  },

  owns(job: Job, ownerKey: string): boolean {
    return Boolean(job.ownerKey && ownerKey && job.ownerKey === ownerKey);
  },
};

export { JOB_TTL_MS, useSaasJobsBackend };
export { saasJobsCollectionUrl } from "./store-saas";
export { JobStoreError };
