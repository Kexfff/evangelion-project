import { z } from "zod";
import { taskInputSchema } from "../src/shared/autonomy";
import { Autonomy } from "./autonomy";
export const schedulingTools = [
  {
    type: "function",
    function: {
      name: "create_task",
      description:
        "Propose a one-time conversational reminder requested by the user. It is NOT armed until the user approves it in Consciousness settings. Never claim it is armed. No PC/game/external actions.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          intent: { type: "string" },
          dueAt: {
            type: "string",
            description:
              "Exact future ISO-8601 timestamp with Z or numeric offset. Clarify ambiguous dates first.",
          },
          timeZone: {
            type: "string",
            description: "IANA zone such as Europe/Moscow.",
          },
        },
        required: ["title", "intent", "dueAt", "timeZone"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "List this character's pending/approval tasks with persistent IDs and exact times.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_task",
      description:
        "Cancel a task by ID only when the current user asks to cancel it.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
];
export function executeScheduleTool(
  autonomy: Autonomy,
  name: string,
  args: unknown,
) {
  if (!autonomy.config.schedulingTools)
    throw new Error("Scheduling tools disabled.");
  if (name === "create_task")
    return autonomy.createTask(taskInputSchema.parse(args), "llm");
  if (name === "list_tasks")
    return autonomy
      .snapshot()
      .tasks.filter((t) => ["pending", "approval"].includes(t.status))
      .slice(-100);
  if (name === "cancel_task") {
    const { id } = z.object({ id: z.string().uuid() }).parse(args);
    autonomy.taskAction(id, "cancel");
    return { id, status: "cancelled" };
  }
  throw new Error("Unknown scheduling tool.");
}
