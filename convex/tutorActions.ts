"use node";

import { Agent } from "@convex-dev/agent";
import { createVertex } from "@ai-sdk/google-vertex";
import { generateObject, generateText, NoObjectGeneratedError } from "ai";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, env, type ActionCtx } from "./_generated/server";
import { boardAction, tutorSpeechChunk } from "./schema";
import {
  buildDrawingPrompt,
  buildOpeningPrompt,
  buildTurnPrompt,
  cleanTutorReply,
  MAX_BOARD_SUMMARY_CHARACTERS,
  TUTOR_SYSTEM_PROMPT,
} from "./tutorPrompt";

const preparationSchema = z.object({
  problemText: z.string().min(3).max(1200),
  confidence: z.enum(["high", "medium", "low"]),
  clarificationNeeded: z.string().min(1).max(240).optional(),
  exactAnswer: z.string().min(1).max(160),
  approximateAnswer: z.string().min(1).max(160).optional(),
  units: z.string().min(1).max(60).optional(),
  mainConcept: z.string().min(1).max(240),
  prerequisites: z.array(z.string().min(1).max(180)).max(5),
  completeSolution: z.array(z.string().min(1).max(300)).min(1).max(10),
  checkpoints: z.array(z.string().min(1).max(220)).min(1).max(8),
  likelyMisconceptions: z.array(z.string().min(1).max(220)).max(8),
  teachingMoves: z
    .array(
      z.object({
        level: z.enum(["redirect", "hint", "prerequisite", "explain"]),
        prompt: z.string().min(1).max(240),
      }),
    )
    .min(2)
    .max(12),
  transferProblem: z.string().min(1).max(500),
  transferAnswer: z.string().min(1).max(200),
});

const normalizedCoordinate = z.number().min(0).max(1);
const requiredShapeRef = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/);
const shapeRef = requiredShapeRef.optional();
const semanticPointId = z.string().min(1).max(160);
const plainBoardText = z
  .string()
  .min(1)
  .max(80)
  .refine((text) => !/[\\$]/.test(text), "Board text must not contain LaTeX.");
const drawingShapeKinds = [
  "rectangle",
  "ellipse",
  "triangle",
  "diamond",
  "pentagon",
  "hexagon",
  "trapezoid",
] as const;
const boardActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("addText"),
    ref: shapeRef,
    text: plainBoardText,
    x: normalizedCoordinate,
    y: normalizedCoordinate,
  }),
  z.object({
    type: z.literal("addFraction"),
    ref: requiredShapeRef,
    numerator: plainBoardText,
    denominator: plainBoardText,
    x: normalizedCoordinate,
    y: normalizedCoordinate,
  }),
  z.object({
    type: z.literal("cancelFraction"),
    ref: requiredShapeRef,
    fractionId: z.string().min(1).max(160),
    factor: z.number().positive().max(1_000_000_000),
  }),
  z.object({
    type: z.literal("addArrow"),
    ref: shapeRef,
    startX: normalizedCoordinate,
    startY: normalizedCoordinate,
    endX: normalizedCoordinate,
    endY: normalizedCoordinate,
  }),
  z.object({
    type: z.literal("highlight"),
    ref: shapeRef,
    x: normalizedCoordinate,
    y: normalizedCoordinate,
    width: z.number().min(0.04).max(0.5),
    height: z.number().min(0.04).max(0.35),
  }),
  z.object({
    type: z.literal("crossOut"),
    ref: shapeRef,
    startX: normalizedCoordinate,
    startY: normalizedCoordinate,
    endX: normalizedCoordinate,
    endY: normalizedCoordinate,
  }),
  z.object({
    type: z.literal("addCircle"),
    ref: shapeRef,
    x: normalizedCoordinate,
    y: normalizedCoordinate,
    width: z.number().min(0.06).max(0.65),
    height: z.number().min(0.06).max(0.65),
  }),
  z.object({
    type: z.literal("addShape"),
    ref: shapeRef,
    shape: z.enum(drawingShapeKinds),
    x: normalizedCoordinate,
    y: normalizedCoordinate,
    width: z.number().min(0.06).max(0.65),
    height: z.number().min(0.06).max(0.65),
    label: z.string().min(1).max(80).optional(),
  }),
  z.object({
    type: z.literal("addLine"),
    ref: shapeRef,
    startX: normalizedCoordinate,
    startY: normalizedCoordinate,
    endX: normalizedCoordinate,
    endY: normalizedCoordinate,
  }),
  z.object({
    type: z.literal("addPoint"),
    ref: requiredShapeRef,
    x: normalizedCoordinate,
    y: normalizedCoordinate,
    label: z.string().min(1).max(24).optional(),
  }),
  z.object({
    type: z.literal("addCenterPoint"),
    ref: requiredShapeRef,
    circleId: z.string().min(1).max(160),
    label: z.string().min(1).max(24).optional(),
  }),
  z.object({
    type: z.literal("addSegment"),
    ref: requiredShapeRef,
    startPointId: semanticPointId,
    endPointId: semanticPointId,
  }),
  z.object({
    type: z.literal("addCircumcircle"),
    ref: requiredShapeRef,
    pointAId: semanticPointId,
    pointBId: semanticPointId,
    pointCId: semanticPointId,
  }),
  z.object({
    type: z.literal("addAngleMark"),
    ref: requiredShapeRef,
    pointAId: semanticPointId,
    vertexPointId: semanticPointId,
    pointCId: semanticPointId,
    label: z.string().min(1).max(24).optional(),
  }),
  z.object({
    type: z.literal("moveTutorShape"),
    targetId: z.string().min(1).max(160),
    x: normalizedCoordinate,
    y: normalizedCoordinate,
  }),
  z.object({
    type: z.literal("resizeTutorShape"),
    targetId: z.string().min(1).max(160),
    width: z.number().min(0.04).max(0.8),
    height: z.number().min(0.04).max(0.8),
  }),
  z.object({
    type: z.literal("rotateTutorShape"),
    targetId: z.string().min(1).max(160),
    degrees: z.number().min(-180).max(180),
  }),
  z.object({
    type: z.literal("styleTutorShape"),
    targetId: z.string().min(1).max(160),
    color: z.enum(["black", "grey", "red", "orange", "yellow", "green", "blue", "violet"]),
    fill: z.enum(["none", "semi", "solid"]),
    dash: z.enum(["draw", "solid", "dashed", "dotted"]),
  }),
  z.object({
    type: z.literal("groupTutorShapes"),
    ref: shapeRef,
    targetIds: z.array(z.string().min(1).max(160)).min(2).max(12),
  }),
  z.object({
    type: z.literal("alignTutorShapes"),
    alignment: z.enum([
      "left",
      "center-horizontal",
      "right",
      "top",
      "center-vertical",
      "bottom",
    ]),
    targetIds: z.array(z.string().min(1).max(160)).min(2).max(12),
  }),
  z.object({
    type: z.literal("distributeTutorShapes"),
    direction: z.enum(["horizontal", "vertical"]),
    targetIds: z.array(z.string().min(1).max(160)).min(3).max(12),
  }),
  z.object({
    type: z.literal("reorderTutorShapes"),
    position: z.enum(["front", "forward", "backward", "back"]),
    targetIds: z.array(z.string().min(1).max(160)).min(1).max(12),
  }),
  z.object({
    type: z.literal("updateTutorText"),
    targetId: z.string().min(1).max(160),
    text: plainBoardText,
  }),
  z.object({
    type: z.literal("removeTutorShape"),
    targetId: z.string().min(1).max(160),
  }),
]);

const tutorTurnSchema = z.object({
  speech: z
    .string()
    .min(1)
    .max(320)
    .describe("The complete short Hinglish reply to speak to the learner."),
  drawingDirection: z
    .string()
    .max(600)
    .describe(
      "A plain-language direction for a separate board artist. Return an empty string when no drawing helps.",
    ),
});

type TutorTurnPlan = z.infer<typeof tutorTurnSchema>;
type BoardAction = z.infer<typeof boardActionSchema>;
type TutorSpeechChunk = {
  say: string;
  actions: BoardAction[];
};
type RespondToLearnerResult = {
  transcript: string;
  tutorReply: string;
  drawingDirection: string;
  speechChunks: TutorSpeechChunk[];
};

const respondToLearnerResult = v.object({
  transcript: v.string(),
  tutorReply: v.string(),
  drawingDirection: v.string(),
  speechChunks: v.array(tutorSpeechChunk),
});

type BackendLatencyOutcome = "success" | "error";
type BackendLatencyStage =
  | "image_load"
  | "extraction"
  | "opening_generation"
  | "audio_load"
  | "stt"
  | "tutor_generation"
  | "complete";

const OPENING_OUTPUT_TOKENS = 1024;
const TUTOR_TURN_OUTPUT_TOKENS = 1024;
const MAX_DRAWING_ACTIONS = 12;

function openingGenerationOptions(prompt: string) {
  return {
    prompt,
    maxOutputTokens: OPENING_OUTPUT_TOKENS,
    reasoning: "none" as const,
  };
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function parseDrawingNumber(value: string | undefined) {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTargetIds(value: string | undefined) {
  if (!value) return [];
  return [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
}

function parseDrawingProtocol(text: string): BoardAction[] {
  const actions: BoardAction[] = [];
  const lines = text
    .replace(/```(?:text)?/gi, "")
    .replace(/```/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);

  for (const line of lines) {
    if (line.toUpperCase() === "NONE") return [];
    const parts = line.split("|").map((part) => part.trim());
    const command = parts[0]?.toUpperCase();
    const number = (index: number) => parseDrawingNumber(parts[index]);
    let candidate: unknown = null;

    const hasCreationRef = number(1) === null;
    const creationOffset = hasCreationRef ? 1 : 0;
    const shapeHasCreationRef =
      command === "SHAPE" &&
      !drawingShapeKinds.includes(parts[1]?.toLowerCase() as (typeof drawingShapeKinds)[number]);

    if (
      command === "TEXT" &&
      number(1 + creationOffset) !== null &&
      number(2 + creationOffset) !== null
    ) {
      candidate = {
        type: "addText",
        ref: hasCreationRef ? parts[1] : undefined,
        x: number(1 + creationOffset),
        y: number(2 + creationOffset),
        text: parts.slice(3 + creationOffset).join("|").trim(),
      };
    } else if (
      command === "FRACTION" &&
      parts[1] &&
      number(2) !== null &&
      number(3) !== null &&
      parts[4] &&
      parts[5]
    ) {
      candidate = {
        type: "addFraction",
        ref: parts[1],
        x: number(2),
        y: number(3),
        numerator: parts[4],
        denominator: parts[5],
      };
    } else if (
      command === "CANCEL_FRACTION" &&
      parts[1] &&
      parts[2] &&
      number(3) !== null
    ) {
      candidate = {
        type: "cancelFraction",
        ref: parts[1],
        fractionId: parts[2],
        factor: number(3),
      };
    } else if (
      ["ARROW", "CROSS_OUT", "LINE"].includes(command ?? "") &&
      number(1 + creationOffset) !== null &&
      number(2 + creationOffset) !== null &&
      number(3 + creationOffset) !== null &&
      number(4 + creationOffset) !== null
    ) {
      candidate = {
        type:
          command === "ARROW"
            ? "addArrow"
            : command === "CROSS_OUT"
              ? "crossOut"
              : "addLine",
        ref: hasCreationRef ? parts[1] : undefined,
        startX: number(1 + creationOffset),
        startY: number(2 + creationOffset),
        endX: number(3 + creationOffset),
        endY: number(4 + creationOffset),
      };
    } else if (
      ["HIGHLIGHT", "CIRCLE"].includes(command ?? "") &&
      number(1 + creationOffset) !== null &&
      number(2 + creationOffset) !== null &&
      number(3 + creationOffset) !== null &&
      number(4 + creationOffset) !== null
    ) {
      candidate = {
        type: command === "HIGHLIGHT" ? "highlight" : "addCircle",
        ref: hasCreationRef ? parts[1] : undefined,
        x: number(1 + creationOffset),
        y: number(2 + creationOffset),
        width: number(3 + creationOffset),
        height: number(4 + creationOffset),
      };
    } else if (
      command === "SHAPE" &&
      parts[1] &&
      parts[shapeHasCreationRef ? 2 : 1] &&
      number(shapeHasCreationRef ? 3 : 2) !== null &&
      number(shapeHasCreationRef ? 4 : 3) !== null &&
      number(shapeHasCreationRef ? 5 : 4) !== null &&
      number(shapeHasCreationRef ? 6 : 5) !== null
    ) {
      const offset = shapeHasCreationRef ? 1 : 0;
      candidate = {
        type: "addShape",
        ref: shapeHasCreationRef ? parts[1] : undefined,
        shape: parts[1 + offset].toLowerCase(),
        x: number(2 + offset),
        y: number(3 + offset),
        width: number(4 + offset),
        height: number(5 + offset),
        label: parts.slice(6 + offset).join("|").trim() || undefined,
      };
    } else if (
      command === "POINT" &&
      parts[1] &&
      number(2) !== null &&
      number(3) !== null
    ) {
      candidate = {
        type: "addPoint",
        ref: parts[1],
        x: number(2),
        y: number(3),
        label: parts.slice(4).join("|").trim() || undefined,
      };
    } else if (command === "CENTER_POINT" && parts[1] && parts[2]) {
      candidate = {
        type: "addCenterPoint",
        ref: parts[1],
        circleId: parts[2],
        label: parts.slice(3).join("|").trim() || undefined,
      };
    } else if (command === "SEGMENT" && parts[1] && parts[2] && parts[3]) {
      candidate = {
        type: "addSegment",
        ref: parts[1],
        startPointId: parts[2],
        endPointId: parts[3],
      };
    } else if (
      command === "CIRCUMCIRCLE" &&
      parts[1] &&
      parts[2] &&
      parts[3] &&
      parts[4]
    ) {
      candidate = {
        type: "addCircumcircle",
        ref: parts[1],
        pointAId: parts[2],
        pointBId: parts[3],
        pointCId: parts[4],
      };
    } else if (
      command === "ANGLE_MARK" &&
      parts[1] &&
      parts[2] &&
      parts[3] &&
      parts[4]
    ) {
      candidate = {
        type: "addAngleMark",
        ref: parts[1],
        pointAId: parts[2],
        vertexPointId: parts[3],
        pointCId: parts[4],
        label: parts.slice(5).join("|").trim() || undefined,
      };
    } else if (
      command === "MOVE" &&
      parts[1] &&
      number(2) !== null &&
      number(3) !== null
    ) {
      candidate = {
        type: "moveTutorShape",
        targetId: parts[1],
        x: number(2),
        y: number(3),
      };
    } else if (
      command === "RESIZE" &&
      parts[1] &&
      number(2) !== null &&
      number(3) !== null
    ) {
      candidate = {
        type: "resizeTutorShape",
        targetId: parts[1],
        width: number(2),
        height: number(3),
      };
    } else if (command === "ROTATE" && parts[1] && number(2) !== null) {
      candidate = {
        type: "rotateTutorShape",
        targetId: parts[1],
        degrees: number(2),
      };
    } else if (command === "STYLE" && parts[1] && parts[2] && parts[3] && parts[4]) {
      candidate = {
        type: "styleTutorShape",
        targetId: parts[1],
        color: parts[2].toLowerCase(),
        fill: parts[3].toLowerCase(),
        dash: parts[4].toLowerCase(),
      };
    } else if (command === "GROUP") {
      candidate = {
        type: "groupTutorShapes",
        ref: parts[2] ? parts[1] : undefined,
        targetIds: parseTargetIds(parts[2] ?? parts[1]),
      };
    } else if (command === "ALIGN" && parts[1]) {
      candidate = {
        type: "alignTutorShapes",
        alignment: parts[1].toLowerCase(),
        targetIds: parseTargetIds(parts[2]),
      };
    } else if (command === "DISTRIBUTE" && parts[1]) {
      candidate = {
        type: "distributeTutorShapes",
        direction: parts[1].toLowerCase(),
        targetIds: parseTargetIds(parts[2]),
      };
    } else if (command === "REORDER" && parts[1]) {
      candidate = {
        type: "reorderTutorShapes",
        position: parts[1].toLowerCase(),
        targetIds: parseTargetIds(parts[2]),
      };
    } else if (command === "UPDATE_TEXT" && parts[1]) {
      candidate = {
        type: "updateTutorText",
        targetId: parts[1],
        text: parts.slice(2).join("|").trim(),
      };
    } else if (command === "REMOVE" && parts[1]) {
      candidate = { type: "removeTutorShape", targetId: parts[1] };
    }

    const parsed = boardActionSchema.safeParse(candidate);
    if (parsed.success) actions.push(parsed.data);
    if (actions.length === MAX_DRAWING_ACTIONS) break;
  }

  return actions;
}

function protocolLineCount(text: string) {
  if (text.trim().toUpperCase() === "NONE") return 0;
  return text
    .replace(/```(?:text)?/gi, "")
    .replace(/```/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean)
    .slice(0, MAX_DRAWING_ACTIONS).length;
}

function requiredEnv(name: string, value: string | undefined) {
  if (!value) throw new ConvexError(`${name} is not configured on the server.`);
  return value;
}

function createGeminiProvider() {
  return {
    provider: createVertex({
      project: requiredEnv("GOOGLE_CLOUD_PROJECT", env.GOOGLE_CLOUD_PROJECT),
      location: env.GOOGLE_CLOUD_LOCATION ?? "global",
      googleAuthOptions: {
        credentials: {
          client_email: requiredEnv("GOOGLE_CLIENT_EMAIL", env.GOOGLE_CLIENT_EMAIL),
          private_key: requiredEnv("GOOGLE_PRIVATE_KEY", env.GOOGLE_PRIVATE_KEY).replace(
            /\\n/g,
            "\n",
          ),
        },
      },
    }),
    model: env.GEMINI_TEXT_MODEL ?? "gemini-3.7-flash",
  };
}

function createTutorAgent() {
  const { provider, model } = createGeminiProvider();
  return new Agent(components.agent, {
    name: "Axiom maths tutor",
    languageModel: provider(model),
    instructions: TUTOR_SYSTEM_PROMPT,
    storageOptions: { saveMessages: "all" },
  });
}

function safeProviderMessage(error: unknown) {
  if (error instanceof ConvexError) return error.message;
  return "The AI service could not complete that request. Please try again.";
}

function providerErrorMetadata(error: unknown) {
  if (!(error instanceof Error)) return { errorType: typeof error };
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : undefined;
  if (NoObjectGeneratedError.isInstance(error)) {
    return {
      errorName: error.name,
      statusCode,
      finishReason: error.finishReason,
      outputCharacters: error.text?.length,
      causeName: error.cause instanceof Error ? error.cause.name : undefined,
    };
  }
  return { errorName: error.name, statusCode };
}

function audioFileName(contentType: string) {
  const baseType = contentType.split(";", 1)[0].toLowerCase();
  if (baseType === "audio/mp4" || baseType === "audio/m4a") return "learner-answer.m4a";
  if (baseType === "audio/ogg") return "learner-answer.ogg";
  if (baseType === "audio/wav" || baseType === "audio/x-wav") return "learner-answer.wav";
  if (baseType === "audio/mpeg") return "learner-answer.mp3";
  return "learner-answer.webm";
}

function sarvamErrorDetails(body: unknown): { code?: string; requestId?: string } {
  if (typeof body !== "object" || body === null || !("error" in body)) return {};
  const error = body.error;
  if (typeof error !== "object" || error === null) return {};
  return {
    code: "code" in error && typeof error.code === "string" ? error.code : undefined,
    requestId:
      "request_id" in error && typeof error.request_id === "string"
        ? error.request_id
        : undefined,
  };
}

async function generateTutorTurn(
  ctx: ActionCtx,
  session: Doc<"tutorSessions">,
  args: {
    sessionId: Id<"tutorSessions">;
    preparation: NonNullable<Doc<"tutorSessions">["preparation"]>;
    learnerText: string;
    boardImageId?: Id<"_storage">;
    boardSummary: string;
  },
): Promise<{ result: RespondToLearnerResult; boardImageCleanupScheduled: boolean }> {
  await ctx.runMutation(internal.tutorSessions.saveTurn, {
    sessionId: args.sessionId,
    speaker: "learner",
    text: args.learnerText,
    nextStatus: "thinking",
  });

  if (args.boardSummary.length > MAX_BOARD_SUMMARY_CHARACTERS) {
    throw new ConvexError("The board summary is too large to understand safely.");
  }
  const visibleContext = await ctx.runQuery(
    internal.tutorSessions.getArtistContext,
    { sessionId: args.sessionId },
  );
  if (!visibleContext) throw new ConvexError("Session not found.");
  const boardImage = args.boardImageId
    ? await ctx.storage.get(args.boardImageId)
    : null;
  const prompt = buildTurnPrompt(
    args.preparation,
    args.learnerText,
    args.boardSummary,
    visibleContext.turns,
  );
  const boardImageBytes =
    boardImage && boardImage.size <= 5 * 1024 * 1024
      ? new Uint8Array(await boardImage.arrayBuffer())
      : null;
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  > = [{ type: "text", text: prompt }];
  if (boardImage && boardImageBytes) {
    content.push({
      type: "image",
      image: boardImageBytes,
      mediaType: boardImage.type || "image/png",
    });
  }

  const tutorAgent = createTutorAgent();
  const generationOptions = {
    contextOptions: { recentMessages: 0 },
    storageOptions: { saveMessages: "none" as const },
  };
  let generated: { object: TutorTurnPlan };
  try {
    generated = await tutorAgent.generateObject(
      ctx,
      { threadId: session.agentThreadId },
      {
        schema: tutorTurnSchema,
        messages: [{ role: "user", content }],
        maxOutputTokens: TUTOR_TURN_OUTPUT_TOKENS,
        reasoning: "none",
      },
      generationOptions,
    );
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    console.warn("Tutor turn output was malformed; retrying", providerErrorMetadata(error));
    generated = await tutorAgent.generateObject(
      ctx,
      { threadId: session.agentThreadId },
      {
        schema: tutorTurnSchema,
        messages: [
          {
            role: "user",
            content: [
              ...content,
              {
                type: "text",
                text: "Return one valid object only. speech must be one or two short Hinglish sentences. drawingDirection must be a plain-English string under 600 characters, or an empty string. Do not add any other fields or prose.",
              },
            ],
          },
        ],
        maxOutputTokens: TUTOR_TURN_OUTPUT_TOKENS,
        reasoning: "none",
      },
      generationOptions,
    );
  }
  const tutorReply = cleanTutorReply(generated.object.speech);
  const drawingDirection = generated.object.drawingDirection.trim();
  const speechChunks: TutorSpeechChunk[] = [{ say: tutorReply, actions: [] }];

  await ctx.runMutation(internal.tutorSessions.saveTurn, {
    sessionId: args.sessionId,
    speaker: "tutor",
    text: tutorReply,
    nextStatus: "speaking",
    speechChunks,
  });

  let boardImageCleanupScheduled = false;
  if (args.boardImageId) {
    try {
      await ctx.scheduler.runAfter(
        5 * 60 * 1000,
        internal.tutorSessions.deleteStorageObject,
        { storageId: args.boardImageId },
      );
      boardImageCleanupScheduled = true;
    } catch (error) {
      console.error("Could not schedule board image cleanup", error);
    }
  }

  return {
    result: {
      transcript: args.learnerText,
      tutorReply,
      drawingDirection,
      speechChunks,
    },
    boardImageCleanupScheduled,
  };
}

export const prepare = action({
  args: { sessionId: v.id("tutorSessions") },
  returns: v.object({ problemText: v.string(), tutorReply: v.string() }),
  handler: async (ctx, args): Promise<{ problemText: string; tutorReply: string }> => {
    const actionStartedAt = Date.now();
    let outcome: BackendLatencyOutcome = "error";
    let stage: BackendLatencyStage = "image_load";
    let imageLoadMs: number | undefined;
    let extractionMs: number | undefined;
    let openingGenerationMs: number | undefined;
    let openingRetryCount = 0;
    const session: Doc<"tutorSessions"> | null = await ctx.runQuery(
      internal.tutorSessions.getInternal,
      args,
    );
    if (!session) throw new ConvexError("Session not found.");

    try {
      const imageLoadStartedAt = Date.now();
      let image: Blob | null;
      try {
        image = await ctx.storage.get(session.problemImageId);
      } finally {
        imageLoadMs = elapsedMs(imageLoadStartedAt);
      }
      if (!image) throw new ConvexError("The cropped image is no longer available.");
      if (image.size > 8 * 1024 * 1024) {
        throw new ConvexError("Please crop a smaller image under 8 MB.");
      }

      const { provider, model } = createGeminiProvider();
      stage = "extraction";
      const extractionStartedAt = Date.now();
      let preparation: z.infer<typeof preparationSchema>;
      try {
        const result: { object: z.infer<typeof preparationSchema> } = await generateObject({
          model: provider(model),
          schema: preparationSchema,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Read the single school maths problem in this cropped image and privately prepare a tutor to teach it Socratically.

Transcribe the complete problem faithfully, including labels, symbols, units, and any diagram information needed to solve it. Compute and verify the answer yourself. Build a solution map and flexible teaching moves, not a dialogue script.

If the image is ambiguous or incomplete, set confidence to low and explain exactly what clarification is needed. Do not invent missing numbers or diagram labels. Keep arrays compact and ordered from least help to most help.`,
                },
                {
                  type: "image",
                  image: new Uint8Array(await image.arrayBuffer()),
                  mediaType: image.type || "image/jpeg",
                },
              ],
            },
          ],
        });
        preparation = result.object;
      } finally {
        extractionMs = elapsedMs(extractionStartedAt);
      }

      if (preparation.confidence === "low" || preparation.clarificationNeeded) {
        const clarification =
          preparation.clarificationNeeded ?? "I cannot read the complete problem confidently. Please adjust the crop or use a clearer photo.";
        await ctx.runMutation(internal.tutorSessions.markStatus, {
          sessionId: args.sessionId,
          status: "error",
          errorMessage: clarification,
        });
        throw new ConvexError(clarification);
      }

      await ctx.runMutation(internal.tutorSessions.savePreparation, {
        sessionId: args.sessionId,
        preparation,
      });

      const tutorAgent = createTutorAgent();
      stage = "opening_generation";
      const openingStartedAt = Date.now();
      let generated;
      try {
        generated = await tutorAgent.generateText(
          ctx,
          { threadId: session.agentThreadId },
          openingGenerationOptions(buildOpeningPrompt(preparation)),
          { storageOptions: { saveMessages: "none" } },
        );
        if (generated.finishReason === "length") {
          openingRetryCount = 1;
          console.warn("Tutor opening generation reached its output limit; retrying", {
            outputCharacters: generated.text.length,
          });
          generated = await tutorAgent.generateText(
            ctx,
            { threadId: session.agentThreadId },
            openingGenerationOptions(`${buildOpeningPrompt(preparation)}

Return exactly one short, complete Hinglish question. Use no preamble and no explanation.`),
            { storageOptions: { saveMessages: "none" } },
          );
        }
      } finally {
        openingGenerationMs = elapsedMs(openingStartedAt);
      }
      if (generated.finishReason === "length") {
        console.error("Tutor opening retry also reached its output limit", {
          outputCharacters: generated.text.length,
        });
        throw new ConvexError("The tutor could not start this session cleanly. Please try again.");
      }
      const tutorReply = cleanTutorReply(generated.text);
      await ctx.runMutation(internal.tutorSessions.saveTurn, {
        sessionId: args.sessionId,
        speaker: "tutor",
        text: tutorReply,
        nextStatus: "speaking",
      });

      outcome = "success";
      stage = "complete";
      return { problemText: preparation.problemText, tutorReply };
    } catch (error) {
      console.error("Tutor preparation failed", {
        stage,
        ...providerErrorMetadata(error),
      });
      const message = safeProviderMessage(error);
      await ctx.runMutation(internal.tutorSessions.markStatus, {
        sessionId: args.sessionId,
        status: "error",
        errorMessage: message,
      });
      throw new ConvexError(message);
    } finally {
      await ctx
        .runMutation(internal.tutorSessions.deleteStorageObject, {
          storageId: session.problemImageId,
        })
        .catch((error) => console.error("Could not delete problem image", error));
      await ctx
        .runMutation(internal.tutorSessions.recordBackendLatency, {
          sessionId: args.sessionId,
          flow: "opening",
          outcome,
          stage,
          totalMs: elapsedMs(actionStartedAt),
          imageLoadMs,
          extractionMs,
          openingGenerationMs,
          openingRetryCount,
        })
        .catch((error) => console.error("Could not store opening latency", error));
    }
  },
});

export const respondToAudio = action({
  args: {
    sessionId: v.id("tutorSessions"),
    audioStorageId: v.id("_storage"),
    boardImageId: v.optional(v.id("_storage")),
    boardSummary: v.string(),
  },
  returns: respondToLearnerResult,
  handler: async (ctx, args): Promise<RespondToLearnerResult> => {
    const actionStartedAt = Date.now();
    let outcome: BackendLatencyOutcome = "error";
    let stage: BackendLatencyStage = "audio_load";
    let audioLoadMs: number | undefined;
    let sttMs: number | undefined;
    let tutorGenerationMs: number | undefined;
    let boardImageHandedOff = false;
    const session: Doc<"tutorSessions"> | null = await ctx.runQuery(
      internal.tutorSessions.getInternal,
      {
        sessionId: args.sessionId,
      },
    );
    if (!session?.preparation) throw new ConvexError("The tutor is not ready yet.");

    await ctx.runMutation(internal.tutorSessions.markStatus, {
      sessionId: args.sessionId,
      status: "thinking",
    });

    try {
      const audioLoadStartedAt = Date.now();
      let audio: Blob | null;
      try {
        audio = await ctx.storage.get(args.audioStorageId);
      } finally {
        audioLoadMs = elapsedMs(audioLoadStartedAt);
      }
      if (!audio) throw new ConvexError("The recording is no longer available.");
      if (audio.size > 8 * 1024 * 1024) {
        throw new ConvexError("Please keep each answer under 30 seconds.");
      }

      const normalizedAudioType = audio.type.split(";", 1)[0] || "application/octet-stream";
      const normalizedAudio =
        normalizedAudioType === audio.type
          ? audio
          : new Blob([await audio.arrayBuffer()], { type: normalizedAudioType });
      const form = new FormData();
      form.append("file", normalizedAudio, audioFileName(normalizedAudioType));
      form.append("model", "saaras:v3");
      form.append("mode", "translit");
      form.append("language_code", "unknown");

      stage = "stt";
      const sttStartedAt = Date.now();
      let sttResponse: Response;
      try {
        sttResponse = await fetch("https://api.sarvam.ai/speech-to-text", {
          method: "POST",
          headers: {
            "api-subscription-key": requiredEnv("SARVAM_API_KEY", env.SARVAM_API_KEY),
          },
          body: form,
        });
      } finally {
        sttMs = elapsedMs(sttStartedAt);
      }

      if (!sttResponse.ok) {
        const providerBody: unknown = await sttResponse.json().catch(() => null);
        const providerError = sarvamErrorDetails(providerBody);
        console.error("Sarvam STT request failed", {
          status: sttResponse.status,
          audioBytes: audio.size,
          audioType: audio.type || "unknown",
          providerCode: providerError.code,
          providerRequestId: providerError.requestId,
        });
        const retryable = [429, 500, 503].includes(sttResponse.status);
        throw new ConvexError(
          retryable
            ? "Speech recognition is temporarily busy. Please try that answer once more."
            : sttResponse.status === 400 || sttResponse.status === 422
              ? "I could not read that recording. Press the mic, speak for at least one second, then press stop."
              : "Speech recognition could not process that answer. Please try again.",
        );
      }

      const body: unknown = await sttResponse.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("transcript" in body) ||
        typeof body.transcript !== "string"
      ) {
        throw new ConvexError("Speech recognition returned an invalid response.");
      }

      const transcript = body.transcript.trim();
      if (!transcript) {
        throw new ConvexError("I could not hear an answer. Press to talk and try again.");
      }

      stage = "tutor_generation";
      const tutorGenerationStartedAt = Date.now();
      let generated: Awaited<ReturnType<typeof generateTutorTurn>>;
      try {
        generated = await generateTutorTurn(ctx, session, {
          sessionId: args.sessionId,
          preparation: session.preparation,
          learnerText: transcript,
          boardImageId: args.boardImageId,
          boardSummary: args.boardSummary,
        });
      } finally {
        tutorGenerationMs = elapsedMs(tutorGenerationStartedAt);
      }

      outcome = "success";
      stage = "complete";
      boardImageHandedOff = generated.boardImageCleanupScheduled;
      return generated.result;
    } catch (error) {
      console.error("Tutor learner-turn processing failed", {
        stage,
        ...providerErrorMetadata(error),
      });
      const message = safeProviderMessage(error);
      await ctx.runMutation(internal.tutorSessions.markStatus, {
        sessionId: args.sessionId,
        status: "error",
        errorMessage: message,
      });
      throw new ConvexError(message);
    } finally {
      await ctx
        .runMutation(internal.tutorSessions.deleteStorageObject, {
          storageId: args.audioStorageId,
        })
        .catch((error) => console.error("Could not delete learner audio", error));
      if (args.boardImageId && !boardImageHandedOff) {
        await ctx
          .runMutation(internal.tutorSessions.deleteStorageObject, {
            storageId: args.boardImageId,
          })
          .catch((error) => console.error("Could not delete board image", error));
      }
      await ctx
        .runMutation(internal.tutorSessions.recordBackendLatency, {
          sessionId: args.sessionId,
          flow: "learner_turn",
          outcome,
          stage,
          totalMs: elapsedMs(actionStartedAt),
          audioLoadMs,
          sttMs,
          tutorGenerationMs,
        })
        .catch((error) => console.error("Could not store learner-turn latency", error));
    }
  },
});

export const respondToText = action({
  args: {
    sessionId: v.id("tutorSessions"),
    text: v.string(),
    boardImageId: v.optional(v.id("_storage")),
    boardSummary: v.string(),
  },
  returns: respondToLearnerResult,
  handler: async (ctx, args): Promise<RespondToLearnerResult> => {
    const actionStartedAt = Date.now();
    let outcome: BackendLatencyOutcome = "error";
    let stage: BackendLatencyStage = "tutor_generation";
    let tutorGenerationMs: number | undefined;
    let boardImageHandedOff = false;
    const learnerText = args.text.trim();
    if (!learnerText) throw new ConvexError("Write an answer before sending.");
    if (learnerText.length > 1_200) {
      throw new ConvexError("Keep each typed answer under 1,200 characters.");
    }

    const session: Doc<"tutorSessions"> | null = await ctx.runQuery(
      internal.tutorSessions.getInternal,
      { sessionId: args.sessionId },
    );
    if (!session?.preparation) throw new ConvexError("The tutor is not ready yet.");

    await ctx.runMutation(internal.tutorSessions.markStatus, {
      sessionId: args.sessionId,
      status: "thinking",
    });

    try {
      const tutorGenerationStartedAt = Date.now();
      let generated: Awaited<ReturnType<typeof generateTutorTurn>>;
      try {
        generated = await generateTutorTurn(ctx, session, {
          sessionId: args.sessionId,
          preparation: session.preparation,
          learnerText,
          boardImageId: args.boardImageId,
          boardSummary: args.boardSummary,
        });
      } finally {
        tutorGenerationMs = elapsedMs(tutorGenerationStartedAt);
      }
      outcome = "success";
      stage = "complete";
      boardImageHandedOff = generated.boardImageCleanupScheduled;
      return generated.result;
    } catch (error) {
      console.error("Tutor typed-turn processing failed", {
        stage,
        ...providerErrorMetadata(error),
      });
      const message = safeProviderMessage(error);
      await ctx.runMutation(internal.tutorSessions.markStatus, {
        sessionId: args.sessionId,
        status: "error",
        errorMessage: message,
      });
      throw new ConvexError(message);
    } finally {
      if (args.boardImageId && !boardImageHandedOff) {
        await ctx
          .runMutation(internal.tutorSessions.deleteStorageObject, {
            storageId: args.boardImageId,
          })
          .catch((error) => console.error("Could not delete board image", error));
      }
      await ctx
        .runMutation(internal.tutorSessions.recordBackendLatency, {
          sessionId: args.sessionId,
          flow: "learner_turn",
          outcome,
          stage,
          totalMs: elapsedMs(actionStartedAt),
          tutorGenerationMs,
        })
        .catch((error) => console.error("Could not store typed-turn latency", error));
    }
  },
});

export const generateDrawing = action({
  args: {
    sessionId: v.id("tutorSessions"),
    boardImageId: v.optional(v.id("_storage")),
    boardSummary: v.string(),
    boardRevision: v.number(),
    speech: v.string(),
    drawingDirection: v.string(),
  },
  returns: v.object({
    actions: v.array(boardAction),
    sourceBoardRevision: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ actions: BoardAction[]; sourceBoardRevision: number }> => {
    try {
      const artistContext = await ctx.runQuery(
        internal.tutorSessions.getArtistContext,
        { sessionId: args.sessionId },
      );
      if (!artistContext) throw new ConvexError("Session not found.");
      if (args.boardSummary.length > MAX_BOARD_SUMMARY_CHARACTERS) {
        throw new ConvexError("The board summary is too large to understand safely.");
      }
      if (!Number.isSafeInteger(args.boardRevision) || args.boardRevision < 0) {
        throw new ConvexError("The board revision is invalid.");
      }
      if (artistContext.boardRevision !== args.boardRevision) {
        console.info("Skipped drawing for a stale board revision", {
          requestedRevision: args.boardRevision,
          currentRevision: artistContext.boardRevision,
        });
        return { actions: [], sourceBoardRevision: args.boardRevision };
      }
      if (args.speech.length > 480 || args.drawingDirection.length > 600) {
        throw new ConvexError("The drawing request is too large.");
      }
      if (!args.drawingDirection.trim()) {
        return { actions: [], sourceBoardRevision: args.boardRevision };
      }

      const boardImage = args.boardImageId
        ? await ctx.storage.get(args.boardImageId)
        : null;
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; image: Uint8Array; mediaType: string }
      > = [
        {
          type: "text",
          text: buildDrawingPrompt(
            args.drawingDirection,
            args.boardSummary,
            args.speech,
            artistContext,
            args.boardRevision,
          ),
        },
      ];
      if (boardImage && boardImage.size <= 5 * 1024 * 1024) {
        content.push({
          type: "image",
          image: new Uint8Array(await boardImage.arrayBuffer()),
          mediaType: boardImage.type || "image/png",
        });
      }

      const { provider, model } = createGeminiProvider();
      let generated = await generateText({
        model: provider(model),
        messages: [{ role: "user", content }],
        maxOutputTokens: 1024,
        reasoning: "medium",
      });
      let actions = parseDrawingProtocol(generated.text);
      let invalidLineCount = Math.max(
        0,
        protocolLineCount(generated.text) - actions.length,
      );

      if (
        generated.finishReason === "length" ||
        invalidLineCount > 0 ||
        (actions.length === 0 && generated.text.trim().toUpperCase() !== "NONE")
      ) {
        console.warn("Tutor drawing output was malformed; retrying", {
          finishReason: generated.finishReason,
          outputCharacters: generated.text.length,
        });
        generated = await generateText({
          model: provider(model),
          messages: [
            {
              role: "user",
              content: [
                ...content,
                {
                  type: "text",
                  text: "Your prior response did not match the required line protocol. Return only NONE or one to twelve valid protocol lines. Do not add prose or Markdown.",
                },
              ],
            },
          ],
          maxOutputTokens: 1024,
          reasoning: "medium",
        });
        actions = parseDrawingProtocol(generated.text);
        invalidLineCount = Math.max(
          0,
          protocolLineCount(generated.text) - actions.length,
        );
      }

      if (
        generated.finishReason === "length" ||
        invalidLineCount > 0 ||
        (actions.length === 0 && generated.text.trim().toUpperCase() !== "NONE")
      ) {
        console.warn("Tutor drawing output remained malformed", {
          finishReason: generated.finishReason,
          outputCharacters: generated.text.length,
          invalidLineCount,
        });
        actions = [];
      }
      console.info("Tutor drawing actions generated", {
        finishReason: generated.finishReason,
        actionCount: actions.length,
        actionTypes: actions.map((action) => action.type),
      });
      if (actions.length > 0) {
        await ctx.runMutation(internal.tutorSessions.saveVisualPlan, {
          sessionId: args.sessionId,
          sourceBoardRevision: args.boardRevision,
          speech: args.speech,
          drawingDirection: args.drawingDirection,
          actions,
        });
      }
      return { actions, sourceBoardRevision: args.boardRevision };
    } catch (error) {
      console.warn("Tutor drawing generation failed; continuing with speech", {
        ...providerErrorMetadata(error),
      });
      return { actions: [], sourceBoardRevision: args.boardRevision };
    } finally {
      if (args.boardImageId) {
        await ctx
          .runMutation(internal.tutorSessions.deleteStorageObject, {
            storageId: args.boardImageId,
          })
          .catch((error) => console.error("Could not delete board image", error));
      }
    }
  },
});
