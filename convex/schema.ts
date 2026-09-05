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
    ref: v.optional(v.string()),
    text: v.string(),
    x: v.number(),
    y: v.number(),
  }),
  v.object({
    type: v.literal("addFraction"),
    ref: v.string(),
    numerator: v.string(),
    denominator: v.string(),
    x: v.number(),
    y: v.number(),
  }),
  v.object({
    type: v.literal("cancelFraction"),
    ref: v.string(),
    fractionId: v.string(),
    factor: v.number(),
  }),
  v.object({
    type: v.literal("addArrow"),
    ref: v.optional(v.string()),
    startX: v.number(),
    startY: v.number(),
    endX: v.number(),
    endY: v.number(),
  }),
  v.object({
    type: v.literal("highlight"),
    ref: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
  }),
  v.object({
    type: v.literal("crossOut"),
    ref: v.optional(v.string()),
    startX: v.number(),
    startY: v.number(),
    endX: v.number(),
    endY: v.number(),
  }),
  v.object({
    type: v.literal("addCircle"),
    ref: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
  }),
  v.object({
    type: v.literal("addShape"),
    ref: v.optional(v.string()),
    shape: v.union(
      v.literal("rectangle"),
      v.literal("ellipse"),
      v.literal("triangle"),
      v.literal("diamond"),
      v.literal("pentagon"),
      v.literal("hexagon"),
      v.literal("trapezoid"),
    ),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
    label: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("addLine"),
    ref: v.optional(v.string()),
    startX: v.number(),
    startY: v.number(),
    endX: v.number(),
    endY: v.number(),
  }),
  v.object({
    type: v.literal("addPoint"),
    ref: v.string(),
    x: v.number(),
    y: v.number(),
    label: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("addCenterPoint"),
    ref: v.string(),
    circleId: v.string(),
    label: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("addSegment"),
    ref: v.string(),
    startPointId: v.string(),
    endPointId: v.string(),
  }),
  v.object({
    type: v.literal("addCircumcircle"),
    ref: v.string(),
    pointAId: v.string(),
    pointBId: v.string(),
    pointCId: v.string(),
  }),
  v.object({
    type: v.literal("addAngleMark"),
    ref: v.string(),
    pointAId: v.string(),
    vertexPointId: v.string(),
    pointCId: v.string(),
    label: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("moveTutorShape"),
    targetId: v.string(),
    x: v.number(),
    y: v.number(),
  }),
  v.object({
    type: v.literal("resizeTutorShape"),
    targetId: v.string(),
    width: v.number(),
    height: v.number(),
  }),
  v.object({
    type: v.literal("rotateTutorShape"),
    targetId: v.string(),
    degrees: v.number(),
  }),
  v.object({
    type: v.literal("styleTutorShape"),
    targetId: v.string(),
    color: v.union(
      v.literal("black"),
      v.literal("grey"),
      v.literal("red"),
      v.literal("orange"),
      v.literal("yellow"),
      v.literal("green"),
      v.literal("blue"),
      v.literal("violet"),
    ),
    fill: v.union(v.literal("none"), v.literal("semi"), v.literal("solid")),
    dash: v.union(
      v.literal("draw"),
      v.literal("solid"),
      v.literal("dashed"),
      v.literal("dotted"),
    ),
  }),
  v.object({
    type: v.literal("groupTutorShapes"),
    ref: v.optional(v.string()),
    targetIds: v.array(v.string()),
  }),
  v.object({
    type: v.literal("alignTutorShapes"),
    alignment: v.union(
      v.literal("left"),
      v.literal("center-horizontal"),
      v.literal("right"),
      v.literal("top"),
      v.literal("center-vertical"),
      v.literal("bottom"),
    ),
    targetIds: v.array(v.string()),
  }),
  v.object({
    type: v.literal("distributeTutorShapes"),
    direction: v.union(v.literal("horizontal"), v.literal("vertical")),
    targetIds: v.array(v.string()),
  }),
  v.object({
    type: v.literal("reorderTutorShapes"),
    position: v.union(
      v.literal("front"),
      v.literal("forward"),
      v.literal("backward"),
      v.literal("back"),
    ),
    targetIds: v.array(v.string()),
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
    problemImageId: v.optional(v.id("_storage")),
    sampleId: v.optional(v.string()),
    samplePreparationVersion: v.optional(v.number()),
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
  tutorVisualPlans: defineTable({
    sessionId: v.id("tutorSessions"),
    sourceBoardRevision: v.number(),
    speech: v.string(),
    drawingDirection: v.string(),
    actions: v.array(boardAction),
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
