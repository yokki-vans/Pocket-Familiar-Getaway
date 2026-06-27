import { nanoid } from "nanoid";
import type { ResultCard } from "../agents/result-card.js";

export type TaskStatus = "queued" | "running" | "waiting_for_input" | "done" | "failed" | "canceled";

export type TaskRecord = {
  id: string;
  deviceId: string;
  sessionId?: string;
  hermesTaskId: string;
  title: string;
  status: TaskStatus;
  message: string;
  resultSummary?: string;
  rawJson?: unknown;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

const tasks = new Map<string, TaskRecord>();
const listeners = new Set<(task: TaskRecord) => void>();

function nowIso() {
  return new Date().toISOString();
}

function emit(task: TaskRecord) {
  for (const listener of listeners) listener(task);
}

export function createTaskFromResult(input: { deviceId: string; sessionId: string; result: ResultCard; raw?: unknown }) {
  const ts = nowIso();
  const task: TaskRecord = {
    id: `task_${nanoid(18)}`,
    deviceId: input.deviceId,
    sessionId: input.sessionId,
    hermesTaskId: `hermes_${nanoid(14)}`,
    title: input.result.title || "Hermes task",
    status: input.result.status === "done" ? "done" : "running",
    message: input.result.body || "Hermes is working",
    resultSummary: input.result.kind === "answer" ? input.result.body : undefined,
    rawJson: input.raw ?? input.result,
    createdAt: ts,
    updatedAt: ts,
    completedAt: input.result.status === "done" ? ts : undefined
  };
  tasks.set(task.id, task);
  emit(task);
  return task;
}

export function listDeviceTasks(deviceId: string) {
  return [...tasks.values()]
    .filter((task) => task.deviceId === deviceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);
}

export function getDeviceTask(deviceId: string, id: string) {
  const task = tasks.get(id);
  return task && task.deviceId === deviceId ? task : undefined;
}

export function subscribeTasks(listener: (task: TaskRecord) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
