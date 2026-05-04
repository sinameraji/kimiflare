/**
 * Research Ledger — Append-Only API
 *
 * Durable, typed, append-only ledger for research transactions.
 * Workers never mutate the ledger directly; they call structured tools
 * and the orchestrator validates and appends.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  CheckpointRef,
  FileLease,
  Finding,
  OrchestratorNote,
  ResearchPlan,
  ResearchStatus,
  ResearchTask,
  OpenQuestion,
} from "./types.js";

function researchDir(turnId: string): string {
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(xdg, "kimiflare", "research", turnId);
}

export function ledgerPath(turnId: string): string {
  return join(researchDir(turnId), "research_plan.json");
}

export function checkpointPath(turnId: string, wave: number): string {
  return join(researchDir(turnId), `checkpoint_wave_${wave}.json`);
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export async function readLedger(turnId: string): Promise<ResearchPlan | null> {
  try {
    const raw = await readFile(ledgerPath(turnId), "utf-8");
    return JSON.parse(raw) as ResearchPlan;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function writeLedger(plan: ResearchPlan): Promise<void> {
  const path = ledgerPath(plan.turnId);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(plan, null, 2), "utf-8");
  await rename(tmp, path);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function createLedger(opts: {
  turnId: string;
  query: string;
  repoFingerprint: string;
  budget: ResearchPlan["budget"];
}): ResearchPlan {
  return {
    version: 1,
    turnId: opts.turnId,
    query: opts.query,
    repoFingerprint: opts.repoFingerprint,
    status: "scouting",
    budget: opts.budget,
    phases: [],
    tasks: [],
    findings: [],
    fileLeases: [],
    openQuestions: [],
    convergence: {
      score: 0,
      metrics: {
        budgetRemainingPct: 100,
        unresolvedCriticalQuestions: 0,
        findingsDeltaLastWave: 0,
        duplicateReadRate: 0,
        coverageChecklistPct: 0,
      },
      decision: "continue",
    },
    checkpoints: [],
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Status Mutation
// ---------------------------------------------------------------------------

export function setStatus(
  plan: ResearchPlan,
  status: ResearchStatus,
): ResearchPlan {
  return { ...plan, status };
}

// ---------------------------------------------------------------------------
// Task Mutation
// ---------------------------------------------------------------------------

export function addTasks(plan: ResearchPlan, tasks: ResearchTask[]): ResearchPlan {
  return { ...plan, tasks: [...plan.tasks, ...tasks] };
}

export function updateTask(
  plan: ResearchPlan,
  taskId: string,
  patch: Partial<ResearchTask>,
): ResearchPlan {
  const tasks = plan.tasks.map((t) =>
    t.id === taskId ? { ...t, ...patch } : t,
  );
  return { ...plan, tasks };
}

export function killTask(
  plan: ResearchPlan,
  taskId: string,
  reason: string,
): ResearchPlan {
  return updateTask(plan, taskId, { status: "killed", killReason: reason });
}

// ---------------------------------------------------------------------------
// Finding Mutation (validated)
// ---------------------------------------------------------------------------

export interface AppendFindingOpts {
  finding: Finding;
  workerId: string;
}

export function appendFinding(
  plan: ResearchPlan,
  opts: AppendFindingOpts,
): { plan: ResearchPlan; error?: string } {
  const task = plan.tasks.find((t) => t.id === opts.finding.taskId);
  if (!task) {
    return { plan, error: `Task ${opts.finding.taskId} not found` };
  }
  if (task.ownerWorkerId !== opts.workerId) {
    return {
      plan,
      error: `Worker ${opts.workerId} does not own task ${opts.finding.taskId}`,
    };
  }
  if (task.status !== "in_progress") {
    return {
      plan,
      error: `Task ${opts.finding.taskId} is not in_progress`,
    };
  }
  return { plan: { ...plan, findings: [...plan.findings, opts.finding] } };
}

// ---------------------------------------------------------------------------
// File Lease Mutation (validated)
// ---------------------------------------------------------------------------

export interface RequestLeaseOpts {
  filePath: string;
  workerId: string;
  taskId: string;
  purpose: string;
  expiresAfterToolCalls: number;
}

export function requestLease(
  plan: ResearchPlan,
  opts: RequestLeaseOpts,
): { plan: ResearchPlan; granted: boolean; error?: string } {
  const task = plan.tasks.find((t) => t.id === opts.taskId);
  if (!task) {
    return { plan, granted: false, error: `Task ${opts.taskId} not found` };
  }
  if (task.ownerWorkerId !== opts.workerId) {
    return {
      plan,
      granted: false,
      error: `Worker ${opts.workerId} does not own task ${opts.taskId}`,
    };
  }

  const existing = plan.fileLeases.find(
    (l) => l.filePath === opts.filePath && l.status === "active",
  );
  if (existing) {
    return { plan, granted: false };
  }

  const lease: FileLease = {
    filePath: opts.filePath,
    workerId: opts.workerId,
    taskId: opts.taskId,
    purpose: opts.purpose,
    status: "active",
    expiresAfterToolCalls: opts.expiresAfterToolCalls,
  };
  return { plan: { ...plan, fileLeases: [...plan.fileLeases, lease] }, granted: true };
}

export function releaseLease(
  plan: ResearchPlan,
  filePath: string,
  workerId: string,
): ResearchPlan {
  const leases = plan.fileLeases.map((l) =>
    l.filePath === filePath && l.workerId === workerId && l.status === "active"
      ? { ...l, status: "released" as const }
      : l,
  );
  return { ...plan, fileLeases: leases };
}

export function expireLeases(plan: ResearchPlan): ResearchPlan {
  const leases = plan.fileLeases.map((l) => {
    if (l.status !== "active") return l;
    const remaining = l.expiresAfterToolCalls - 1;
    if (remaining <= 0) {
      return { ...l, status: "expired" as const, expiresAfterToolCalls: 0 };
    }
    return { ...l, expiresAfterToolCalls: remaining };
  });
  return { ...plan, fileLeases: leases };
}

// ---------------------------------------------------------------------------
// Open Question Mutation
// ---------------------------------------------------------------------------

export function addOpenQuestions(
  plan: ResearchPlan,
  questions: OpenQuestion[],
): ResearchPlan {
  return { ...plan, openQuestions: [...plan.openQuestions, ...questions] };
}

export function resolveOpenQuestion(
  plan: ResearchPlan,
  questionId: string,
): ResearchPlan {
  const openQuestions = plan.openQuestions.map((q) =>
    q.id === questionId ? { ...q, status: "answered" as const } : q,
  );
  return { ...plan, openQuestions };
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

export async function checkpoint(
  plan: ResearchPlan,
  wave: number,
): Promise<ResearchPlan> {
  const ref: CheckpointRef = {
    wave,
    timestamp: new Date().toISOString(),
    ledgerPath: ledgerPath(plan.turnId),
  };
  const cpPath = checkpointPath(plan.turnId, wave);
  await mkdir(dirname(cpPath), { recursive: true });
  const tmp = `${cpPath}.tmp`;
  await writeFile(tmp, JSON.stringify(plan, null, 2), "utf-8");
  await rename(tmp, cpPath);
  return { ...plan, checkpoints: [...plan.checkpoints, ref] };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function addNote(plan: ResearchPlan, note: string): ResearchPlan {
  const entry: OrchestratorNote = {
    timestamp: new Date().toISOString(),
    note,
  };
  return { ...plan, notes: [...plan.notes, entry] };
}

// ---------------------------------------------------------------------------
// Phase Usage
// ---------------------------------------------------------------------------

export function recordPhaseUsage(
  plan: ResearchPlan,
  phase: ResearchPlan["phases"][number],
): ResearchPlan {
  return { ...plan, phases: [...plan.phases, phase] };
}
