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

export const boardAction = v.union(
  v.object({
    type: v.literal("addText"),
    text: v.string(),
    x: v.number(),
    y: v.number(),
  }),
  v.object({
    type: v.literal("addArrow"),
    startX: v.number(),
    startY: v.number(),
    endX: v.number(),
    endY: v.number(),
  }),
  v.object({
    type: v.literal("highlight"),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
  }),
  v.object({
    type: v.literal("crossOut"),
    startX: v.number(),
    startY: v.number(),
    endX: v.number(),
    endY: v.number(),
  }),
  v.object({
    type: v.literal("addCircle"),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
  }),
  v.object({
    type: v.literal("addLine"),
    startX: v.number(),
    startY: v.number(),
    endX: v.number(),
    endY: v.number(),
  }),
  v.object({
    type: v.literal("moveTutorShape"),
    targetId: v.string(),
    x: v.number(),
    y: v.number(),
  }),
  v.object({
    type: v.literal("updateTutorText"),
    targetId: v.string(),
    text: v.string(),
  }),
  v.object({
    type: v.literal("removeTutorShape"),
    targetId: v.string(),
  }),
);

export const tutorSpeechChunk = v.object({
  say: v.string(),
  actions: v.array(boardAction),
});

export const latencyFlow = v.union(
  v.literal("opening"),
  v.literal("learner_turn"),
);

export const latencySource = v.union(
  v.literal("backend_action"),
  v.literal("client_tts"),
);

export const latencyOutcome = v.union(
  v.literal("success"),
  v.literal("error"),
);

export const latencyStage = v.union(
  v.literal("image_load"),
  v.literal("extraction"),
  v.literal("opening_generation"),
  v.literal("audio_load"),
  v.literal("stt"),
  v.literal("tutor_generation"),
  v.literal("tts"),
  v.literal("complete"),
);

const schema = defineSchema({
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
    latestBoardDocument: v.optional(v.string()),
    boardRevision: v.optional(v.number()),
  }),
  tutorTurns: defineTable({
    sessionId: v.id("tutorSessions"),
    speaker: v.union(v.literal("learner"), v.literal("tutor")),
    text: v.string(),
    speechChunks: v.optional(v.array(tutorSpeechChunk)),
  }).index("by_sessionId", ["sessionId"]),
  boardCheckpoints: defineTable({
    sessionId: v.id("tutorSessions"),
    actor: v.union(v.literal("learner"), v.literal("tutor")),
    revision: v.number(),
    document: v.string(),
    summary: v.string(),
  }).index("by_sessionId", ["sessionId"]),
  tutorLatencyEvents: defineTable({
    sessionId: v.id("tutorSessions"),
    flow: latencyFlow,
    source: latencySource,
    outcome: latencyOutcome,
    stage: latencyStage,
    totalMs: v.number(),
    imageLoadMs: v.optional(v.number()),
    extractionMs: v.optional(v.number()),
    openingGenerationMs: v.optional(v.number()),
    openingRetryCount: v.optional(v.number()),
    audioLoadMs: v.optional(v.number()),
    sttMs: v.optional(v.number()),
    tutorGenerationMs: v.optional(v.number()),
    ttsResponseHeadersMs: v.optional(v.number()),
    ttsFirstAudioMs: v.optional(v.number()),
    ttsStreamCompleteMs: v.optional(v.number()),
    ttsPlaybackCompleteMs: v.optional(v.number()),
  }).index("by_sessionId", ["sessionId"]),
});

export default schema;
