"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Tldraw,
  createShapeId,
  getSnapshot,
  loadSnapshot,
  toRichText,
  type Editor,
  type TLShapeId,
} from "tldraw";

export type BoardAction =
  | { type: "addText"; text: string; x: number; y: number }
  | { type: "addArrow"; startX: number; startY: number; endX: number; endY: number }
  | { type: "highlight"; x: number; y: number; width: number; height: number }
  | { type: "crossOut"; startX: number; startY: number; endX: number; endY: number }
  | { type: "addCircle"; x: number; y: number; width: number; height: number }
  | { type: "addLine"; startX: number; startY: number; endX: number; endY: number }
  | { type: "moveTutorShape"; targetId: string; x: number; y: number }
  | { type: "updateTutorText"; targetId: string; text: string }
  | { type: "removeTutorShape"; targetId: string };

export type BoardCheckpoint = {
  document: string;
  summary: string;
  image: Blob | null;
  revision: number;
};

export type SharedMathBoardHandle = {
  captureCheckpoint: () => Promise<BoardCheckpoint | null>;
  applyTutorActions: (actions: BoardAction[], expectedRevision?: number) => boolean;
};

type BoardTool = "draw" | "eraser" | "select";

type SharedMathBoardProps = {
  editable: boolean;
  isDrawing?: boolean;
  initialDocument?: string;
  initialRevision?: number;
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function summarizeBoard(editor: Editor) {
  const shapes = editor.getCurrentPageShapes();
  if (shapes.length === 0) return "The board is blank.";

  const simplified = shapes.slice(0, 120).map((shape) => {
    const bounds = editor.getShapePageBounds(shape);
    const text = editor.getShapeUtil(shape).getText(shape)?.trim();
    return {
      id: shape.id,
      type: shape.type,
      text: text || undefined,
      bounds: bounds
        ? {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.w),
            height: Math.round(bounds.h),
          }
        : undefined,
      actor:
        typeof shape.meta.actor === "string" ? shape.meta.actor : "learner",
    };
  });

  return JSON.stringify({
    note: "Coordinates are page coordinates. The attached image is the visual source of truth for handwriting.",
    shapeCount: shapes.length,
    shapes: simplified,
  });
}

export const SharedMathBoard = forwardRef<SharedMathBoardHandle, SharedMathBoardProps>(
  function SharedMathBoard({ editable, isDrawing = false, initialDocument, initialRevision = 0 }, ref) {
    const [editor, setEditor] = useState<Editor | null>(null);
    const [activeTool, setActiveTool] = useState<BoardTool>("draw");
    const [hasContent, setHasContent] = useState(false);
    const revisionRef = useRef(initialRevision);
    const loadedDocumentRef = useRef<string | null>(null);

    useEffect(() => {
      revisionRef.current = Math.max(revisionRef.current, initialRevision);
    }, [initialRevision]);

    useEffect(() => {
      if (!editor) return;
      editor.updateInstanceState({ isReadonly: !editable });
      if (!editable) editor.setCurrentTool("select");
      else editor.setCurrentTool(activeTool);
    }, [activeTool, editable, editor]);

    useEffect(() => {
      if (!editor || !initialDocument || loadedDocumentRef.current === initialDocument) return;
      if (editor.getCurrentPageShapes().length > 0) return;
      try {
        const document = JSON.parse(initialDocument) as ReturnType<typeof getSnapshot>["document"];
        loadSnapshot(editor.store, { document });
        loadedDocumentRef.current = initialDocument;
        setHasContent(editor.getCurrentPageShapes().length > 0);
      } catch {
        // A malformed old checkpoint should not prevent the learner opening a clean board.
      }
    }, [editor, initialDocument]);

    useImperativeHandle(ref, () => ({
      async captureCheckpoint() {
        if (!editor) return null;
        const shapes = editor.getCurrentPageShapes();
        const snapshot = getSnapshot(editor.store);
        const document = JSON.stringify(snapshot.document);
        const summary = summarizeBoard(editor);
        const image = shapes.length > 0
          ? (await editor.toImage(shapes, {
              format: "png",
              background: true,
              padding: 32,
              scale: 1,
            })).blob
          : null;
        revisionRef.current += 1;
        return { document, summary, image, revision: revisionRef.current };
      },
      applyTutorActions(actions, expectedRevision) {
        if (!editor || actions.length === 0) return false;
        if (
          expectedRevision !== undefined &&
          revisionRef.current !== expectedRevision
        ) {
          return false;
        }
        const viewport = editor.getViewportPageBounds();
        const point = (x: number, y: number) => ({
          x: viewport.x + clamp01(x) * viewport.w,
          y: viewport.y + clamp01(y) * viewport.h,
        });

        const wasReadonly = editor.getIsReadonly();
        let appliedCount = 0;
        if (wasReadonly) editor.updateInstanceState({ isReadonly: false });

        try {
          editor.run(() => {
            for (const action of actions) {
              if (
                action.type === "moveTutorShape" ||
                action.type === "updateTutorText" ||
                action.type === "removeTutorShape"
              ) {
                const target = editor.getShape(action.targetId as TLShapeId);
                if (!target || target.meta.actor !== "tutor") continue;

                if (action.type === "moveTutorShape") {
                  const location = point(action.x, action.y);
                  editor.updateShape({
                    id: target.id,
                    type: target.type,
                    x: location.x,
                    y: location.y,
                  });
                  appliedCount += 1;
                } else if (action.type === "updateTutorText" && target.type === "text") {
                  editor.updateShape({
                    id: target.id,
                    type: "text",
                    props: { richText: toRichText(action.text) },
                  });
                  appliedCount += 1;
                } else if (action.type === "removeTutorShape") {
                  editor.deleteShape(target.id);
                  appliedCount += 1;
                }
                continue;
              }

              if (action.type === "addText") {
                const location = point(action.x, action.y);
                editor.createShape({
                  id: createShapeId(),
                  type: "text",
                  x: location.x,
                  y: location.y,
                  meta: { actor: "tutor" },
                  props: {
                    richText: toRichText(action.text),
                    color: "green",
                    font: "serif",
                    size: "m",
                  },
                });
                appliedCount += 1;
                continue;
              }

              if (action.type === "addCircle") {
                const location = point(action.x, action.y);
                editor.createShape({
                  id: createShapeId(),
                  type: "geo",
                  x: location.x,
                  y: location.y,
                  meta: { actor: "tutor" },
                  props: {
                    geo: "ellipse",
                    w: Math.max(48, action.width * viewport.w),
                    h: Math.max(48, action.height * viewport.h),
                    color: "green",
                    fill: "none",
                    dash: "draw",
                  },
                });
                appliedCount += 1;
                continue;
              }

              if (action.type === "highlight") {
                const location = point(action.x, action.y);
                editor.createShape({
                  id: createShapeId(),
                  type: "geo",
                  x: location.x,
                  y: location.y,
                  opacity: 0.38,
                  meta: { actor: "tutor" },
                  props: {
                    geo: "rectangle",
                    w: Math.max(40, action.width * viewport.w),
                    h: Math.max(28, action.height * viewport.h),
                    color: "yellow",
                    fill: "semi",
                    dash: "draw",
                  },
                });
                appliedCount += 1;
                continue;
              }

              const start = point(action.startX, action.startY);
              const end = point(action.endX, action.endY);
              editor.createShape({
                id: createShapeId(),
                type: "arrow",
                x: start.x,
                y: start.y,
                meta: { actor: "tutor" },
                props: {
                  start: { x: 0, y: 0 },
                  end: { x: end.x - start.x, y: end.y - start.y },
                  color: action.type === "crossOut" ? "red" : "green",
                  dash: "draw",
                  arrowheadStart: "none",
                  arrowheadEnd:
                    action.type === "crossOut" || action.type === "addLine"
                      ? "none"
                      : "arrow",
                },
              });
              appliedCount += 1;
            }
          });
        } finally {
          if (wasReadonly) editor.updateInstanceState({ isReadonly: true });
        }
        if (appliedCount > 0) {
          setHasContent(editor.getCurrentPageShapes().length > 0);
        }
        return appliedCount > 0;
      },
    }), [editor]);

    function selectTool(tool: BoardTool) {
      if (!editor || !editable) return;
      setActiveTool(tool);
      editor.setCurrentTool(tool);
    }

    function handleUndo() {
      if (!editor || !editable) return;
      editor.undo();
      setHasContent(editor.getCurrentPageShapes().length > 0);
    }

    return (
      <div className={`math-board ${editable ? "board-editable" : "board-locked"}`}>
        <div className="math-board-toolbar" aria-label="Board tools">
          <div className="board-tools-primary" role="group" aria-label="Drawing tool">
            {(["draw", "eraser", "select"] as BoardTool[]).map((tool) => (
              <button
                key={tool}
                type="button"
                className={activeTool === tool ? "active" : ""}
                onClick={() => selectTool(tool)}
                disabled={!editable}
                aria-pressed={activeTool === tool}
              >
                <span aria-hidden="true">{tool === "draw" ? "✎" : tool === "eraser" ? "⌫" : "↖"}</span>
                {tool === "draw" ? "Pen" : tool === "eraser" ? "Eraser" : "Select"}
              </button>
            ))}
          </div>
          <button type="button" className="board-undo" onClick={handleUndo} disabled={!editable || !hasContent}>
            <span aria-hidden="true">↶</span> Undo
          </button>
          <span
            className={`board-turn-pill ${editable ? "learner-turn" : "tutor-turn"} ${isDrawing ? "drawing-turn" : ""}`}
            role="status"
            aria-live="polite"
          >
            <span aria-hidden="true" /> {isDrawing ? "Tutor is drawing…" : editable ? "Your turn" : "Tutor is using the board"}
          </span>
        </div>
        <div className="math-board-canvas">
          <Tldraw
            hideUi
            licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
            onMount={(mountedEditor) => {
              setEditor(mountedEditor);
              mountedEditor.setCurrentTool("draw");
              setHasContent(mountedEditor.getCurrentPageShapes().length > 0);
              return mountedEditor.store.listen(() => {
                setHasContent(mountedEditor.getCurrentPageShapes().length > 0);
              }, { source: "user", scope: "document" });
            }}
          />
          {!hasContent && (
            <div className="board-empty-hint" aria-hidden="true">
              <span>Start your working here</span>
              <p>Write a formula, draw the diagram, or mark what you know.</p>
            </div>
          )}
          {!editable && <div className="board-lock-scrim" aria-hidden="true" />}
        </div>
      </div>
    );
  },
);
