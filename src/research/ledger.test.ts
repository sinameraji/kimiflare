import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { rm } from "node:fs/promises";
import {
  ledgerPath,
  readLedger,
  writeLedger,
  createLedger,
  setStatus,
  addTasks,
  updateTask,
  killTask,
  appendFinding,
  requestLease,
  releaseLease,
  expireLeases,
  addOpenQuestions,
  resolveOpenQuestion,
  checkpoint,
  addNote,
  recordPhaseUsage,
} from "./ledger.js";
import type { ResearchBudget, ResearchTask, Finding } from "./types.js";

const TEST_TURN_ID = "test-turn-ledger-001";
const TEST_BUDGET: ResearchBudget = {
  maxCostUsd: 2.0,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 80_000,
  maxWallTimeMs: 8 * 60_000,
  maxFilesRead: 80,
  maxWaves: 3,
  maxWorkersPerWave: 1,
  partitions: { scout: 0.10, exploration: 0.65, synthesis: 0.15, emergency: 0.10 },
};

describe("ledger", () => {
  before(async () => {
    try {
      await rm(ledgerPath(TEST_TURN_ID), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  after(async () => {
    try {
      await rm(ledgerPath(TEST_TURN_ID), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates a ledger with correct defaults", () => {
    const plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "how does auth work",
      repoFingerprint: "abc123",
      budget: TEST_BUDGET,
    });

    assert.strictEqual(plan.version, 1);
    assert.strictEqual(plan.turnId, TEST_TURN_ID);
    assert.strictEqual(plan.status, "scouting");
    assert.strictEqual(plan.tasks.length, 0);
    assert.strictEqual(plan.findings.length, 0);
    assert.strictEqual(plan.fileLeases.length, 0);
    assert.strictEqual(plan.convergence.score, 0);
    assert.strictEqual(plan.convergence.decision, "continue");
  });

  it("writes and reads a ledger", async () => {
    const plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "how does auth work",
      repoFingerprint: "abc123",
      budget: TEST_BUDGET,
    });

    await writeLedger(plan);
    const read = await readLedger(TEST_TURN_ID);
    assert.ok(read);
    assert.strictEqual(read!.turnId, TEST_TURN_ID);
    assert.strictEqual(read!.query, "how does auth work");
  });

  it("returns null for missing ledger", async () => {
    const read = await readLedger("nonexistent-turn");
    assert.strictEqual(read, null);
  });

  it("sets status immutably", () => {
    const plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    const updated = setStatus(plan, "executing");
    assert.strictEqual(updated.status, "executing");
    assert.strictEqual(plan.status, "scouting"); // original unchanged
  });

  it("adds tasks", () => {
    const plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    const task: ResearchTask = {
      id: "t1",
      question: "how does jwt work",
      description: "explore jwt",
      priority: 1,
      scope: {},
      dependencyIds: [],
      status: "pending",
      budget: {
        maxTokens: 1000,
        maxToolCalls: 10,
        maxFilesRead: 5,
        consumedTokens: 0,
        consumedToolCalls: 0,
        consumedFilesRead: 0,
      },
    };
    const updated = addTasks(plan, [task]);
    assert.strictEqual(updated.tasks.length, 1);
    assert.strictEqual(updated.tasks[0]!.id, "t1");
  });

  it("updates a task", () => {
    const task: ResearchTask = {
      id: "t1",
      question: "how does jwt work",
      description: "explore jwt",
      priority: 1,
      scope: {},
      dependencyIds: [],
      status: "pending",
      budget: {
        maxTokens: 1000,
        maxToolCalls: 10,
        maxFilesRead: 5,
        consumedTokens: 0,
        consumedToolCalls: 0,
        consumedFilesRead: 0,
      },
    };
    let plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    plan = addTasks(plan, [task]);
    const updated = updateTask(plan, "t1", { status: "in_progress", ownerWorkerId: "w1" });
    assert.strictEqual(updated.tasks[0]!.status, "in_progress");
    assert.strictEqual(updated.tasks[0]!.ownerWorkerId, "w1");
  });

  it("kills a task with reason", () => {
    const task: ResearchTask = {
      id: "t1",
      question: "how does jwt work",
      description: "explore jwt",
      priority: 1,
      scope: {},
      dependencyIds: [],
      status: "pending",
      budget: {
        maxTokens: 1000,
        maxToolCalls: 10,
        maxFilesRead: 5,
        consumedTokens: 0,
        consumedToolCalls: 0,
        consumedFilesRead: 0,
      },
    };
    let plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    plan = addTasks(plan, [task]);
    const updated = killTask(plan, "t1", "budget exhausted");
    assert.strictEqual(updated.tasks[0]!.status, "killed");
    assert.strictEqual(updated.tasks[0]!.killReason, "budget exhausted");
  });

  it("appends a finding when worker owns the task", () => {
    const task: ResearchTask = {
      id: "t1",
      question: "how does jwt work",
      description: "explore jwt",
      priority: 1,
      scope: {},
      dependencyIds: [],
      status: "in_progress",
      ownerWorkerId: "w1",
      budget: {
        maxTokens: 1000,
        maxToolCalls: 10,
        maxFilesRead: 5,
        consumedTokens: 0,
        consumedToolCalls: 0,
        consumedFilesRead: 0,
      },
    };
    let plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    plan = addTasks(plan, [task]);

    const finding: Finding = {
      id: "f1",
      taskId: "t1",
      workerId: "w1",
      claim: "JWT is validated in middleware",
      evidence: [{ filePath: "src/auth.ts", lineRange: [10, 20], excerpt: "verify(token)" }],
      confidence: "high",
      createdAt: new Date().toISOString(),
    };

    const result = appendFinding(plan, { finding, workerId: "w1" });
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.plan.findings.length, 1);
  });

  it("rejects finding when worker does not own task", () => {
    const task: ResearchTask = {
      id: "t1",
      question: "how does jwt work",
      description: "explore jwt",
      priority: 1,
      scope: {},
      dependencyIds: [],
      status: "in_progress",
      ownerWorkerId: "w1",
      budget: {
        maxTokens: 1000,
        maxToolCalls: 10,
        maxFilesRead: 5,
        consumedTokens: 0,
        consumedToolCalls: 0,
        consumedFilesRead: 0,
      },
    };
    let plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    plan = addTasks(plan, [task]);

    const finding: Finding = {
      id: "f1",
      taskId: "t1",
      workerId: "w2",
      claim: "JWT is validated in middleware",
      evidence: [{ filePath: "src/auth.ts" }],
      confidence: "high",
      createdAt: new Date().toISOString(),
    };

    const result = appendFinding(plan, { finding, workerId: "w2" });
    assert.ok(result.error);
    assert.strictEqual(result.plan.findings.length, 0);
  });

  it("grants lease when file is free", () => {
    const task: ResearchTask = {
      id: "t1",
      question: "how does jwt work",
      description: "explore jwt",
      priority: 1,
      scope: {},
      dependencyIds: [],
      status: "in_progress",
      ownerWorkerId: "w1",
      budget: {
        maxTokens: 1000,
        maxToolCalls: 10,
        maxFilesRead: 5,
        consumedTokens: 0,
        consumedToolCalls: 0,
        consumedFilesRead: 0,
      },
    };
    let plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    plan = addTasks(plan, [task]);

    const result = requestLease(plan, {
      filePath: "src/auth.ts",
      workerId: "w1",
      taskId: "t1",
      purpose: "read auth logic",
      expiresAfterToolCalls: 5,
    });

    assert.strictEqual(result.granted, true);
    assert.strictEqual(result.plan.fileLeases.length, 1);
  });

  it("denies lease when file is already active", () => {
    const task: ResearchTask = {
      id: "t1",
      question: "how does jwt work",
      description: "explore jwt",
      priority: 1,
      scope: {},
      dependencyIds: [],
      status: "in_progress",
      ownerWorkerId: "w1",
      budget: {
        maxTokens: 1000,
        maxToolCalls: 10,
        maxFilesRead: 5,
        consumedTokens: 0,
        consumedToolCalls: 0,
        consumedFilesRead: 0,
      },
    };
    let plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    plan = addTasks(plan, [task]);
    plan = requestLease(plan, {
      filePath: "src/auth.ts",
      workerId: "w1",
      taskId: "t1",
      purpose: "read auth logic",
      expiresAfterToolCalls: 5,
    }).plan;

    const result = requestLease(plan, {
      filePath: "src/auth.ts",
      workerId: "w2",
      taskId: "t2",
      purpose: "read auth logic again",
      expiresAfterToolCalls: 5,
    });

    assert.strictEqual(result.granted, false);
  });

  it("releases a lease", () => {
    const task: ResearchTask = {
      id: "t1",
      question: "how does jwt work",
      description: "explore jwt",
      priority: 1,
      scope: {},
      dependencyIds: [],
      status: "in_progress",
      ownerWorkerId: "w1",
      budget: {
        maxTokens: 1000,
        maxToolCalls: 10,
        maxFilesRead: 5,
        consumedTokens: 0,
        consumedToolCalls: 0,
        consumedFilesRead: 0,
      },
    };
    let plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    plan = addTasks(plan, [task]);
    plan = requestLease(plan, {
      filePath: "src/auth.ts",
      workerId: "w1",
      taskId: "t1",
      purpose: "read auth logic",
      expiresAfterToolCalls: 5,
    }).plan;

    plan = releaseLease(plan, "src/auth.ts", "w1");
    assert.strictEqual(plan.fileLeases[0]!.status, "released");
  });

  it("expires leases after countdown reaches zero", () => {
    const task: ResearchTask = {
      id: "t1",
      question: "how does jwt work",
      description: "explore jwt",
      priority: 1,
      scope: {},
      dependencyIds: [],
      status: "in_progress",
      ownerWorkerId: "w1",
      budget: {
        maxTokens: 1000,
        maxToolCalls: 10,
        maxFilesRead: 5,
        consumedTokens: 0,
        consumedToolCalls: 0,
        consumedFilesRead: 0,
      },
    };
    let plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    plan = addTasks(plan, [task]);
    plan = requestLease(plan, {
      filePath: "src/auth.ts",
      workerId: "w1",
      taskId: "t1",
      purpose: "read auth logic",
      expiresAfterToolCalls: 1,
    }).plan;

    plan = expireLeases(plan);
    assert.strictEqual(plan.fileLeases[0]!.status, "expired");
    assert.strictEqual(plan.fileLeases[0]!.expiresAfterToolCalls, 0);
  });

  it("adds and resolves open questions", () => {
    let plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    plan = addOpenQuestions(plan, [
      { id: "q1", question: "what about refresh tokens", critical: true, sourceTaskId: "t1", status: "open" },
    ]);
    assert.strictEqual(plan.openQuestions.length, 1);

    plan = resolveOpenQuestion(plan, "q1");
    assert.strictEqual(plan.openQuestions[0]!.status, "answered");
  });

  it("creates a checkpoint", async () => {
    const plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    await writeLedger(plan);
    const updated = await checkpoint(plan, 1);
    assert.strictEqual(updated.checkpoints.length, 1);
    assert.strictEqual(updated.checkpoints[0]!.wave, 1);
  });

  it("adds notes", () => {
    let plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    plan = addNote(plan, "scout completed");
    assert.strictEqual(plan.notes.length, 1);
    assert.strictEqual(plan.notes[0]!.note, "scout completed");
  });

  it("records phase usage", () => {
    let plan = createLedger({
      turnId: TEST_TURN_ID,
      query: "q",
      repoFingerprint: "fp",
      budget: TEST_BUDGET,
    });
    plan = recordPhaseUsage(plan, {
      phase: "scout",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedTokens: 0,
      costUsd: 0.01,
      durationMs: 500,
    });
    assert.strictEqual(plan.phases.length, 1);
    assert.strictEqual(plan.phases[0]!.phase, "scout");
  });
});
