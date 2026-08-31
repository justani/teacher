"use client";

/* eslint-disable @next/next/no-img-element */

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { playTutorSpeech } from "@/lib/tutorAudio";
import {
  SharedMathBoard,
  type BoardAction,
  type SharedMathBoardHandle,
} from "./SharedMathBoard";

type VoiceState = "listening" | "thinking" | "speaking";
type SessionState = "ready" | "active" | "ended";
type IntakeState = "upload" | "crop" | "confirmed";
type CropSelection = { x: number; y: number; width: number; height: number };
type CropMode = "move" | "nw" | "ne" | "sw" | "se";
type TranscriptTurn = {
  _id: Id<"tutorTurns">;
  _creationTime: number;
  speaker: "learner" | "tutor";
  text: string;
};
type ResponseTiming = { flow: "opening" | "learner_turn"; startedAt: number };

const DEFAULT_CROP: CropSelection = { x: 8, y: 18, width: 84, height: 38 };
const MIN_CROP_PERCENT = 6;

const voiceCopy: Record<VoiceState, { label: string; detail: string }> = {
  listening: { label: "Your turn", detail: "" },
  thinking: { label: "Thinking", detail: "I’m considering the smallest useful next question." },
  speaking: { label: "Speaking", detail: "Area of a sector uses part of the circle’s area." },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function logFrontendTiming(
  event: string,
  startedAt: number,
  details: Record<string, string | number> = {},
) {
  console.info("[Tutor telemetry]", {
    event,
    elapsedMs: Math.round(performance.now() - startedAt),
    ...details,
  });
}

function Icon({ name }: { name: "upload" | "mic" | "stop" | "play" | "image" | "crop" | "reset" | "send" }) {
  const paths = {
    upload: <><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14v5h14v-5"/></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3M9 21h6"/></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
    play: <path d="M8 5.5v13l10-6.5z"/>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M3 16l5-4 4 3 3-2 6 5"/></>,
    crop: <><path d="M7 3v14a2 2 0 002 2h12M3 7h14a2 2 0 012 2v12"/></>,
    reset: <><path d="M4 9a8 8 0 111.4 7.6"/><path d="M4 4v5h5"/></>,
    send: <><path d="M4 4l17 8-17 8 3-8-3-8z"/><path d="M7 12h14"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function TranscriptPanel({
  turns,
  typedAnswer,
  onTypedAnswerChange,
  onTypedAnswerSubmit,
  canType,
}: {
  turns: TranscriptTurn[];
  typedAnswer: string;
  onTypedAnswerChange: (value: string) => void;
  onTypedAnswerSubmit: (event: FormEvent<HTMLFormElement>) => void;
  canType: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const latestTurnId = turns[turns.length - 1]?._id;

  useEffect(() => {
    if (!latestTurnId) return;
    const frame = window.requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      list.scrollTo({
        top: list.scrollHeight,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [latestTurnId]);

  return (
    <aside className="transcript-panel" aria-labelledby="transcript-heading">
      <div className="transcript-heading">
        <div><p className="overline">Conversation</p><h2 id="transcript-heading">Session transcript</h2></div>
        <span className="transcript-live"><span aria-hidden="true" /> Live</span>
      </div>
      <ol ref={listRef} className="transcript-list">
        {turns.map((entry) => (
          <li key={entry._id} className={entry.speaker === "tutor" ? "tutor-line" : "learner-line"}>
            <div><strong>{entry.speaker === "tutor" ? "Tutor" : "Student"}</strong><time>{new Date(entry._creationTime).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</time></div>
            <p>{entry.text}</p>
          </li>
        ))}
        {turns.length === 0 && <li className="transcript-empty"><p>The conversation will appear here when the tutor is ready.</p></li>}
      </ol>
      <form className="text-composer" onSubmit={onTypedAnswerSubmit}>
        <label htmlFor="typed-answer">Write your answer</label>
        <div>
          <input
            id="typed-answer"
            type="text"
            value={typedAnswer}
            onChange={(event) => onTypedAnswerChange(event.target.value)}
            placeholder={canType ? "Type what you’re thinking…" : "Available on your turn"}
            maxLength={1200}
            autoComplete="off"
            disabled={!canType}
          />
          <button type="submit" aria-label="Send typed answer" disabled={!canType || typedAnswer.trim().length === 0}>
            <Icon name="send" />
          </button>
        </div>
        <p>Press Enter to send</p>
      </form>
    </aside>
  );
}

export function TutorSession() {
  const [sessionState, setSessionState] = useState<SessionState>("ready");
  const [intakeState, setIntakeState] = useState<IntakeState>("upload");
  const [voiceState, setVoiceState] = useState<VoiceState>("listening");
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [secondsRemaining, setSecondsRemaining] = useState(15 * 60);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [crop, setCrop] = useState<CropSelection>(DEFAULT_CROP);
  const [sessionId, setSessionId] = useState<Id<"tutorSessions"> | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropSurfaceRef = useRef<HTMLDivElement>(null);
  const sourceImageRef = useRef<HTMLImageElement>(null);
  const interactionRef = useRef<{
    mode: CropMode;
    startX: number;
    startY: number;
    initial: CropSelection;
  } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recordingStartingRef = useRef(false);
  const discardRecordingRef = useRef(false);
  const responseStartedAtRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const startRecordingShortcutRef = useRef<() => void>(() => undefined);
  const stopRecordingShortcutRef = useRef<() => void>(() => undefined);
  const textSubmissionActiveRef = useRef(false);
  const boardRef = useRef<SharedMathBoardHandle>(null);

  const generateUploadUrl = useMutation(api.tutorSessions.generateUploadUrl);
  const createTutorSession = useMutation(api.tutorSessions.create);
  const finishPlayback = useMutation(api.tutorSessions.finishPlayback);
  const recordTtsLatency = useMutation(api.tutorSessions.recordTtsLatency);
  const saveBoardCheckpoint = useMutation(api.tutorSessions.saveBoardCheckpoint);
  const endTutorSession = useMutation(api.tutorSessions.end);
  const prepareTutor = useAction(api.tutorActions.prepare);
  const respondToAudio = useAction(api.tutorActions.respondToAudio);
  const respondToText = useAction(api.tutorActions.respondToText);
  const generateDrawing = useAction(api.tutorActions.generateDrawing);
  const learnerView = useQuery(
    api.tutorSessions.getLearnerView,
    sessionId ? { sessionId } : "skip",
  );

  useEffect(() => {
    if (sessionState !== "active" || secondsRemaining <= 0) return;
    const timer = window.setInterval(() => setSecondsRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [sessionState, secondsRemaining]);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  useEffect(() => () => {
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current);
    void audioContextRef.current?.close();
  }, []);

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(URL.createObjectURL(file));
    setCroppedUrl(null);
    setFileName(file.name);
    setCrop(DEFAULT_CROP);
    setIntakeState("crop");
    setSessionState("ready");
    setSessionId(null);
    setErrorMessage("");
    setSecondsRemaining(15 * 60);
    event.target.value = "";
  }

  function beginCropInteraction(event: ReactPointerEvent<HTMLElement>, mode: CropMode) {
    if (!cropSurfaceRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = { mode, startX: event.clientX, startY: event.clientY, initial: crop };
  }

  function updateCropInteraction(event: ReactPointerEvent<HTMLElement>) {
    const interaction = interactionRef.current;
    const surface = cropSurfaceRef.current;
    if (!interaction || !surface) return;
    const bounds = surface.getBoundingClientRect();
    const dx = ((event.clientX - interaction.startX) / bounds.width) * 100;
    const dy = ((event.clientY - interaction.startY) / bounds.height) * 100;
    const initial = interaction.initial;
    const minSize = MIN_CROP_PERCENT;

    if (interaction.mode === "move") {
      setCrop({ ...initial, x: clamp(initial.x + dx, 0, 100 - initial.width), y: clamp(initial.y + dy, 0, 100 - initial.height) });
      return;
    }

    let left = initial.x;
    let top = initial.y;
    let right = initial.x + initial.width;
    let bottom = initial.y + initial.height;
    if (interaction.mode.includes("w")) left = clamp(initial.x + dx, 0, right - minSize);
    if (interaction.mode.includes("e")) right = clamp(right + dx, left + minSize, 100);
    if (interaction.mode.includes("n")) top = clamp(initial.y + dy, 0, bottom - minSize);
    if (interaction.mode.includes("s")) bottom = clamp(bottom + dy, top + minSize, 100);
    setCrop({ x: left, y: top, width: right - left, height: bottom - top });
  }

  function finishCropInteraction(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    interactionRef.current = null;
  }

  function confirmCrop() {
    const image = sourceImageRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) return;
    const sourceX = Math.round((crop.x / 100) * image.naturalWidth);
    const sourceY = Math.round((crop.y / 100) * image.naturalHeight);
    const sourceWidth = Math.max(1, Math.round((crop.width / 100) * image.naturalWidth));
    const sourceHeight = Math.max(1, Math.round((crop.height / 100) * image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
    const croppedImageUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCroppedUrl(croppedImageUrl);
    setIntakeState("confirmed");
    void startSession(croppedImageUrl);
  }

  function getAudioContext() {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  }

  async function uploadBlob(blob: Blob) {
    const uploadUrl = await generateUploadUrl();
    const upload = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    if (!upload.ok) throw new Error("The file could not be uploaded.");
    const result: unknown = await upload.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("storageId" in result) ||
      typeof result.storageId !== "string"
    ) {
      throw new Error("The upload returned an invalid response.");
    }
    return result.storageId as Id<"_storage">;
  }

  async function speakTutorTurn(
    chunks: Array<{ say: string; actions: BoardAction[] }>,
    activeSessionId: Id<"tutorSessions">,
    timing?: ResponseTiming,
    completeTurn = true,
  ) {
    setVoiceState("speaking");
    let tutorUsedBoard = false;
    try {
      for (const [chunkIndex, chunk] of chunks.entries()) {
        if (chunk.actions.length > 0) {
          boardRef.current?.applyTutorActions(chunk.actions);
          tutorUsedBoard = true;
        }
        const shouldMeasureTts = chunkIndex === 0 && Boolean(timing);
        const ttsStartedAt = performance.now();
        const ttsMetrics: {
          responseHeadersMs?: number;
          firstAudioMs?: number;
          streamCompleteMs?: number;
          playbackCompleteMs?: number;
        } = {};
        try {
          await playTutorSpeech(getAudioContext(), chunk.say, shouldMeasureTts && timing ? {
            onResponseHeaders: (stageMs) => {
              ttsMetrics.responseHeadersMs = Math.round(stageMs);
              logFrontendTiming("tts_response_headers", timing.startedAt, {
                flow: timing.flow,
                ttsStageMs: Math.round(stageMs),
              });
            },
            onFirstAudio: (stageMs) => {
              ttsMetrics.firstAudioMs = Math.round(stageMs);
              logFrontendTiming("first_audio_scheduled", timing.startedAt, {
                flow: timing.flow,
                ttsStageMs: Math.round(stageMs),
              });
            },
            onStreamComplete: (stageMs) => {
              ttsMetrics.streamCompleteMs = Math.round(stageMs);
              logFrontendTiming("tts_stream_complete", timing.startedAt, {
                flow: timing.flow,
                ttsStageMs: Math.round(stageMs),
              });
            },
            onPlaybackComplete: (stageMs) => {
              ttsMetrics.playbackCompleteMs = Math.round(stageMs);
            },
          } : undefined);
        } catch (error) {
          if (shouldMeasureTts && timing) {
            void recordTtsLatency({
              sessionId: activeSessionId,
              flow: timing.flow,
              outcome: "error",
              totalMs: Math.round(performance.now() - ttsStartedAt),
              ttsResponseHeadersMs: ttsMetrics.responseHeadersMs,
              ttsFirstAudioMs: ttsMetrics.firstAudioMs,
              ttsStreamCompleteMs: ttsMetrics.streamCompleteMs,
              ttsPlaybackCompleteMs: ttsMetrics.playbackCompleteMs,
            }).catch((telemetryError) => console.error("Could not store TTS latency", telemetryError));
          }
          throw error;
        }
        if (shouldMeasureTts && timing) {
          void recordTtsLatency({
            sessionId: activeSessionId,
            flow: timing.flow,
            outcome: "success",
            totalMs: Math.round(performance.now() - ttsStartedAt),
            ttsResponseHeadersMs: ttsMetrics.responseHeadersMs,
            ttsFirstAudioMs: ttsMetrics.firstAudioMs,
            ttsStreamCompleteMs: ttsMetrics.streamCompleteMs,
            ttsPlaybackCompleteMs: ttsMetrics.playbackCompleteMs,
          }).catch((telemetryError) => console.error("Could not store TTS latency", telemetryError));
        }
      }

      if (timing) logFrontendTiming("tutor_playback_complete", timing.startedAt, { flow: timing.flow });

      if (tutorUsedBoard) {
        const checkpoint = await boardRef.current?.captureCheckpoint();
        if (checkpoint) {
          await saveBoardCheckpoint({
            sessionId: activeSessionId,
            actor: "tutor",
            revision: checkpoint.revision,
            document: checkpoint.document,
            summary: checkpoint.summary,
          });
        }
      }
    } finally {
      if (completeTurn) {
        await finishPlayback({ sessionId: activeSessionId }).catch(() => undefined);
        setVoiceState("listening");
      }
    }
  }

  async function drawTutorTurn(
    activeSessionId: Id<"tutorSessions">,
    boardImageId: Id<"_storage"> | undefined,
    boardSummary: string,
    speech: string,
    drawingDirection: string,
  ) {
    const shouldShowDrawing = drawingDirection.trim().length > 0;
    if (shouldShowDrawing) setIsDrawing(true);
    try {
      const result = await generateDrawing({
        sessionId: activeSessionId,
        boardImageId,
        boardSummary,
        speech,
        drawingDirection,
      });
      if (result.actions.length === 0) return;

      boardRef.current?.applyTutorActions(result.actions);
      const checkpoint = await boardRef.current?.captureCheckpoint();
      if (!checkpoint) return;
      await saveBoardCheckpoint({
        sessionId: activeSessionId,
        actor: "tutor",
        revision: checkpoint.revision,
        document: checkpoint.document,
        summary: checkpoint.summary,
      });
    } finally {
      if (shouldShowDrawing) setIsDrawing(false);
    }
  }

  async function startSession(problemImageUrl = croppedUrl) {
    if (!problemImageUrl || sessionState === "active" || isPreparing) return;
    const startedAt = performance.now();
    logFrontendTiming("opening_started", startedAt, { flow: "opening" });
    setErrorMessage("");
    setIsPreparing(true);
    setVoiceState("thinking");
    if (secondsRemaining === 0) setSecondsRemaining(15 * 60);

    try {
      await getAudioContext().resume();
      const imageBlob = await fetch(problemImageUrl).then((response) => response.blob());
      const problemImageId = await uploadBlob(imageBlob);
      logFrontendTiming("problem_image_uploaded", startedAt, { flow: "opening" });
      const newSessionId = await createTutorSession({
        problemImageId,
        sourceFileName: fileName || "problem.jpg",
      });
      setSessionId(newSessionId);
      logFrontendTiming("session_created", startedAt, { flow: "opening" });
      const prepared = await prepareTutor({ sessionId: newSessionId });
      logFrontendTiming("tutor_text_ready", startedAt, { flow: "opening" });
      setIsPreparing(false);
      setSessionState("active");
      try {
        await speakTutorTurn(
          [{ say: prepared.tutorReply, actions: [] }],
          newSessionId,
          { flow: "opening", startedAt },
        );
      } catch (error) {
        logFrontendTiming("opening_audio_failed", startedAt, { flow: "opening" });
        setErrorMessage(
          error instanceof Error
            ? `${error.message} You can still press the mic or type your reply.`
            : "Tutor audio could not play. You can still press the mic or type your reply.",
        );
        setVoiceState("listening");
      }
    } catch (error) {
      logFrontendTiming("opening_failed", startedAt, { flow: "opening" });
      setIsPreparing(false);
      setErrorMessage(error instanceof Error ? error.message : "The tutor could not start.");
      setVoiceState("listening");
      setSessionState("ready");
      setSessionId(null);
    }
  }

  async function submitRecording(blob: Blob, startedAt: number) {
    if (!sessionId) return;
    logFrontendTiming("recording_ready", startedAt, {
      flow: "learner_turn",
      audioBytes: blob.size,
    });
    setErrorMessage("");
    setVoiceState("thinking");
    try {
      const checkpoint = await boardRef.current?.captureCheckpoint();
      if (!checkpoint) throw new Error("The board is still loading. Please try again.");
      await saveBoardCheckpoint({
        sessionId,
        actor: "learner",
        revision: checkpoint.revision,
        document: checkpoint.document,
        summary: checkpoint.summary,
      });
      logFrontendTiming("board_checkpoint_saved", startedAt, { flow: "learner_turn" });
      const audioStorageId = await uploadBlob(blob);
      const boardImageId = checkpoint.image ? await uploadBlob(checkpoint.image) : undefined;
      logFrontendTiming("turn_inputs_uploaded", startedAt, { flow: "learner_turn" });
      const result = await respondToAudio({
        sessionId,
        audioStorageId,
        boardImageId,
        boardSummary: checkpoint.summary,
      });
      await completeLearnerTurn(result, sessionId, boardImageId, checkpoint.summary, startedAt);
    } catch (error) {
      logFrontendTiming("learner_turn_failed", startedAt, { flow: "learner_turn" });
      setErrorMessage(error instanceof Error ? error.message : "I could not process that answer.");
      setVoiceState("listening");
    }
  }

  async function completeLearnerTurn(
    result: {
      tutorReply: string;
      drawingDirection: string;
      speechChunks: Array<{ say: string; actions: BoardAction[] }>;
    },
    activeSessionId: Id<"tutorSessions">,
    boardImageId: Id<"_storage"> | undefined,
    boardSummary: string,
    startedAt: number,
  ) {
    logFrontendTiming("tutor_text_ready", startedAt, { flow: "learner_turn" });
    const speechPromise = speakTutorTurn(
      result.speechChunks,
      activeSessionId,
      { flow: "learner_turn", startedAt },
      false,
    );
    const drawingPromise = drawTutorTurn(
      activeSessionId,
      boardImageId,
      boardSummary,
      result.tutorReply,
      result.drawingDirection,
    ).catch((error) => console.error("Could not draw tutor response", error));
    const [speechOutcome] = await Promise.allSettled([speechPromise, drawingPromise]);
    await finishPlayback({ sessionId: activeSessionId }).catch(() => undefined);
    setVoiceState("listening");
    if (speechOutcome.status === "rejected") throw speechOutcome.reason;
  }

  async function submitTypedAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = typedAnswer.trim();
    if (!text || !sessionId || !learnerCanAnswer || isRecording || textSubmissionActiveRef.current) return;
    const startedAt = performance.now();
    textSubmissionActiveRef.current = true;
    setErrorMessage("");
    setVoiceState("thinking");
    logFrontendTiming("typed_response_started", startedAt, {
      flow: "learner_turn",
      characters: text.length,
    });
    try {
      const checkpoint = await boardRef.current?.captureCheckpoint();
      if (!checkpoint) throw new Error("The board is still loading. Please try again.");
      await saveBoardCheckpoint({
        sessionId,
        actor: "learner",
        revision: checkpoint.revision,
        document: checkpoint.document,
        summary: checkpoint.summary,
      });
      logFrontendTiming("board_checkpoint_saved", startedAt, { flow: "learner_turn" });
      const boardImageId = checkpoint.image ? await uploadBlob(checkpoint.image) : undefined;
      const result = await respondToText({
        sessionId,
        text,
        boardImageId,
        boardSummary: checkpoint.summary,
      });
      setTypedAnswer("");
      await completeLearnerTurn(result, sessionId, boardImageId, checkpoint.summary, startedAt);
    } catch (error) {
      logFrontendTiming("learner_turn_failed", startedAt, { flow: "learner_turn" });
      setErrorMessage(error instanceof Error ? error.message : "I could not process that answer.");
      setVoiceState("listening");
    } finally {
      textSubmissionActiveRef.current = false;
    }
  }

  async function startRecording() {
    if (!sessionId || sessionState !== "active" || voiceState !== "listening" || isRecording || recordingStartingRef.current) return;
    recordingStartingRef.current = true;
    setErrorMessage("");
    try {
      await getAudioContext().resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferredType
        ? new MediaRecorder(stream, { mimeType: preferredType })
        : new MediaRecorder(stream);
      recorderStreamRef.current = stream;
      recorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderStreamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);
        const audio = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || preferredType || "application/octet-stream",
        });
        const responseStartedAt = responseStartedAtRef.current ?? performance.now();
        const recordingDurationMs = recordingStartedAtRef.current
          ? performance.now() - recordingStartedAtRef.current
          : 0;
        responseStartedAtRef.current = null;
        recordingStartedAtRef.current = null;
        audioChunksRef.current = [];
        if (!discardRecordingRef.current && recordingDurationMs < 600) {
          setErrorMessage("Speak a little longer so I can hear the complete answer.");
        } else if (!discardRecordingRef.current && audio.size > 0) {
          void submitRecording(audio, responseStartedAt);
        }
        discardRecordingRef.current = false;
      };
      recorder.start();
      recordingStartedAtRef.current = performance.now();
      setIsRecording(true);
      recordingTimeoutRef.current = window.setTimeout(() => stopRecording(), 30_000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Microphone access was not available.");
      setIsRecording(false);
    } finally {
      recordingStartingRef.current = false;
    }
  }

  function stopRecording() {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (recorderRef.current?.state === "recording") {
      const startedAt = performance.now();
      responseStartedAtRef.current = startedAt;
      logFrontendTiming("learner_response_started", startedAt, { flow: "learner_turn" });
      recorderRef.current.stop();
    }
  }

  function toggleRecording() {
    if (recorderRef.current?.state === "recording" || isRecording) {
      stopRecording();
      return;
    }
    void startRecording();
  }

  async function endSession() {
    stopRecording();
    if (sessionId) await endTutorSession({ sessionId }).catch(() => undefined);
    setSessionState("ended");
  }

  startRecordingShortcutRef.current = () => void startRecording();
  stopRecordingShortcutRef.current = stopRecording;

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || isTypingTarget(event.target)) return;
      if (!sessionId || sessionState !== "active") return;
      event.preventDefault();
      if (event.repeat || voiceState !== "listening") return;
      if (isRecording) {
        stopRecordingShortcutRef.current();
      } else {
        startRecordingShortcutRef.current();
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code !== "Space" || isTypingTarget(event.target)) return;
      if (!sessionId || sessionState !== "active") return;
      event.preventDefault();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
    };
  }, [isRecording, sessionId, sessionState, voiceState]);

  const minutes = Math.floor(secondsRemaining / 60).toString().padStart(2, "0");
  const seconds = (secondsRemaining % 60).toString().padStart(2, "0");
  const learnerCanAnswer = sessionState === "active" && Boolean(sessionId) && voiceState === "listening" && !isPreparing;
  const voiceDetail = sessionState === "ended"
    ? "Your question and transcript are still here."
    : errorMessage || (isRecording ? "Speak naturally, then press stop when you’re done." : voiceCopy[voiceState].detail);
  const voiceDock = (
    <section className={`voice-dock voice-${voiceState} ${learnerCanAnswer ? "ready-to-speak" : ""} ${intakeState !== "confirmed" ? "intake-open" : ""}`} aria-label="Tutor voice controls">
      <div className="voice-presence" aria-live="polite"><span className="voice-orbit" aria-hidden="true"><span /></span><div><strong>{sessionState === "ended" ? "Session ended" : isRecording ? "Listening" : voiceCopy[voiceState].label}</strong>{voiceDetail && <p>{voiceDetail}</p>}</div></div>
      <div className="voice-instruction"><span>{learnerCanAnswer ? "Your turn — press the button or Space to talk, then press again to stop" : isPreparing ? "Reading the question and preparing your tutor…" : voiceState === "speaking" ? "Listen to the tutor, then it will be your turn" : "The tutor is getting the next question ready"}</span></div>
      <button
        className={`mic-button ${isRecording ? "mic-on" : ""}`}
        type="button"
        onClick={toggleRecording}
        disabled={sessionState !== "active" || !sessionId || voiceState !== "listening"}
        aria-pressed={isRecording}
      ><Icon name={isRecording ? "stop" : "mic"} /><span>{isRecording ? "Press to stop" : "Press to talk"}</span></button>
    </section>
  );

  if (intakeState === "crop" && sourceUrl) {
    return (
      <main className="crop-focus-shell">
        <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" onChange={handleUpload} />
        <header className="crop-focus-header">
          <div><p className="overline">Select one problem</p><h1>Crop the question</h1></div>
          <button className="button button-quiet" type="button" onClick={() => fileInputRef.current?.click()}><Icon name="upload" />Change photo</button>
        </header>

        <div className="crop-focus-canvas">
          <p className="crop-help">Drag the frame over one complete problem. Use a corner to resize it.</p>
          <div className="crop-focus-image" ref={cropSurfaceRef}>
            <img ref={sourceImageRef} src={sourceUrl} alt="Uploaded textbook page" draggable={false} />
            <div className="crop-mask" aria-hidden="true" />
            <div
              className="crop-frame"
              style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.width}%`, height: `${crop.height}%` }}
              onPointerDown={(event) => beginCropInteraction(event, "move")}
              onPointerMove={updateCropInteraction}
              onPointerUp={finishCropInteraction}
              onPointerCancel={finishCropInteraction}
              role="img"
              aria-label="Selected rectangular crop area"
            >
              {(["nw", "ne", "sw", "se"] as CropMode[]).map((mode) => <button key={mode} type="button" className={`crop-handle handle-${mode}`} aria-label={`Resize crop from ${mode} corner`} onPointerDown={(event) => { event.stopPropagation(); beginCropInteraction(event, mode); }} onPointerMove={updateCropInteraction} onPointerUp={finishCropInteraction} onPointerCancel={finishCropInteraction} />)}
              <span className="crop-caption">Selected problem</span>
            </div>
          </div>
        </div>

        <footer className="crop-focus-actions">
          <button className="button button-quiet" type="button" onClick={() => setCrop(DEFAULT_CROP)}><Icon name="reset" />Reset</button>
          <button className="button button-primary" type="button" onClick={confirmCrop}><Icon name="crop" />Use this crop</button>
        </footer>
      </main>
    );
  }

  return (
    <main className="session-shell">
      <header className="session-header">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">∠</span><div><span className="brand-name">Axiom</span><span className="brand-context">Personal maths session</span></div></div>
        <div className="session-guidance">
          <p className="overline">Class 9 · Circles</p>
          <h1>Axiom guides you with focused questions.</h1>
        </div>
        <div className="session-clock" aria-label={`${minutes} minutes and ${seconds} seconds remaining`}><span className="clock-label">Session time</span><strong>{minutes}:{seconds}</strong></div>
        <div className="header-actions">
          {isPreparing ? <button className="button button-primary" type="button" disabled><span className="button-loader" aria-hidden="true" />Preparing tutor</button> : sessionState !== "active" ? <button className="button button-primary" type="button" onClick={() => void startSession()} disabled={intakeState !== "confirmed"}><Icon name="play" />{sessionState === "ended" ? "Start again" : intakeState === "confirmed" ? "Retry session" : "Starts after crop"}</button> : <button className="button button-quiet button-danger" type="button" onClick={() => void endSession()}><Icon name="stop" />End session</button>}
        </div>
      </header>

      <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" onChange={handleUpload} />

      {intakeState === "upload" ? (
        <div className="workspace intake-workspace">
          <aside className="problem-panel" aria-labelledby="problem-heading">
          <div className="panel-heading">
            <div><p className="overline">Your question</p><h2 id="problem-heading">Add a textbook page</h2></div>
          </div>

          <div className="upload-empty">
            <span className="upload-illustration"><Icon name="image" /></span>
            <h3>Upload the full page</h3>
            <p>You’ll select the one problem you want to solve next.</p>
            <button className="button button-primary" type="button" onClick={() => fileInputRef.current?.click()}><Icon name="upload" />Choose photo</button>
            <span>JPG or PNG</span>
          </div>
          </aside>

          <section className="board-panel" aria-labelledby="board-heading">
            <div className="board-heading"><div><p className="overline">Shared workspace</p><h2 id="board-heading">Tutor board</h2></div><span className="board-owner"><span aria-hidden="true" /> Tutor controlled</span></div>
            <div className="board-waiting"><Icon name="image" /><div><span>Your problem will appear here</span><p>Upload a textbook page, then crop the one question you want to solve.</p></div></div>
          </section>
        </div>
      ) : croppedUrl ? (
        <div className="session-workspace">
          <div className="learning-column">
            <section className="cropped-problem-panel" aria-labelledby="selected-problem-heading">
              <div className="cropped-problem-heading">
                <div><p className="overline">Your question</p><h2 id="selected-problem-heading">Selected problem</h2></div>
                <div className="problem-actions">
                  <button type="button" onClick={() => setIntakeState("crop")} disabled={isPreparing}><Icon name="crop" />Adjust crop</button>
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isPreparing}><Icon name="upload" />Change photo</button>
                </div>
              </div>
              {isPreparing ? (
                <div className="preparation-loader" role="status" aria-live="polite">
                  <span className="preparation-spinner" aria-hidden="true" />
                  <strong>Reading your question</strong>
                  <p>Extracting the problem and preparing the tutor’s first question…</p>
                </div>
              ) : learnerView?.problemText ? (
                <div className="extracted-problem-text">
                  <span>Extracted question</span>
                  <p>{learnerView.problemText}</p>
                </div>
              ) : (
                <div className="cropped-problem-image"><img src={croppedUrl} alt="Confirmed cropped maths problem" /></div>
              )}
              <span className="source-file">{fileName}</span>
            </section>

            <section className="board-panel session-board" aria-labelledby="board-heading">
              <div className="board-heading"><div><p className="overline">Shared workspace</p><h2 id="board-heading">Working board</h2></div><span className="board-owner"><span aria-hidden="true" /> Shared by you and your tutor</span></div>
              <SharedMathBoard
                ref={boardRef}
                editable={sessionState === "active" && voiceState === "listening" && !isRecording}
                isDrawing={isDrawing}
                initialDocument={learnerView?.latestBoardDocument}
                initialRevision={learnerView?.boardRevision}
              />
            </section>
          </div>
          <div className="conversation-column">
            <TranscriptPanel
              turns={learnerView?.turns ?? []}
              typedAnswer={typedAnswer}
              onTypedAnswerChange={setTypedAnswer}
              onTypedAnswerSubmit={submitTypedAnswer}
              canType={learnerCanAnswer && !isRecording}
            />
            {voiceDock}
          </div>
        </div>
      ) : null}

      {intakeState !== "confirmed" && voiceDock}
    </main>
  );
}
