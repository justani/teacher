"use client";

/* eslint-disable @next/next/no-img-element */

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type VoiceState = "listening" | "thinking" | "speaking";
type SessionState = "ready" | "active" | "ended";
type IntakeState = "upload" | "crop" | "confirmed";
type CropSelection = { x: number; y: number; width: number; height: number };
type CropMode = "move" | "nw" | "ne" | "sw" | "se";

const DEFAULT_CROP: CropSelection = { x: 8, y: 18, width: 84, height: 38 };

const voiceCopy: Record<VoiceState, { label: string; detail: string }> = {
  listening: { label: "Listening", detail: "Tell me what the question is asking us to find." },
  thinking: { label: "Thinking", detail: "I’m considering the smallest useful next question." },
  speaking: { label: "Speaking", detail: "Area of a sector uses part of the circle’s area." },
};

const focusCopy: Record<VoiceState, string> = {
  listening: "Which formula should we use for the area of this sector?",
  thinking: "Checking the formula you suggested…",
  speaking: "Use the circle’s area, then take the 60° share.",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function Icon({ name }: { name: "upload" | "mic" | "stop" | "play" | "image" | "crop" | "reset" }) {
  const paths = {
    upload: <><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14v5h14v-5"/></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3M9 21h6"/></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
    play: <path d="M8 5.5v13l10-6.5z"/>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M3 16l5-4 4 3 3-2 6 5"/></>,
    crop: <><path d="M7 3v14a2 2 0 002 2h12M3 7h14a2 2 0 012 2v12"/></>,
    reset: <><path d="M4 9a8 8 0 111.4 7.6"/><path d="M4 4v5h5"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function TranscriptPanel({ voiceState }: { voiceState: VoiceState }) {
  const transcript = [
    { speaker: "Tutor", time: "00:12", text: "Okay, what is the question asking us to do?" },
    { speaker: "Tanusha", time: "00:18", text: "Find the area of a sector of a circle." },
    { speaker: "Tutor", time: "00:25", text: "Do you know how to find the area?" },
    { speaker: "Tanusha", time: "00:34", text: "I think it is 2πr multiplied by θ divided by 360." },
    { speaker: "Tutor", time: "00:40", text: "That formula finds a length. What should we use for area?" },
    { speaker: "Tanusha", time: "00:52", text: "πr² multiplied by θ divided by 360." },
  ];

  return (
    <aside className="transcript-panel" aria-labelledby="transcript-heading">
      <div className="transcript-heading">
        <div><p className="overline">Conversation</p><h2 id="transcript-heading">Session transcript</h2></div>
        <span className="transcript-live"><span aria-hidden="true" /> Live</span>
      </div>
      <ol className="transcript-list">
        {transcript.map((entry) => (
          <li key={`${entry.time}-${entry.speaker}`} className={entry.speaker === "Tutor" ? "tutor-line" : "learner-line"}>
            <div><strong>{entry.speaker}</strong><time>{entry.time}</time></div>
            <p>{entry.text}</p>
          </li>
        ))}
        <li className="transcript-current" aria-live="polite">
          <div><strong>Tutor</strong><span>{voiceCopy[voiceState].label}</span></div>
          <p>{voiceCopy[voiceState].detail}</p>
        </li>
      </ol>
      <p className="transcript-note">Voice transcript appears here as the session continues.</p>
    </aside>
  );
}

export function TutorSession() {
  const [sessionState, setSessionState] = useState<SessionState>("ready");
  const [intakeState, setIntakeState] = useState<IntakeState>("upload");
  const [voiceState, setVoiceState] = useState<VoiceState>("listening");
  const [isMicOn, setIsMicOn] = useState(true);
  const [secondsRemaining, setSecondsRemaining] = useState(15 * 60);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [crop, setCrop] = useState<CropSelection>(DEFAULT_CROP);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropSurfaceRef = useRef<HTMLDivElement>(null);
  const sourceImageRef = useRef<HTMLImageElement>(null);
  const interactionRef = useRef<{
    mode: CropMode;
    startX: number;
    startY: number;
    initial: CropSelection;
  } | null>(null);

  useEffect(() => {
    if (sessionState !== "active" || secondsRemaining <= 0) return;
    const timer = window.setInterval(() => setSecondsRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [sessionState, secondsRemaining]);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

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
    const minSize = 18;

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
    setCroppedUrl(canvas.toDataURL("image/jpeg", 0.92));
    setIntakeState("confirmed");
  }

  function startSession() {
    if (intakeState !== "confirmed") return;
    setSessionState("active");
    setVoiceState("listening");
    setIsMicOn(true);
    if (secondsRemaining === 0) setSecondsRemaining(15 * 60);
  }

  const minutes = Math.floor(secondsRemaining / 60).toString().padStart(2, "0");
  const seconds = (secondsRemaining % 60).toString().padStart(2, "0");

  return (
    <main className="session-shell">
      <header className="session-header">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">∠</span><div><span className="brand-name">Axiom</span><span className="brand-context">Personal maths session</span></div></div>
        <div className="session-clock" aria-label={`${minutes} minutes and ${seconds} seconds remaining`}><span className="clock-label">Session time</span><strong>{minutes}:{seconds}</strong></div>
        <div className="header-actions">
          {sessionState !== "active" ? <button className="button button-primary" type="button" onClick={startSession} disabled={intakeState !== "confirmed"}><Icon name="play" />{sessionState === "ended" ? "Start again" : "Start session"}</button> : <button className="button button-quiet button-danger" type="button" onClick={() => { setSessionState("ended"); setIsMicOn(false); }}><Icon name="stop" />End session</button>}
        </div>
      </header>

      <section className="session-intro" aria-labelledby="session-title">
        <div><p className="overline">Class 9 · Circles</p><h1 id="session-title">Let’s work through this together.</h1></div>
        <p className="session-note">You do the thinking. Your tutor keeps the board clear and asks one question at a time.</p>
      </section>

      <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" onChange={handleUpload} />

      {intakeState !== "confirmed" ? (
        <div className="workspace intake-workspace">
          <aside className="problem-panel" aria-labelledby="problem-heading">
          <div className="panel-heading">
            <div><p className="overline">Your question</p><h2 id="problem-heading">{intakeState === "upload" ? "Add a textbook page" : "Select one problem"}</h2></div>
            {intakeState !== "upload" && <button className="icon-button" type="button" onClick={() => fileInputRef.current?.click()} aria-label="Retake or change the page photo"><Icon name="upload" /></button>}
          </div>

          {intakeState === "upload" ? (
            <div className="upload-empty">
              <span className="upload-illustration"><Icon name="image" /></span>
              <h3>Upload the full page</h3>
              <p>You’ll select the one problem you want to solve next.</p>
              <button className="button button-primary" type="button" onClick={() => fileInputRef.current?.click()}><Icon name="upload" />Choose photo</button>
              <span>JPG or PNG</span>
            </div>
          ) : intakeState === "crop" && sourceUrl ? (
            <>
              <p className="crop-help">Drag the frame to move it. Use a corner handle to resize it around one complete problem.</p>
              <div className="problem-preview crop-preview" ref={cropSurfaceRef}>
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
              <div className="crop-actions">
                <button className="button button-quiet" type="button" onClick={() => setCrop(DEFAULT_CROP)}><Icon name="reset" />Reset selection</button>
                <button className="button button-primary" type="button" onClick={confirmCrop}><Icon name="crop" />Confirm crop</button>
              </div>
            </>
          ) : null}
          </aside>

          <section className="board-panel" aria-labelledby="board-heading">
            <div className="board-heading"><div><p className="overline">Shared workspace</p><h2 id="board-heading">Tutor board</h2></div><span className="board-owner"><span aria-hidden="true" /> Tutor controlled</span></div>
            <div className="board-waiting"><Icon name={intakeState === "crop" ? "crop" : "image"} /><div><span>{intakeState === "crop" ? "Select the exact problem" : "Your problem will appear here"}</span><p>{intakeState === "crop" ? "Confirm the crop when the full question and diagram are inside the frame." : "Upload a textbook page, then crop the one question you want to solve."}</p></div></div>
          </section>
        </div>
      ) : croppedUrl ? (
        <div className="session-workspace">
          <div className="learning-column">
            <section className="cropped-problem-panel" aria-labelledby="selected-problem-heading">
              <div className="cropped-problem-heading">
                <div><p className="overline">Your question</p><h2 id="selected-problem-heading">Selected problem</h2></div>
                <div className="problem-actions">
                  <button type="button" onClick={() => setIntakeState("crop")}><Icon name="crop" />Adjust crop</button>
                  <button type="button" onClick={() => fileInputRef.current?.click()}><Icon name="upload" />Change photo</button>
                </div>
              </div>
              <div className="cropped-problem-image"><img src={croppedUrl} alt="Confirmed cropped maths problem" /></div>
              <span className="source-file">{fileName}</span>
            </section>

            <section className="board-panel session-board" aria-labelledby="board-heading">
              <div className="board-heading"><div><p className="overline">Shared workspace</p><h2 id="board-heading">Tutor board</h2></div><span className="board-owner"><span aria-hidden="true" /> Tutor controlled</span></div>
              <div className="focus-strip"><span className="board-label">Current focus</span><p>{focusCopy[voiceState]}</p></div>
              <div className="board-grid">
                <section className="board-area board-given"><span className="board-index">01</span><h3>What is given</h3><ul><li>Radius, <em>r</em> = 7 cm</li><li>Sector angle, <em>θ</em> = 60°</li></ul></section>
                <section className="board-area board-find"><span className="board-index">02</span><h3>What we need to find</h3><p>Area of the shaded sector</p><span className="unit-note">Answer in cm²</span></section>
                <section className="board-area board-working"><span className="board-index">03</span><h3>Working steps</h3><div className="working-line muted-working"><span className="strike">2πr</span><small>That finds circumference</small></div><div className="working-line active-working"><span>πr² × <span className="fraction"><span>θ</span><span>360</span></span></span><small>Your corrected formula</small></div><div className="next-line">Your next step goes here…</div></section>
              </div>
            </section>
          </div>
          <TranscriptPanel voiceState={voiceState} />
        </div>
      ) : null}

      <section className={`voice-dock voice-${voiceState} ${intakeState !== "confirmed" ? "intake-open" : ""}`} aria-label="Tutor voice controls">
        <div className="voice-presence" aria-live="polite"><span className="voice-orbit" aria-hidden="true"><span /></span><div><strong>{sessionState === "ended" ? "Session ended" : voiceCopy[voiceState].label}</strong><p>{sessionState === "ended" ? "Your board is still here when you’re ready to begin again." : voiceCopy[voiceState].detail}</p></div></div>
        <div className="state-preview" aria-label="Preview tutor voice state"><span>Preview state</span>{(["listening", "thinking", "speaking"] as VoiceState[]).map((state) => <button key={state} type="button" className={voiceState === state ? "active" : ""} onClick={() => setVoiceState(state)} aria-pressed={voiceState === state}>{voiceCopy[state].label}</button>)}</div>
        <button className={`mic-button ${isMicOn ? "mic-on" : ""}`} type="button" onClick={() => setIsMicOn((value) => !value)} disabled={sessionState === "ended"} aria-pressed={isMicOn}><Icon name="mic" /><span>{isMicOn ? "Mic on" : "Mic off"}</span></button>
      </section>
    </main>
  );
}
