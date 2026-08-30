import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").order("desc").collect();
  },
});

export const add = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    const cleanTitle = title.trim();

    if (!cleanTitle || cleanTitle.length > 120) {
      throw new Error("Task titles must be between 1 and 120 characters.");
    }

    return await ctx.db.insert("tasks", {
      title: cleanTitle,
      completed: false,
    });
  },
});

export const toggle = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    const task = await ctx.db.get(id);

    if (!task) {
      throw new Error("Task not found.");
    }

    await ctx.db.patch(id, { completed: !task.completed });
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
