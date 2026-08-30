import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { privatePreparation, sessionStatus } from "./schema";

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const create = mutation({
  args: {
    problemImageId: v.id("_storage"),
    sourceFileName: v.string(),
  },
  returns: v.id("tutorSessions"),
  handler: async (ctx, args) => {
    const sourceFileName = args.sourceFileName.trim().slice(0, 160) || "problem.jpg";
    const agentThreadId = await createThread(ctx, components.agent, {
      title: `Math problem: ${sourceFileName}`,
    });

    return ctx.db.insert("tutorSessions", {
      problemImageId: args.problemImageId,
      sourceFileName,
      status: "preparing",
      agentThreadId,
    });
  },
});

export const getLearnerView = query({
  args: { sessionId: v.id("tutorSessions") },
  returns: v.union(
    v.null(),
    v.object({
      status: sessionStatus,
      problemText: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      turns: v.array(
        v.object({
          _id: v.id("tutorTurns"),
          _creationTime: v.number(),
          speaker: v.union(v.literal("learner"), v.literal("tutor")),
          text: v.string(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("tutorSessions", args.sessionId);
    if (!session) return null;

    const turns = await ctx.db
      .query("tutorTurns")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .take(60);

    return {
      status: session.status,
      problemText: session.problemText,
      errorMessage: session.errorMessage,
      turns: turns.map(({ _id, _creationTime, speaker, text }) => ({
        _id,
        _creationTime,
        speaker,
        text,
      })),
    };
  },
});

export const getInternal = internalQuery({
  args: { sessionId: v.id("tutorSessions") },
  handler: async (ctx, args) => ctx.db.get("tutorSessions", args.sessionId),
});

export const markStatus = internalMutation({
  args: {
    sessionId: v.id("tutorSessions"),
    status: sessionStatus,
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("tutorSessions", args.sessionId);
    if (!session) throw new Error("Session not found.");
    await ctx.db.patch("tutorSessions", args.sessionId, {
      status: args.status,
      errorMessage: args.errorMessage,
    });
    return null;
  },
});

export const savePreparation = internalMutation({
  args: {
    sessionId: v.id("tutorSessions"),
    preparation: privatePreparation,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("tutorSessions", args.sessionId);
    if (!session) throw new Error("Session not found.");
    await ctx.db.patch("tutorSessions", args.sessionId, {
      preparation: args.preparation,
      problemText: args.preparation.problemText,
      status: "ready",
      errorMessage: undefined,
    });
    return null;
  },
});

export const saveTurn = internalMutation({
  args: {
    sessionId: v.id("tutorSessions"),
    speaker: v.union(v.literal("learner"), v.literal("tutor")),
    text: v.string(),
    nextStatus: sessionStatus,
  },
  returns: v.id("tutorTurns"),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("tutorSessions", args.sessionId);
    if (!session) throw new Error("Session not found.");
    const turnId = await ctx.db.insert("tutorTurns", {
      sessionId: args.sessionId,
      speaker: args.speaker,
      text: args.text,
    });
    await ctx.db.patch("tutorSessions", args.sessionId, {
      status: args.nextStatus,
      errorMessage: undefined,
    });
    return turnId;
  },
});

export const deleteStorageObject = internalMutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.storageId);
    return null;
  },
});

export const end = mutation({
  args: { sessionId: v.id("tutorSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("tutorSessions", args.sessionId);
    if (!session) throw new Error("Session not found.");
    await ctx.db.patch("tutorSessions", args.sessionId, { status: "ended" });
    return null;
  },
});

export const finishPlayback = mutation({
  args: { sessionId: v.id("tutorSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("tutorSessions", args.sessionId);
    if (!session) throw new Error("Session not found.");
    if (session.status === "speaking") {
      await ctx.db.patch("tutorSessions", args.sessionId, { status: "listening" });
    }
    return null;
  },
});
