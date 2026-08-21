export type JobSeverity = "low" | "medium" | "high";
export type JobMetricStatus = "good" | "needs_improvement" | "poor" | "unknown";
export type JobImpact = "high" | "medium" | "low";
/** default = high findings / poor scores; ship = also fail critical NI/unknown. */
export type GatePolicy = "default" | "ship";

export interface JobScore {
  label: string;
  value: string | number;
  status: JobMetricStatus;
  primaryCause?: string;
}

export interface JobFinding {
  /** Stable across verify rounds when title wording drifts. */
  findingId?: string;
  workstream?: string;
  severity: JobSeverity;
  title: string;
  whyItMatters: string;
  howToFix: string[];
  evidence?: Record<string, unknown>;
  metric?: string;
}

export interface PrioritizedAction {
  rank: number;
  workstream: string;
  action: string;
  expectedImpact: JobImpact;
  effort?: JobImpact;
}

export interface JobReport {
  schemaVersion: "toolyour.jobReport@1";
  jobId: string;
  workflowId: string;
  url?: string;
  summary: string[];
  scores: Record<string, JobScore>;
  findings: JobFinding[];
  prioritizedActions: PrioritizedAction[];
  workstreams?: Record<string, unknown>;
  toolsUsed: string[];
  steps: Record<string, unknown>;
  limitations?: string[];
  /** When set, computeVerifyGate applies playbook-specific rules. */
  gatePolicy?: GatePolicy;
  /** True when one or more workflow steps failed or were skipped. */
  incomplete?: boolean;
}

export interface WorkflowStepMeta {
  id: string;
  operationId: string;
}

export interface SynthesizeJobParams {
  synthesizerId: string;
  workflowId: string;
  jobId?: string;
  input: Record<string, unknown>;
  steps: WorkflowStepMeta[];
  stepResults: Record<string, unknown>;
}
