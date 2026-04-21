export type TaskStatus = "pending" | "in_progress" | "completed";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
}

export function isValidStatus(s: unknown): s is TaskStatus {
  return s === "pending" || s === "in_progress" || s === "completed";
}

export function validateTasks(input: unknown): Task[] {
  if (!Array.isArray(input)) throw new Error("tasks must be an array");
  return input.map((t, i) => {
    if (!t || typeof t !== "object") throw new Error(`tasks[${i}] must be an object`);
    const rec = t as Record<string, unknown>;
    const id = typeof rec.id === "string" && rec.id.length > 0 ? rec.id : String(i + 1);
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (!title) throw new Error(`tasks[${i}].title is required`);
    const status: TaskStatus = isValidStatus(rec.status) ? rec.status : "pending";
    return { id, title, status };
  });
}
