import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useTheme } from "./theme-context.js";
import type { Theme } from "./theme.js";
import type { ActiveWorker } from "../agent/supervisor.js";

interface Props {
  workers: ActiveWorker[];
  isSynthesizing?: boolean;
}

export function WorkerList({ workers, isSynthesizing }: Props) {
  const theme = useTheme();

  if (workers.length === 0) return null;

  const running = workers.filter((w) => w.status === "running").length;
  const completed = workers.filter((w) => w.status === "completed").length;
  const failed = workers.filter((w) => w.status === "failed").length;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={theme.accent} bold>
          Workers: {running} running · {completed} done · {failed} failed
        </Text>
      </Box>
      {workers.map((w) => (
        <WorkerRow key={w.id} worker={w} />
      ))}
      {isSynthesizing && (
        <Box marginLeft={2}>
          <Text color={theme.info.color}>
            <Spinner type="dots" /> <Text bold>[coordinator]</Text> Synthesizing findings...
          </Text>
        </Box>
      )}
    </Box>
  );
}

function WorkerRow({ worker }: { worker: ActiveWorker }) {
  const theme = useTheme();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (worker.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [worker.status]);

  const statusIcon =
    worker.status === "pending" ? (
      <Text color={theme.muted?.color ?? theme.info.color}>⏳</Text>
    ) : worker.status === "running" ? (
      <Text color={theme.info.color}>
        <Spinner type="dots" />
      </Text>
    ) : worker.status === "completed" ? (
      <Text color={theme.palette.success}>✓</Text>
    ) : (
      <Text color={theme.palette.error}>✗</Text>
    );

  const elapsed = formatElapsed(now - worker.startedAt);
  const modeLabel = worker.mode === "plan" ? "research" : "executor";

  return (
    <Box marginLeft={2}>
      <Text color={theme.info.color}>
        {statusIcon} <Text bold>[{modeLabel}]</Text> {worker.task.slice(0, 60)}
        {worker.status === "running" ? ` · ${elapsed}` : ""}
        {worker.error ? ` · ${worker.error.slice(0, 60)}` : ""}
      </Text>
    </Box>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
