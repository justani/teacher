import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import schema, {
  latencyFlow,
  latencyOutcome,
  latencyStage,
  privatePreparation,
  sessionStatus,
  tutorSpeechChunk,
} from "./schema";

const optionalDuration = v.optional(v.number());

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
      latestBoardDocument: v.optional(v.string()),
      boardRevision: v.optional(v.number()),
      turns: v.array(
        v.object({
          _id: v.id("tutorTurns"),
          _creationTime: v.number(),
          speaker: v.union(v.literal("learner"), v.literal("tutor")),
          text: v.string(),
          speechChunks: v.optional(v.array(tutorSpeechChunk)),
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
      latestBoardDocument: session.latestBoardDocument,
      boardRevision: session.boardRevision,
      turns: turns.map(({ _id, _creationTime, speaker, text, speechChunks }) => ({
        _id,
        _creationTime,
        speaker,
        text,
        speechChunks,
      })),
    };
  },
});

export const getInternal = internalQuery({
  args: { sessionId: v.id("tutorSessions") },
  returns: v.union(v.null(), schema.doc("tutorSessions")),
  handler: async (ctx, args) => ctx.db.get("tutorSessions", args.sessionId),
});

export const saveBoardCheckpoint = mutation({
  args: {
    sessionId: v.id("tutorSessions"),
    actor: v.union(v.literal("learner"), v.literal("tutor")),
    revision: v.number(),
    document: v.string(),
    summary: v.string(),
  },
  returns: v.id("boardCheckpoints"),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("tutorSessions", args.sessionId);
    if (!session) throw new Error("Session not found.");
    if (args.document.length > 450_000) throw new Error("The board is too large to save.");
    if (args.summary.length > 20_000) throw new Error("The board summary is too large to save.");
    if ((session.boardRevision ?? -1) >= args.revision) {
      throw new Error("This board checkpoint is older than the saved board.");
    }

    const checkpointId = await ctx.db.insert("boardCheckpoints", {
      sessionId: args.sessionId,
      actor: args.actor,
      revision: args.revision,
      document: args.document,
      summary: args.summary,
    });
    await ctx.db.patch("tutorSessions", args.sessionId, {
      latestBoardDocument: args.document,
      boardRevision: args.revision,
    });
    return checkpointId;
  },
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
    speechChunks: v.optional(v.array(tutorSpeechChunk)),
  },
  returns: v.id("tutorTurns"),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("tutorSessions", args.sessionId);
    if (!session) throw new Error("Session not found.");
    const turnId = await ctx.db.insert("tutorTurns", {
      sessionId: args.sessionId,
      speaker: args.speaker,
      text: args.text,
      speechChunks: args.speechChunks,
    });
    await ctx.db.patch("tutorSessions", args.sessionId, {
      status: args.nextStatus,
      errorMessage: undefined,
    });
    return turnId;
  },
});

export const recordBackendLatency = internalMutation({
  args: {
    sessionId: v.id("tutorSessions"),
    flow: latencyFlow,
    outcome: latencyOutcome,
    stage: latencyStage,
    totalMs: v.number(),
    imageLoadMs: optionalDuration,
    extractionMs: optionalDuration,
    openingGenerationMs: optionalDuration,
    openingRetryCount: v.optional(v.number()),
    audioLoadMs: optionalDuration,
    sttMs: optionalDuration,
    tutorGenerationMs: optionalDuration,
  },
  returns: v.id("tutorLatencyEvents"),
  handler: async (ctx, args) => {
    return ctx.db.insert("tutorLatencyEvents", {
      ...args,
      source: "backend_action",
    });
  },
});

export const recordTtsLatency = mutation({
  args: {
    sessionId: v.id("tutorSessions"),
    flow: latencyFlow,
    outcome: latencyOutcome,
    totalMs: v.number(),
    ttsResponseHeadersMs: optionalDuration,
    ttsFirstAudioMs: optionalDuration,
    ttsStreamCompleteMs: optionalDuration,
    ttsPlaybackCompleteMs: optionalDuration,
  },
  returns: v.id("tutorLatencyEvents"),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("tutorSessions", args.sessionId);
    if (!session) throw new Error("Session not found.");
    const durations = [
      args.totalMs,
      args.ttsResponseHeadersMs,
      args.ttsFirstAudioMs,
      args.ttsStreamCompleteMs,
      args.ttsPlaybackCompleteMs,
    ];
    if (durations.some((duration) => duration !== undefined && (duration < 0 || duration > 600_000))) {
      throw new Error("Invalid latency duration.");
    }
    return ctx.db.insert("tutorLatencyEvents", {
      ...args,
      source: "client_tts",
      stage: args.outcome === "success" ? "complete" : "tts",
    });
  },
});

export const deleteStorageObject = internalMutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const storedFile = await ctx.db.system.get("_storage", args.storageId);
    if (storedFile) await ctx.storage.delete(args.storageId);
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
