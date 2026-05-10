import { describe, it } from "node:test";
import assert from "node:assert";
import { groupByTurn, aggregateDiffs, type ChatEvent } from "./chat.js";

function mkKey(): string {
  return `k_${Math.random().toString(36).slice(2, 8)}`;
}

function userEvent(text: string, turnId?: number): ChatEvent {
  return { kind: "user", key: mkKey(), text, turnId };
}

function assistantEvent(text: string, reasoning?: string, turnId?: number): ChatEvent {
  return {
    kind: "assistant",
    key: mkKey(),
    id: Math.floor(Math.random() * 1000),
    text,
    reasoning: reasoning ?? "",
    streaming: false,
    turnId,
  };
}

function toolEvent(name: string, turnId?: number): ChatEvent {
  return {
    kind: "tool",
    key: mkKey(),
    id: `t_${Math.random().toString(36).slice(2, 8)}`,
    name,
    args: "{}",
    status: "done",
    turnId,
  };
}

function diffEvent(path: string, before: string, after: string, turnId?: number): ChatEvent {
  return {
    kind: "tool",
    key: mkKey(),
    id: `t_${Math.random().toString(36).slice(2, 8)}`,
    name: "edit",
    args: "{}",
    status: "done",
    turnId,
    render: { title: "edit", diff: { path, before, after } },
  };
}

function infoEvent(text: string): ChatEvent {
  return { kind: "info", key: mkKey(), text };
}

function errorEvent(text: string): ChatEvent {
  return { kind: "error", key: mkKey(), text };
}

function findTurn(groups: ReturnType<typeof groupByTurn>, turnId: number) {
  const g = groups.find((g) => g.turnId === turnId);
  assert.ok(g, `expected turn ${turnId} to exist`);
  return g!;
}

describe("groupByTurn", () => {
  it("groups events by turnId", () => {
    const events = [
      userEvent("first prompt", 1),
      assistantEvent("response 1", undefined, 1),
      toolEvent("read", 1),
      infoEvent("some info"),
      userEvent("second prompt", 2),
      assistantEvent("response 2", undefined, 2),
      toolEvent("edit", 2),
    ];

    const groups = groupByTurn(events);
    assert.strictEqual(groups.length, 3);

    const turn1 = findTurn(groups, 1);
    assert.strictEqual(turn1.events.length, 3);
    assert.strictEqual(turn1.events[0]!.kind, "user");
    assert.strictEqual(turn1.events[2]!.kind, "tool");

    const turn2 = findTurn(groups, 2);
    assert.strictEqual(turn2.events.length, 3);

    const ungrouped = groups.find((g) => g.turnId === -1);
    assert.ok(ungrouped);
    assert.strictEqual(ungrouped.events.length, 1);
    assert.strictEqual(ungrouped.events[0]!.kind, "info");
  });

  it("preserves event order within each turn", () => {
    const events = [
      userEvent("q1", 1),
      assistantEvent("a1", undefined, 1),
      toolEvent("read", 1),
      toolEvent("bash", 1),
      toolEvent("edit", 1),
    ];

    const groups = groupByTurn(events);
    const turn1 = findTurn(groups, 1);
    assert.strictEqual(turn1.events.length, 5);
    assert.strictEqual(turn1.events[0]!.kind, "user");
    assert.strictEqual(turn1.events[1]!.kind, "assistant");
    assert.strictEqual(turn1.events[2]!.kind, "tool");
    assert.strictEqual((turn1.events[2]! as Extract<ChatEvent, { kind: "tool" }>).name, "read");
    assert.strictEqual(turn1.events[3]!.kind, "tool");
    assert.strictEqual((turn1.events[3]! as Extract<ChatEvent, { kind: "tool" }>).name, "bash");
    assert.strictEqual(turn1.events[4]!.kind, "tool");
    assert.strictEqual((turn1.events[4]! as Extract<ChatEvent, { kind: "tool" }>).name, "edit");
  });

  it("marks hasActive when any assistant event is streaming", () => {
    const active: ChatEvent = {
      kind: "assistant",
      key: mkKey(),
      id: 1,
      text: "thinking...",
      reasoning: "",
      streaming: true,
      turnId: 1,
    };
    const done: ChatEvent = {
      kind: "assistant",
      key: mkKey(),
      id: 2,
      text: "done",
      reasoning: "",
      streaming: false,
      turnId: 2,
    };

    const events = [userEvent("q1", 1), active, userEvent("q2", 2), done];
    const groups = groupByTurn(events);

    const turn1 = findTurn(groups, 1);
    assert.strictEqual(turn1.hasActive, true);

    const turn2 = findTurn(groups, 2);
    assert.strictEqual(turn2.hasActive, false);
  });

  it("accumulates reasoning across multiple assistant events in the same turn", () => {
    const events = [
      userEvent("q1", 1),
      assistantEvent("text1", "step 1 reasoning ", 1),
      toolEvent("read", 1),
      assistantEvent("text2", "step 2 reasoning ", 1),
    ];

    const groups = groupByTurn(events);
    const turn1 = findTurn(groups, 1);
    assert.strictEqual(turn1.reasoning, "step 1 reasoning step 2 reasoning ");
  });

  it("puts events without turnId into the ungrouped (-1) bucket", () => {
    const events = [userEvent("no turn id"), assistantEvent("reply"), infoEvent("info")];
    const groups = groupByTurn(events);

    const ungrouped = groups.find((g) => g.turnId === -1);
    assert.ok(ungrouped);
    assert.strictEqual(ungrouped.events.length, 3);
  });

  it("sorts turns in ascending order (oldest first)", () => {
    const events = [
      userEvent("q1", 1),
      assistantEvent("a1", undefined, 1),
      userEvent("q2", 2),
      assistantEvent("a2", undefined, 2),
      userEvent("q3", 3),
      assistantEvent("a3", undefined, 3),
    ];

    const groups = groupByTurn(events);
    const turnIds = groups.filter((g) => g.turnId > 0).map((g) => g.turnId);
    assert.deepStrictEqual(turnIds, [1, 2, 3]);
  });

  it("places ungrouped events after all turn-grouped events", () => {
    const events = [
      userEvent("q1", 1),
      assistantEvent("a1", undefined, 1),
      infoEvent("late info"),
    ];

    const groups = groupByTurn(events);
    const lastGroup = groups[groups.length - 1];
    assert.ok(lastGroup);
    assert.strictEqual(lastGroup.turnId, -1);
    assert.strictEqual(lastGroup.events[0]!.kind, "info");
  });

  it("handles empty events array", () => {
    const groups = groupByTurn([]);
    assert.strictEqual(groups.length, 0);
  });

  it("handles mixed info/error/memory events without crashing", () => {
    const events: ChatEvent[] = [
      userEvent("q1", 1),
      assistantEvent("a1", undefined, 1),
      infoEvent("system note"),
      errorEvent("something broke"),
      { kind: "memory", key: mkKey(), text: "remembered something" },
      { kind: "meta", key: mkKey(), skillsActive: 2 },
    ];

    const groups = groupByTurn(events);
    assert.ok(groups.length >= 2);
    const turn1 = findTurn(groups, 1);
    assert.strictEqual(turn1.events.length, 2);
  });
});

describe("aggregateDiffs", () => {
  it("returns null when no tool events have diffs", () => {
    const events = [
      userEvent("q1", 1),
      assistantEvent("a1", undefined, 1),
      toolEvent("read", 1),
    ];
    assert.strictEqual(aggregateDiffs(events), null);
  });

  it("counts added and removed lines from diff events", () => {
    const events: ChatEvent[] = [
      toolEvent("edit", 1),
      diffEvent("src/app.tsx", "line1\nline2\nline3", "line1\nline2_changed\nline3\nline4", 1),
    ];

    const summary = aggregateDiffs(events);
    assert.ok(summary);
    assert.strictEqual(summary.files, 1);
    assert.strictEqual(summary.added, 2);
    assert.strictEqual(summary.removed, 1);
  });

  it("counts changes across multiple files", () => {
    const events: ChatEvent[] = [
      diffEvent("a.ts", "old", "new", 1),
      diffEvent("b.ts", "x\ny", "x\nz\nw", 1),
    ];

    const summary = aggregateDiffs(events);
    assert.ok(summary);
    assert.strictEqual(summary.files, 2);
    assert.strictEqual(summary.added, 3);
    assert.strictEqual(summary.removed, 2);
  });

  it("deduplicates the same file across multiple edits", () => {
    const events: ChatEvent[] = [
      diffEvent("same.ts", "a", "b", 1),
      diffEvent("same.ts", "c", "d", 1),
    ];

    const summary = aggregateDiffs(events);
    assert.ok(summary);
    assert.strictEqual(summary.files, 1);
  });

  it("handles empty before/after gracefully", () => {
    const events: ChatEvent[] = [
      diffEvent("new.ts", "", "hello\nworld", 1),
    ];

    const summary = aggregateDiffs(events);
    assert.ok(summary);
    assert.strictEqual(summary.files, 1);
    assert.strictEqual(summary.added, 2);
    assert.strictEqual(summary.removed, 1);
  });
});
