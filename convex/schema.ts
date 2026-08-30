import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const sessionStatus = v.union(
  v.literal("preparing"),
  v.literal("ready"),
  v.literal("listening"),
  v.literal("thinking"),
  v.literal("speaking"),
  v.literal("ended"),
  v.literal("error"),
);

export const extractionConfidence = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

export const privatePreparation = v.object({
  problemText: v.string(),
  confidence: extractionConfidence,
  clarificationNeeded: v.optional(v.string()),
  exactAnswer: v.string(),
  approximateAnswer: v.optional(v.string()),
  units: v.optional(v.string()),
  mainConcept: v.string(),
  prerequisites: v.array(v.string()),
  completeSolution: v.array(v.string()),
  checkpoints: v.array(v.string()),
  likelyMisconceptions: v.array(v.string()),
  teachingMoves: v.array(
    v.object({
      level: v.union(
        v.literal("redirect"),
        v.literal("hint"),
        v.literal("prerequisite"),
        v.literal("explain"),
      ),
      prompt: v.string(),
    }),
  ),
  transferProblem: v.string(),
  transferAnswer: v.string(),
});

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    completed: v.boolean(),
  }),
  tutorSessions: defineTable({
    problemImageId: v.id("_storage"),
    sourceFileName: v.string(),
    status: sessionStatus,
    problemText: v.optional(v.string()),
    preparation: v.optional(privatePreparation),
    agentThreadId: v.string(),
    errorMessage: v.optional(v.string()),
  }),
  tutorTurns: defineTable({
    sessionId: v.id("tutorSessions"),
    speaker: v.union(v.literal("learner"), v.literal("tutor")),
    text: v.string(),
  }).index("by_sessionId", ["sessionId"]),
});
