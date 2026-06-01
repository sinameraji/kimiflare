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
  const pending = workers.filter((w) => w.status === "pending").length;

  // Only show the synthesis spinner when workers are actually done and
  // the coordinator is crunching results. If workers are still running
  // we suppress it so the UI doesn't look like everything is stuck on
  // "Synthesizing" while sandboxes are still booting.
  const showSynthesis = isSynthesizing && running === 0;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={theme.accent} bold>
          Workers: {pending > 0 ? `${pending} todo · ` : ""}
          {running > 0 ? `${running} ongoing · ` : ""}
          {completed > 0 ? `${completed} done · ` : ""}
          {failed > 0 ? `${failed} failed · ` : ""}
        </Text>
      </Box>
      {workers.map((w) => (
        <WorkerRow key={w.id} worker={w} />
      ))}
      {showSynthesis && (
        <Box marginLeft={2}>
          <Text color={theme.info.color}>
            <Spinner type="dots" />{" "}
            <Text bold>[coordinator]</Text> Synthesizing findings…
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

  const elapsed = formatElapsed(now - worker.startedAt);
  const modeLabel = worker.mode === "plan" ? "research" : "executor";

  // Status icons mirror the Camouflage TodoListUpdate protocol:
  //   ☐ pending  |  ◐ running  |  ☑ completed  |  ☒ failed
  const statusIcon =
    worker.status === "pending" ? (
      <Text color={theme.muted?.color ?? theme.info.color}>☐</Text>
    ) : worker.status === "running" ? (
      <Text color={theme.info.color}>
        <Spinner type="line" />
      </Text>
    ) : worker.status === "completed" ? (
      <Text color={theme.palette.success}>☑</Text>
    ) : (
      <Text color={theme.palette.error}>☒</Text>
    );

  const statusLabel =
    worker.status === "pending"
      ? "todo"
      : worker.status === "running"
      ? "ongoing"
      : worker.status === "completed"
      ? "done"
      : "failed";

  const isDone = worker.status === "completed" || worker.status === "failed";

  // Show the last 5 log lines for running workers so users can see
  // heartbeat progress and any errors as they unfold; last 8 for done/failed.
  const visibleLogs =
    worker.status === "running"
      ? worker.logs.slice(-5)
      : worker.status === "pending"
      ? []
      : worker.logs.slice(-8);

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text>
          {statusIcon}{" "}
          <Text color={theme.info.color} bold>
            [{modeLabel}]
          </Text>{" "}
          <Text
            color={isDone ? theme.muted?.color ?? theme.info.color : theme.info.color}
            italic={worker.status === "pending"}
            strikethrough={worker.status === "completed"}
          >
            {worker.task.slice(0, 60)}
          </Text>
          {worker.status === "running" ? (
            <Text color={theme.accent}> · {elapsed}</Text>
          ) : (
            <Text color={theme.muted?.color ?? theme.info.color} dimColor>
              {" "}
              · {statusLabel}
            </Text>
          )}
          {worker.error ? (
            <Text color={theme.palette.error}> · {worker.error.slice(0, 60)}</Text>
          ) : null}
        </Text>
      </Box>
      {visibleLogs.length > 0 && (
        <Box flexDirection="column" marginLeft={4}>
          {visibleLogs.map((line, i) => (
            <Text key={`${worker.id}-log-${i}`} color={theme.muted?.color ?? theme.info.color} dimColor>
              {line.slice(0, 120)}
            </Text>
          ))}
        </Box>
      )}
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
