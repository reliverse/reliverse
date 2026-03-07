import { z } from "zod";
import { zodTable } from "zodvex";

export const Tasks = zodTable("tasks", {
  text: z.string(),
  completed: z.boolean(),
  createdAt: z.number(),
});
