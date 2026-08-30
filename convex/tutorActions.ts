"use node";

import { Agent } from "@convex-dev/agent";
import { createVertex } from "@ai-sdk/google-vertex";
import { generateObject } from "ai";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, env } from "./_generated/server";
import {
  buildOpeningPrompt,
  buildTurnPrompt,
  cleanTutorReply,
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
const boardActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("addText"),
    text: z.string().min(1).max(80),
    x: normalizedCoordinate,
    y: normalizedCoordinate,
  }),
  z.object({
    type: z.literal("addArrow"),
    startX: normalizedCoordinate,
    startY: normalizedCoordinate,
    endX: normalizedCoordinate,
    endY: normalizedCoordinate,
  }),
  z.object({
    type: z.literal("highlight"),
    x: normalizedCoordinate,
    y: normalizedCoordinate,
    width: z.number().min(0.04).max(0.5),
    height: z.number().min(0.04).max(0.35),
  }),
  z.object({
    type: z.literal("crossOut"),
    startX: normalizedCoordinate,
    startY: normalizedCoordinate,
    endX: normalizedCoordinate,
    endY: normalizedCoordinate,
  }),
]);

const tutorTurnSchema = z.object({
  chunks: z
    .array(
      z.object({
        say: z.string().min(1).max(220),
        actions: z.array(boardActionSchema).max(2),
      }),
    )
    .min(1)
    .max(3),
});

type TutorTurnPlan = z.infer<typeof tutorTurnSchema>;
type TutorSpeechChunk = TutorTurnPlan["chunks"][number];
type RespondToAudioResult = {
  transcript: string;
  tutorReply: string;
  speechChunks: TutorSpeechChunk[];
};

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

function openingGenerationOptions(prompt: string) {
  return {
    prompt,
    maxOutputTokens: OPENING_OUTPUT_TOKENS,
    providerOptions: {
      google: {
        thinkingConfig: { thinkingLevel: "minimal" as const },
      },
    },
  };
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
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
  returns: v.object({
    transcript: v.string(),
    tutorReply: v.string(),
    speechChunks: v.array(
      v.object({
        say: v.string(),
        actions: v.array(
          v.union(
            v.object({ type: v.literal("addText"), text: v.string(), x: v.number(), y: v.number() }),
            v.object({ type: v.literal("addArrow"), startX: v.number(), startY: v.number(), endX: v.number(), endY: v.number() }),
            v.object({ type: v.literal("highlight"), x: v.number(), y: v.number(), width: v.number(), height: v.number() }),
            v.object({ type: v.literal("crossOut"), startX: v.number(), startY: v.number(), endX: v.number(), endY: v.number() }),
          ),
        ),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<RespondToAudioResult> => {
    const actionStartedAt = Date.now();
    let outcome: BackendLatencyOutcome = "error";
    let stage: BackendLatencyStage = "audio_load";
    let audioLoadMs: number | undefined;
    let sttMs: number | undefined;
    let tutorGenerationMs: number | undefined;
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
              ? "I could not read that recording. Hold the mic for at least one second and try again."
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
        throw new ConvexError("I could not hear an answer. Hold the button and try again.");
      }

      await ctx.runMutation(internal.tutorSessions.saveTurn, {
        sessionId: args.sessionId,
        speaker: "learner",
        text: transcript,
        nextStatus: "thinking",
      });

      if (args.boardSummary.length > 20_000) {
        throw new ConvexError("The board summary is too large to understand safely.");
      }
      const boardImage = args.boardImageId
        ? await ctx.storage.get(args.boardImageId)
        : null;
      const prompt = buildTurnPrompt(session.preparation, transcript, args.boardSummary);
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; image: Uint8Array; mediaType: string }
      > = [{ type: "text", text: prompt }];
      if (boardImage && boardImage.size <= 5 * 1024 * 1024) {
        content.push({
          type: "image",
          image: new Uint8Array(await boardImage.arrayBuffer()),
          mediaType: boardImage.type || "image/png",
        });
      }

      stage = "tutor_generation";
      const tutorGenerationStartedAt = Date.now();
      let object: TutorTurnPlan;
      try {
        const result: { object: TutorTurnPlan } = await createTutorAgent().generateObject(
          ctx,
          { threadId: session.agentThreadId },
          {
            schema: tutorTurnSchema,
            messages: [{ role: "user", content }],
            maxOutputTokens: 360,
          },
        );
        object = result.object;
      } finally {
        tutorGenerationMs = elapsedMs(tutorGenerationStartedAt);
      }
      const speechChunks: TutorSpeechChunk[] = object.chunks.map((chunk) => ({
        say: cleanTutorReply(chunk.say),
        actions: chunk.actions,
      }));
      const tutorReply = cleanTutorReply(speechChunks.map((chunk) => chunk.say).join(" "));

      await ctx.runMutation(internal.tutorSessions.saveTurn, {
        sessionId: args.sessionId,
        speaker: "tutor",
        text: tutorReply,
        nextStatus: "speaking",
        speechChunks,
      });

      outcome = "success";
      stage = "complete";
      return { transcript, tutorReply, speechChunks };
    } catch (error) {
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
      if (args.boardImageId) {
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
