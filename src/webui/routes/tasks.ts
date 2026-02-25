import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getTaskStore, type TaskStatus } from "../../memory/agent/tasks.js";
import { getErrorMessage } from "../../utils/errors.js";

const VALID_STATUSES: TaskStatus[] = ["pending", "in_progress", "done", "failed", "cancelled"];
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
      }));

      const response: APIResponse = { success: true, data: enriched };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
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
      };

      const response: APIResponse = { success: true, data: enriched };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Delete task
  app.delete("/:id", (c) => {
    try {
      const deleted = store().deleteTask(c.req.param("id"));
      if (!deleted) {
        const response: APIResponse = { success: false, error: "Task not found" };
        return c.json(response, 404);
      }

      const response: APIResponse = { success: true, data: { message: "Task deleted" } };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
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
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
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
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  // Cancel task
  app.post("/:id/cancel", (c) => {
    try {
      const updated = store().cancelTask(c.req.param("id"));
      if (!updated) {
        const response: APIResponse = { success: false, error: "Task not found" };
        return c.json(response, 404);
      }

      const response: APIResponse = { success: true, data: updated };
      return c.json(response);
    } catch (error) {
      const response: APIResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      return c.json(response, 500);
    }
  });

  return app;
}
