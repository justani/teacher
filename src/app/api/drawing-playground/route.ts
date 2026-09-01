import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModelUsage } from "ai";
import { z } from "zod";
import {
  buildDrawingPrompt,
  MAX_BOARD_SUMMARY_CHARACTERS,
  type ArtistContext,
} from "../../../../convex/tutorPrompt";
import type { BoardAction } from "@/components/SharedMathBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL_IDS = [
  "gemini-3.7-flash",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
] as const;
const REASONING_LEVELS = ["low", "medium", "high"] as const;
const MAX_COMMAND_CHARACTERS = 1_200;
const MAX_HISTORY_ITEMS = 12;
const MAX_BOARD_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DRAWING_ACTIONS = 12;

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

const playgroundHistoryItem = z.object({
  command: z.string().min(1).max(MAX_COMMAND_CHARACTERS),
  sourceBoardRevision: z.number().int().nonnegative(),
  actions: z.array(z.unknown()).max(MAX_DRAWING_ACTIONS),
});

function isPlaygroundEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.DRAWING_PLAYGROUND_ENABLED === "true"
  );
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured on the server.`);
  return value;
}

function requiredPrivateKey() {
  let value = requiredEnv("GOOGLE_PRIVATE_KEY");
  if (value.startsWith('"') && value.endsWith('",')) {
    value = value.slice(1, -2);
  } else if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  return value.replace(/\\n/g, "\n").trim();
}

function createGeminiModel() {
  const provider = createVertex({
    project: requiredEnv("GOOGLE_CLOUD_PROJECT"),
    location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
    googleAuthOptions: {
      credentials: {
        client_email: requiredEnv("GOOGLE_CLIENT_EMAIL"),
        private_key: requiredPrivateKey(),
      },
    },
  });
  return provider("gemini-3.7-flash");
}

function createOpenAIModel(model: "gpt-5.6-luna" | "gpt-5.6-terra") {
  return createOpenAI({ apiKey: requiredEnv("OPENAI_API_KEY") }).responses(
    model,
  );
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

function errorMetadata(error: unknown) {
  if (!(error instanceof Error)) return { errorName: typeof error };
  const record = error as Error & { status?: unknown; statusCode?: unknown };
  return {
    errorName: error.name,
    configurationError: error.message.endsWith("is not configured on the server.")
      ? error.message
      : undefined,
    status:
      typeof record.status === "number"
        ? record.status
        : typeof record.statusCode === "number"
          ? record.statusCode
          : undefined,
  };
}

function compactUsage(usage: LanguageModelUsage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
  };
}

export async function POST(request: Request) {
  if (!isPlaygroundEnabled()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data." }, { status: 400 });
  }

  const model = form.get("model");
  const reasoning = form.get("reasoning");
  const command = form.get("command");
  const boardSummary = form.get("boardSummary");
  const boardRevisionValue = form.get("boardRevision");
  const historyValue = form.get("history");
  const boardImage = form.get("boardImage");

  if (typeof model !== "string" || !MODEL_IDS.includes(model as (typeof MODEL_IDS)[number])) {
    return Response.json({ error: "Choose a supported model." }, { status: 400 });
  }
  if (
    typeof reasoning !== "string" ||
    !REASONING_LEVELS.includes(reasoning as (typeof REASONING_LEVELS)[number])
  ) {
    return Response.json({ error: "Choose a supported reasoning level." }, { status: 400 });
  }
  if (typeof command !== "string" || !command.trim() || command.length > MAX_COMMAND_CHARACTERS) {
    return Response.json(
      { error: `Command must contain 1 to ${MAX_COMMAND_CHARACTERS} characters.` },
      { status: 400 },
    );
  }
  if (
    typeof boardSummary !== "string" ||
    boardSummary.length > MAX_BOARD_SUMMARY_CHARACTERS
  ) {
    return Response.json({ error: "The board summary is invalid or too large." }, { status: 400 });
  }

  const boardRevision = Number(boardRevisionValue);
  if (!Number.isSafeInteger(boardRevision) || boardRevision < 0) {
    return Response.json({ error: "The board revision is invalid." }, { status: 400 });
  }

  let history: z.infer<typeof playgroundHistoryItem>[];
  try {
    const parsed = JSON.parse(typeof historyValue === "string" ? historyValue : "[]");
    history = z.array(playgroundHistoryItem).max(MAX_HISTORY_ITEMS).parse(parsed);
  } catch {
    return Response.json({ error: "The applied drawing history is invalid." }, { status: 400 });
  }

  const usableImage =
    boardImage instanceof File &&
    boardImage.size > 0 &&
    boardImage.size <= MAX_BOARD_IMAGE_BYTES
      ? boardImage
      : null;
  const artistContext: ArtistContext = {
    problemText: "Local drawing playground. There is no hidden solution or separate maths problem.",
    turns: [],
    recentVisualPlans: history.map((item) => ({
      sourceBoardRevision: item.sourceBoardRevision,
      speech: "",
      drawingDirection: item.command,
      actions: item.actions,
    })),
  };
  const prompt = buildDrawingPrompt(
    command.trim(),
    boardSummary,
    "",
    artistContext,
    boardRevision,
  );
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  > = [{ type: "text", text: prompt }];
  if (usableImage) {
    content.push({
      type: "image",
      image: new Uint8Array(await usableImage.arrayBuffer()),
      mediaType: usableImage.type || "image/png",
    });
  }

  const startedAt = Date.now();
  try {
    const languageModel =
      model === "gemini-3.7-flash"
        ? createGeminiModel()
        : createOpenAIModel(model as "gpt-5.6-luna" | "gpt-5.6-terra");
    let retryCount = 0;
    let generated = await generateText({
      model: languageModel,
      messages: [{ role: "user", content }],
      maxOutputTokens: 2_048,
      reasoning: reasoning as (typeof REASONING_LEVELS)[number],
    });
    let actions = parseDrawingProtocol(generated.text);
    let invalidLineCount = Math.max(0, protocolLineCount(generated.text) - actions.length);

    if (
      generated.finishReason === "length" ||
      invalidLineCount > 0 ||
      (actions.length === 0 && generated.text.trim().toUpperCase() !== "NONE")
    ) {
      retryCount = 1;
      generated = await generateText({
        model: languageModel,
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
        maxOutputTokens: 2_048,
        reasoning: reasoning as (typeof REASONING_LEVELS)[number],
      });
      actions = parseDrawingProtocol(generated.text);
      invalidLineCount = Math.max(0, protocolLineCount(generated.text) - actions.length);
    }

    const malformed =
      generated.finishReason === "length" ||
      invalidLineCount > 0 ||
      (actions.length === 0 && generated.text.trim().toUpperCase() !== "NONE");
    return Response.json({
      model,
      reasoning,
      rawOutput: generated.text,
      actions,
      malformed,
      invalidLineCount,
      retryCount,
      finishReason: generated.finishReason,
      latencyMs: Date.now() - startedAt,
      usage: compactUsage(generated.usage),
    });
  } catch (error) {
    const metadata = errorMetadata(error);
    console.error("Local drawing playground model request failed", metadata);
    return Response.json(
      {
        error:
          metadata.configurationError ??
          `The ${model} request failed${metadata.status ? ` with status ${metadata.status}` : ""}.`,
      },
      { status: metadata.configurationError ? 503 : 502 },
    );
  }
}
