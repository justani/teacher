/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { SAMPLE_PROBLEMS } from "../shared/sampleProblems";
import { getSamplePreparation } from "./samplePreparations";

const mocks = vi.hoisted(() => ({
  extraction: vi.fn(),
  opening: vi.fn(),
  thread: vi.fn(),
}));
vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  generateObject: mocks.extraction,
}));
vi.mock("@ai-sdk/google-vertex", () => ({ createVertex: () => () => ({}) }));
vi.mock("@convex-dev/agent", () => ({
  createThread: mocks.thread,
  Agent: class { generateText = mocks.opening; },
}));
const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
  vi.stubEnv("GOOGLE_CLIENT_EMAIL", "test@example.invalid");
  vi.stubEnv("GOOGLE_PRIVATE_KEY", "test-key");
  let nextThread = 0;
  mocks.thread.mockImplementation(async () => `thread-${++nextThread}`);
  mocks.opening.mockResolvedValue({ text: "Tum pehla step kaise karogi?", finishReason: "stop" });
});

test.each(SAMPLE_PROBLEMS)("$id starts without storage or model extraction", async (sample) => {
  const t = convexTest(schema, modules);
  const sessionId = await t.mutation(api.tutorSessions.create, { sampleId: sample.id });
  const result = await t.action(api.tutorActions.prepare, { sessionId });
  expect(result.problemText).toBe(sample.question);
  expect(mocks.extraction).not.toHaveBeenCalled();
  expect(mocks.opening).toHaveBeenCalledOnce();
  const session = await t.query(internal.tutorSessions.getInternal, { sessionId });
  expect(session?.problemImageId).toBeUndefined();
  expect(session?.samplePreparationVersion).toBe(1);
  expect(session?.preparation).toEqual(getSamplePreparation(sample.id)?.preparation);
  const view = await t.query(api.tutorSessions.getLearnerView, { sessionId });
  expect(view).not.toHaveProperty("preparation");
  expect(view).not.toHaveProperty("exactAnswer");
  expect(view?.turns).toHaveLength(1);
  const timings = await t.run(async (ctx) => ctx.db.query("tutorLatencyEvents").take(5));
  expect(timings[0]).toMatchObject({ outcome: "success", imageLoadMs: 0, extractionMs: 0 });
});

test("new sessions have separate conversations and retain their saved preparation", async () => {
  const t = convexTest(schema, modules);
  const first = await t.mutation(api.tutorSessions.create, { sampleId: "area" });
  const second = await t.mutation(api.tutorSessions.create, { sampleId: "area" });
  const firstSession = await t.query(internal.tutorSessions.getInternal, { sessionId: first });
  const secondSession = await t.query(internal.tutorSessions.getInternal, { sessionId: second });
  expect(firstSession?.agentThreadId).not.toBe(secondSession?.agentThreadId);
  // Simulate a preparation saved by an older catalog version.
  await t.run(async (ctx) => {
    await ctx.db.patch(first, {
      preparation: { ...getSamplePreparation("area")!.preparation, transferProblem: "Find the area of a 2 cm by 3 cm rectangle." },
    });
  });
  await t.action(api.tutorActions.prepare, { sessionId: first });
  const updated = await t.query(internal.tutorSessions.getInternal, { sessionId: first });
  expect(updated?.preparation?.transferProblem).toBe("Find the area of a 2 cm by 3 cm rectangle.");
  expect((await t.query(api.tutorSessions.getLearnerView, { sessionId: second }))?.turns).toEqual([]);
});

test("rejects unknown or missing sample sources before creating a thread", async () => {
  const t = convexTest(schema, modules);
  for (const sampleId of ["unknown", "", "__proto__"]) {
    await expect(t.mutation(api.tutorSessions.create, { sampleId })).rejects.toThrow("Unknown sample question");
  }
  await expect(t.mutation(api.tutorSessions.create, {})).rejects.toThrow("Choose a sample");
  const imageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["image"])));
  await expect(t.mutation(api.tutorSessions.create, { sampleId: "area", problemImageId: imageId })).rejects.toThrow("Choose a sample");
  expect(mocks.thread).not.toHaveBeenCalled();
});

test("uploaded questions still use extraction and delete their temporary image", async () => {
  const t = convexTest(schema, modules);
  const problemImageId = await t.run(async (ctx) => ctx.storage.store(new Blob(["image"], { type: "image/png" })));
  const preparation = getSamplePreparation("area")!.preparation;
  mocks.extraction.mockResolvedValueOnce({ object: preparation });
  const sessionId = await t.mutation(api.tutorSessions.create, { problemImageId, sourceFileName: "upload.png" });
  await t.action(api.tutorActions.prepare, { sessionId });
  expect(mocks.extraction).toHaveBeenCalledOnce();
  expect(await t.run(async (ctx) => ctx.storage.get(problemImageId))).toBeNull();
  const session = await t.query(internal.tutorSessions.getInternal, { sessionId });
  expect(session?.sampleId).toBeUndefined();
  expect(session?.preparation).toEqual(preparation);
});
