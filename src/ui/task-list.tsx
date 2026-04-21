import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { Task } from "../tasks-state.js";
import type { Theme } from "./theme.js";

interface Props {
  tasks: Task[];
  theme: Theme;
  startedAt: number | null;
  tokensDelta: number;
}

const MAX_VISIBLE = 6;

export function TaskList({ tasks, theme, startedAt, tokensDelta }: Props) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const allDone = tasks.length > 0 && tasks.every((t) => t.status === "completed");
    if (allDone) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, tasks]);

  if (tasks.length === 0) return null;

  const active = tasks.find((t) => t.status === "in_progress");
  const done = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const allDone = done === total;

  const header = active
    ? active.title
    : allDone
      ? `Done (${total} tasks)`
      : `Tasks (${done}/${total})`;

  const elapsed = startedAt ? formatElapsed(now - startedAt) : null;
  const headerStats = [elapsed, tokensDelta > 0 ? `↑ ${formatTokens(tokensDelta)} tokens` : null]
    .filter(Boolean)
    .join(" · ");

  const visibleTasks = tasks.slice(0, MAX_VISIBLE);
  const hiddenPending = Math.max(0, tasks.length - visibleTasks.length);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={allDone ? "green" : theme.accent} bold>
          {allDone ? "✓" : "▸"} {header}
        </Text>
        {headerStats && (
          <Text color={theme.info.color} dimColor={theme.info.dim}>
            {"  "}({headerStats})
          </Text>
        )}
      </Box>
      {visibleTasks.map((t) => (
        <TaskRow key={t.id} task={t} theme={theme} />
      ))}
      {hiddenPending > 0 && (
        <Text color={theme.info.color} dimColor={theme.info.dim}>
          {"  "}… +{hiddenPending} more
        </Text>
      )}
    </Box>
  );
}

function TaskRow({ task, theme }: { task: Task; theme: Theme }) {
  if (task.status === "completed") {
    return (
      <Text color={theme.info.color} dimColor={theme.info.dim}>
        {"  "}✓ <Text strikethrough>{task.title}</Text>
      </Text>
    );
  }
  if (task.status === "in_progress") {
    return (
      <Text color={theme.accent} bold>
        {"  "}■ {task.title}
      </Text>
    );
  }
  return (
    <Text color={theme.info.color} dimColor={theme.info.dim}>
      {"  "}☐ {task.title}
    </Text>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
