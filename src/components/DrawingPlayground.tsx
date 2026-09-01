"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  SharedMathBoard,
  type BoardAction,
  type BoardCheckpoint,
  type SharedMathBoardHandle,
} from "./SharedMathBoard";

type ModelId = "gemini-3.7-flash" | "gpt-5.6-luna" | "gpt-5.6-terra";
type ModelChoice = ModelId | "compare";
type ReasoningLevel = "low" | "medium" | "high";

type ModelResponse = {
  model: ModelId;
  reasoning: ReasoningLevel;
  rawOutput: string;
  actions: BoardAction[];
  malformed: boolean;
  invalidLineCount: number;
  retryCount: number;
  finishReason: string;
  latencyMs: number;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  };
};

type RunRecord = ModelResponse & {
  id: string;
  command: string;
  sourceBoardRevision: number;
  groupId: string;
  applied: boolean;
  error?: string;
};

const MODEL_LABELS: Record<ModelId, string> = {
  "gemini-3.7-flash": "Gemini 3.7 Flash",
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "gpt-5.6-terra": "GPT-5.6 Terra",
};

const STARTER_COMMANDS = [
  "Draw a circle and mark its centre O.",
  "Add two radii making roughly a right angle, then label the angle theta.",
  "Move the theta label outside the sector and point to the angle with an arrow.",
];

function numberOrDash(value: number | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "—";
}

export function DrawingPlayground() {
  const boardRef = useRef<SharedMathBoardHandle>(null);
  const [command, setCommand] = useState(STARTER_COMMANDS[0]);
  const [modelChoice, setModelChoice] = useState<ModelChoice>("gemini-3.7-flash");
  const [reasoning, setReasoning] = useState<ReasoningLevel>("medium");
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const appliedHistory = useMemo(
    () =>
      runs
        .filter((run) => run.applied && !run.error)
        .slice(0, 12)
        .reverse()
        .map((run) => ({
          command: run.command,
          sourceBoardRevision: run.sourceBoardRevision,
          actions: run.actions,
        })),
    [runs],
  );

  async function requestModel(
    model: ModelId,
    checkpoint: BoardCheckpoint,
    submittedCommand: string,
  ): Promise<ModelResponse> {
    const form = new FormData();
    form.set("model", model);
    form.set("reasoning", reasoning);
    form.set("command", submittedCommand);
    form.set("boardSummary", checkpoint.summary);
    form.set("boardRevision", String(checkpoint.revision));
    form.set("history", JSON.stringify(appliedHistory));
    if (checkpoint.image) form.set("boardImage", checkpoint.image, "board.png");

    const response = await fetch("/api/drawing-playground", {
      method: "POST",
      body: form,
    });
    const payload = (await response.json()) as ModelResponse | { error?: string };
    if (!response.ok || !("actions" in payload)) {
      throw new Error("error" in payload && payload.error ? payload.error : "Model request failed.");
    }
    return payload;
  }

  async function runCommand(event: FormEvent) {
    event.preventDefault();
    const submittedCommand = command.trim();
    if (!submittedCommand || isRunning) return;

    setIsRunning(true);
    setPageError(null);
    try {
      const checkpoint = await boardRef.current?.captureCheckpoint();
      if (!checkpoint) throw new Error("The board is still loading. Try again in a moment.");
      const groupId = crypto.randomUUID();
      const models: ModelId[] =
        modelChoice === "compare"
          ? ["gemini-3.7-flash", "gpt-5.6-luna", "gpt-5.6-terra"]
          : [modelChoice];
      const settled = await Promise.allSettled(
        models.map((model) => requestModel(model, checkpoint, submittedCommand)),
      );
      const nextRuns: RunRecord[] = settled.map((result, index) => {
        const model = models[index];
        if (result.status === "rejected") {
          return {
            id: crypto.randomUUID(),
            groupId,
            command: submittedCommand,
            sourceBoardRevision: checkpoint.revision,
            model,
            reasoning,
            rawOutput: "",
            actions: [],
            malformed: false,
            invalidLineCount: 0,
            retryCount: 0,
            finishReason: "error",
            latencyMs: 0,
            usage: {},
            applied: false,
            error: result.reason instanceof Error ? result.reason.message : "Model request failed.",
          };
        }
        return {
          ...result.value,
          id: crypto.randomUUID(),
          groupId,
          command: submittedCommand,
          sourceBoardRevision: checkpoint.revision,
          applied: false,
        };
      });

      if (modelChoice !== "compare") {
        const candidate = nextRuns[0];
        if (!candidate.error && !candidate.malformed) {
          candidate.applied = candidate.actions.length === 0
            ? true
            : Boolean(
                boardRef.current?.applyTutorActions(
                  candidate.actions,
                  candidate.sourceBoardRevision,
                ),
              );
          if (candidate.actions.length > 0 && !candidate.applied) {
            candidate.error = "No action could be applied. A target may be missing, learner-owned, or stale.";
          }
        }
      }
      setRuns((current) => [...nextRuns.reverse(), ...current]);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "The drawing run failed.");
    } finally {
      setIsRunning(false);
    }
  }

  function applyCandidate(run: RunRecord) {
    if (run.error || run.applied || run.malformed) return;
    const applied =
      run.actions.length === 0 ||
      Boolean(boardRef.current?.applyTutorActions(run.actions, run.sourceBoardRevision));
    if (!applied) {
      setRuns((current) =>
        current.map((item) =>
          item.id === run.id
            ? { ...item, error: "The board changed. Rerun this comparison before applying it." }
            : item,
        ),
      );
      return;
    }
    setRuns((current) =>
      current.map((item) =>
        item.groupId === run.groupId
          ? { ...item, applied: item.id === run.id }
          : item,
      ),
    );
  }

  return (
    <main className="drawing-lab-shell">
      <header className="drawing-lab-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>
            <strong className="brand-name">Drawing lab</strong>
            <small className="brand-context">Local model workbench</small>
          </span>
        </div>
        <p>
          Give the artist a direction, inspect its protocol, and keep refining the same board.
        </p>
        <button className="button button-quiet" type="button" onClick={() => window.location.reload()}>
          Reset by refresh
        </button>
      </header>

      <div className="drawing-lab-grid">
        <aside className="drawing-command-rail">
          <form onSubmit={runCommand}>
            <div className="lab-section-heading">
              <span>01</span>
              <div>
                <p className="overline">Direction</p>
                <h1>Tell the artist what to draw</h1>
              </div>
            </div>
            <label htmlFor="drawing-command">Plain-English command</label>
            <textarea
              id="drawing-command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              maxLength={1_200}
              rows={7}
              placeholder="For example: Add a radius from O to the circumference and label it 7 cm."
            />

            <div className="starter-commands" aria-label="Example commands">
              {STARTER_COMMANDS.map((starter, index) => (
                <button key={starter} type="button" onClick={() => setCommand(starter)}>
                  <span>{index + 1}</span>{starter}
                </button>
              ))}
            </div>

            <div className="lab-control-grid">
              <label>
                Model
                <select
                  value={modelChoice}
                  onChange={(event) => setModelChoice(event.target.value as ModelChoice)}
                >
                  <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
                  <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
                  <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
                  <option value="compare">Compare all three</option>
                </select>
              </label>
              <label>
                Reasoning
                <select
                  value={reasoning}
                  onChange={(event) => setReasoning(event.target.value as ReasoningLevel)}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>

            <button className="button button-primary lab-run-button" type="submit" disabled={isRunning || !command.trim()}>
              {isRunning ? <span className="button-loader" aria-hidden="true" /> : <span aria-hidden="true">→</span>}
              {isRunning ? "Generating instructions…" : modelChoice === "compare" ? "Compare on this board" : "Draw on this board"}
            </button>
            <p className="lab-keyboard-hint">⌘ Enter to run · only applied runs become future context</p>
            {pageError && <p className="lab-error" role="alert">{pageError}</p>}
          </form>

          <section className="lab-method-note">
            <p className="overline">Fair comparison</p>
            <p>Compare mode sends the same board snapshot and 24-action protocol to all three models. Choose which result to apply afterward.</p>
          </section>
        </aside>

        <section className="drawing-board-stage" aria-label="Persistent drawing board">
          <div className="lab-stage-heading">
            <div>
              <p className="overline">Live canvas</p>
              <h2>One board, many turns</h2>
            </div>
            <span className={`lab-status ${isRunning ? "is-running" : ""}`}>
              <i aria-hidden="true" />{isRunning ? "Models are thinking" : "Ready for a direction"}
            </span>
          </div>
          <SharedMathBoard ref={boardRef} editable={!isRunning} isDrawing={isRunning} />
        </section>
      </div>

      <section className="drawing-run-ledger">
        <div className="lab-stage-heading">
          <div>
            <p className="overline">Instruction ledger</p>
            <h2>What each model actually returned</h2>
          </div>
          <span>{runs.length} model run{runs.length === 1 ? "" : "s"}</span>
        </div>

        {runs.length === 0 ? (
          <div className="ledger-empty">
            <span aria-hidden="true">SHAPE | STYLE | GROUP | ALIGN | …</span>
            <p>Your first model response will appear here with its parsed actions, latency, tokens, and retry status.</p>
          </div>
        ) : (
          <div className="ledger-list">
            {runs.map((run) => (
              <article key={run.id} className={`ledger-run ${run.error ? "has-error" : ""} ${run.applied ? "is-applied" : ""}`}>
                <header>
                  <div>
                    <strong>{MODEL_LABELS[run.model]}</strong>
                    <span>{run.reasoning} reasoning</span>
                  </div>
                  <span className="run-state">
                    {run.error
                      ? "Error"
                      : run.finishReason === "length"
                        ? "Truncated"
                        : run.malformed
                          ? "Malformed"
                          : run.applied
                            ? "Applied"
                            : "Candidate"}
                  </span>
                </header>
                <blockquote>{run.command}</blockquote>
                {run.rawOutput && <pre>{run.rawOutput}</pre>}
                {run.error && <p className="lab-error" role="alert">{run.error}</p>}
                {!run.error && (
                  <>
                    {!run.rawOutput && <pre>NONE</pre>}
                    <dl>
                      <div><dt>Actions</dt><dd>{run.actions.length}</dd></div>
                      <div><dt>Latency</dt><dd>{(run.latencyMs / 1_000).toFixed(2)}s</dd></div>
                      <div><dt>Input</dt><dd>{numberOrDash(run.usage.inputTokens)}</dd></div>
                      <div><dt>Output</dt><dd>{numberOrDash(run.usage.outputTokens)}</dd></div>
                      <div><dt>Dropped</dt><dd>{run.invalidLineCount}</dd></div>
                      <div><dt>Retries</dt><dd>{run.retryCount}</dd></div>
                    </dl>
                    {!run.applied &&
                      !run.malformed &&
                      !runs.some((item) => item.groupId === run.groupId && item.applied) && (
                      <button className="button button-quiet" type="button" onClick={() => applyCandidate(run)}>
                        Apply this result
                      </button>
                    )}
                  </>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
