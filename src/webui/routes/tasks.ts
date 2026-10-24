import { TaskDependencyResolver } from "../../telegram/task-dependency-resolver.js";
import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getTaskStore, type TaskStatus } from "../../memory/agent/tasks.js";
import { apiError } from "../http.js";

const VALID_STATUSES: TaskStatus[] = [
  "pending",
  "in_progress",
  "done",
  "failed",
  "cancelled",
  "incomplete",
  "blocked",
  "unknown",
];
const TERMINAL_STATUSES: TaskStatus[] = ["done", "failed", "cancelled"];

export function createTasksRoutes(deps: WebUIServerDeps) {
  const app = new Hono();

  function store() {
    return getTaskStore(deps.memory.db);
  }

  // List tasks (optional ?status= filter)
  app.get("/", (c) => {
    try {
      const status = c.req.query("status") as TaskStatus | undefined;
      const filter = status && VALID_STATUSES.includes(status) ? { status } : undefined;

      const tasks = store().listTasks(filter);

      // Enrich with dependency info
      const enriched = tasks.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        startedAt: t.startedAt?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
        scheduledFor: t.scheduledFor?.toISOString() ?? null,
        dependencies: store().getDependencies(t.id),
        dependents: store().getDependents(t.id),
        runs: store().listTaskRuns(t.id),
      }));

      const response: APIResponse = { success: true, data: enriched };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Get single task
  app.get("/:id", (c) => {
    try {
      const task = store().getTask(c.req.param("id"));
      if (!task) {
        const response: APIResponse = { success: false, error: "Task not found" };
        return c.json(response, 404);
      }

      const enriched = {
        ...task,
        createdAt: task.createdAt.toISOString(),
        startedAt: task.startedAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        scheduledFor: task.scheduledFor?.toISOString() ?? null,
        dependencies: store().getDependencies(task.id),
        dependents: store().getDependents(task.id),
        runs: store().listTaskRuns(task.id),
      };

      const response: APIResponse = { success: true, data: enriched };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Delete task
  app.delete("/:id", (c) => {
    try {
      const task = store().getTask(c.req.param("id"));
      if (task && !TERMINAL_STATUSES.includes(task.status))
        return c.json({ success: false, error: "Resolve or cancel the task before deletion" }, 409);
      const deleted = store().deleteTask(c.req.param("id"));
      if (!deleted) {
        const response: APIResponse = {
          success: false,
          error: task
            ? "Execution history or dependent tasks still require this task record"
            : "Task not found",
        };
        return c.json(response, task ? 409 : 404);
      }

      const response: APIResponse = { success: true, data: { message: "Task deleted" } };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Clean tasks by terminal status (bulk delete)
  app.post("/clean", async (c) => {
    try {
      const body = await c.req.json<{ status?: string }>().catch(() => ({ status: undefined }));
      const status = body.status as TaskStatus | undefined;

      if (!status || !TERMINAL_STATUSES.includes(status as TaskStatus)) {
        const response: APIResponse = {
          success: false,
          error: `Invalid status. Must be one of: ${TERMINAL_STATUSES.join(", ")}`,
        };
        return c.json(response, 400);
      }

      const tasks = store().listTasks({ status });
      let deleted = 0;
      for (const t of tasks) {
        if (store().deleteTask(t.id)) deleted++;
      }

      const response: APIResponse = { success: true, data: { deleted } };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Backward-compatible alias
  app.post("/clean-done", (c) => {
    try {
      const doneTasks = store().listTasks({ status: "done" });
      let deleted = 0;
      for (const t of doneTasks) {
        if (store().deleteTask(t.id)) deleted++;
      }

      const response: APIResponse = { success: true, data: { deleted } };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  app.post("/:id/resolve", async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (
        !Number.isSafeInteger(body.revision) ||
        (body.revision as number) < 0 ||
        !["done", "failed", "cancelled"].includes(String(body.status)) ||
        typeof body.note !== "string" ||
        !body.note.trim() ||
        body.note.length > 4000
      ) {
        return c.json(
          { success: false, error: "Expected revision, resolution status, and review note" },
          400
        );
      }
      const task = store().resolveTask(
        c.req.param("id"),
        body.revision as number,
        body.status as "done" | "failed" | "cancelled",
        body.note.trim()
      );
      if (task?.status === "done" && deps.bridge && deps.agent) {
        await new TaskDependencyResolver(
          store(),
          deps.bridge,
          deps.agent.getConfig()
        ).onTaskComplete(task.id);
      }
      return task
        ? c.json({ success: true, data: task })
        : c.json(
            { success: false, error: "Task changed or cannot be resolved; refresh first" },
            409
          );
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  app.post("/:id/new-attempt", async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (
        !Number.isSafeInteger(body.revision) ||
        (body.revision as number) < 0 ||
        typeof body.note !== "string" ||
        !body.note.trim() ||
        body.note.length > 4000
      ) {
        return c.json(
          { success: false, error: "Expected current revision and a new-attempt review note" },
          400
        );
      }
      const replacement = store().createNewAttempt(
        c.req.param("id"),
        body.revision as number,
        body.note.trim()
      );
      if (!replacement)
        return c.json(
          {
            success: false,
            error:
              "Resolve the previous incomplete/unknown task and its operations first, then refresh; a replacement may already exist",
          },
          409
        );
      if (deps.bridge && deps.agent)
        await new TaskDependencyResolver(store(), deps.bridge, deps.agent.getConfig()).triggerTask(
          replacement.id
        );
      return c.json({ success: true, data: replacement }, 201);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // Cancel task
  app.post("/:id/cancel", (c) => {
    try {
      const updated = store().cancelTask(c.req.param("id"));
      if (!updated) {
        const response: APIResponse = {
          success: false,
          error: "Task is missing or already started; refresh before cancelling",
        };
        return c.json(response, 409);
      }

      const response: APIResponse = { success: true, data: updated };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  return app;
}
