export type JobSeverity = "low" | "medium" | "high";
export type JobMetricStatus = "good" | "needs_improvement" | "poor" | "unknown";
export type JobImpact = "high" | "medium" | "low";

export interface JobScore {
  label: string;
  value: string | number;
  status: JobMetricStatus;
  primaryCause?: string;
}

export interface JobFinding {
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
