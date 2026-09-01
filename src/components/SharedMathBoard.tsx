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
  centerOfCircleFromThreePoints,
  compressLegacySegments,
  createShapeId,
  getSnapshot,
  loadSnapshot,
  toRichText,
  type Editor,
  type TLShape,
  type TLShapeId,
} from "tldraw";

export type BoardAction =
  | { type: "addText"; ref?: string; text: string; x: number; y: number }
  | {
      type: "addFraction";
      ref: string;
      numerator: string;
      denominator: string;
      x: number;
      y: number;
    }
  | {
      type: "cancelFraction";
      ref: string;
      fractionId: string;
      factor: number;
    }
  | { type: "addArrow"; ref?: string; startX: number; startY: number; endX: number; endY: number }
  | { type: "highlight"; ref?: string; x: number; y: number; width: number; height: number }
  | { type: "crossOut"; ref?: string; startX: number; startY: number; endX: number; endY: number }
  | { type: "addCircle"; ref?: string; x: number; y: number; width: number; height: number }
  | {
      type: "addShape";
      ref?: string;
      shape: "rectangle" | "ellipse" | "triangle" | "diamond" | "pentagon" | "hexagon" | "trapezoid";
      x: number;
      y: number;
      width: number;
      height: number;
      label?: string;
    }
  | { type: "addLine"; ref?: string; startX: number; startY: number; endX: number; endY: number }
  | { type: "addPoint"; ref: string; x: number; y: number; label?: string }
  | { type: "addCenterPoint"; ref: string; circleId: string; label?: string }
  | { type: "addSegment"; ref: string; startPointId: string; endPointId: string }
  | { type: "addCircumcircle"; ref: string; pointAId: string; pointBId: string; pointCId: string }
  | {
      type: "addAngleMark";
      ref: string;
      pointAId: string;
      vertexPointId: string;
      pointCId: string;
      label?: string;
    }
  | { type: "moveTutorShape"; targetId: string; x: number; y: number }
  | { type: "resizeTutorShape"; targetId: string; width: number; height: number }
  | { type: "rotateTutorShape"; targetId: string; degrees: number }
  | {
      type: "styleTutorShape";
      targetId: string;
      color: "black" | "grey" | "red" | "orange" | "yellow" | "green" | "blue" | "violet";
      fill: "none" | "semi" | "solid";
      dash: "draw" | "solid" | "dashed" | "dotted";
    }
  | { type: "groupTutorShapes"; ref?: string; targetIds: string[] }
  | {
      type: "alignTutorShapes";
      alignment: "left" | "center-horizontal" | "right" | "top" | "center-vertical" | "bottom";
      targetIds: string[];
    }
  | { type: "distributeTutorShapes"; direction: "horizontal" | "vertical"; targetIds: string[] }
  | { type: "reorderTutorShapes"; position: "front" | "forward" | "backward" | "back"; targetIds: string[] }
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

function divideBoardNumber(text: string, factor: number) {
  const normalized = text.trim().replaceAll(",", "").replace("−", "-");
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  const quotient = value / factor;
  if (!Number.isFinite(value) || !Number.isFinite(quotient)) return null;
  const rounded = Math.round(quotient * 100_000_000) / 100_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function tutorShapeIds(editor: Editor, targetIds: string[]) {
  return [...new Set(targetIds)].flatMap((id) => {
    const shape = editor.getShape(id as TLShapeId);
    return shape?.meta.actor === "tutor" ? [shape.id] : [];
  });
}

function styleTutorShape(
  editor: Editor,
  targetId: TLShapeId,
  style: Extract<BoardAction, { type: "styleTutorShape" }>,
) {
  const target = editor.getShape(targetId);
  if (!target || target.meta.actor !== "tutor") return false;

  let changed = false;
  for (const id of editor.getShapeAndDescendantIds([target.id])) {
    const shape = editor.getShape(id);
    if (!shape || shape.meta.actor !== "tutor") continue;

    if (shape.type === "text") {
      editor.updateShape({ id: shape.id, type: "text", props: { color: style.color } });
      changed = true;
    } else if (shape.type === "geo") {
      editor.updateShape({
        id: shape.id,
        type: "geo",
        props: {
          color: style.color,
          labelColor: style.color,
          fill: style.fill,
          dash: style.dash,
        },
      });
      changed = true;
    } else if (shape.type === "arrow") {
      editor.updateShape({
        id: shape.id,
        type: "arrow",
        props: {
          color: style.color,
          labelColor: style.color,
          fill: style.fill,
          dash: style.dash,
        },
      });
      changed = true;
    } else if (shape.type === "draw") {
      editor.updateShape({
        id: shape.id,
        type: "draw",
        props: {
          color: style.color,
          fill: style.fill,
          dash: style.dash,
        },
      });
      changed = true;
    }
  }
  return changed;
}

type PageRect = { x: number; y: number; w: number; h: number };
type PagePoint = { x: number; y: number };

const polygonGeoKinds = new Set([
  "rectangle",
  "triangle",
  "diamond",
  "pentagon",
  "hexagon",
  "octagon",
  "rhombus",
  "rhombus-2",
  "trapezoid",
]);

function roundCoordinate(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function normalizedPoint(viewport: PageRect, point: PagePoint): [number, number] {
  return [
    roundCoordinate((point.x - viewport.x) / Math.max(1, viewport.w)),
    roundCoordinate((point.y - viewport.y) / Math.max(1, viewport.h)),
  ];
}

function structuralPoints(editor: Editor, shape: TLShape, viewport: PageRect) {
  const transform = editor.getShapePageTransform(shape);
  let localPoints: PagePoint[] = [];

  if (shape.type === "arrow") {
    localPoints = [shape.props.start, shape.props.end];
  } else if (shape.type === "line") {
    localPoints = Object.values(shape.props.points)
      .sort((left, right) => left.index.localeCompare(right.index))
      .map((point) => ({ x: point.x, y: point.y }));
  } else if (shape.type === "geo" && polygonGeoKinds.has(shape.props.geo)) {
    localPoints = editor.getShapeGeometry(shape).vertices;
  }

  return localPoints.length > 0
    ? localPoints.map((point) => normalizedPoint(viewport, transform.applyToPoint(point)))
    : undefined;
}

function summarizeBoard(editor: Editor) {
  const shapes = editor.getCurrentPageShapes();
  if (shapes.length === 0) return "The board is blank.";

  const viewport = editor.getViewportPageBounds();

  const simplified = shapes.map((shape) => {
    const bounds = editor.getShapePageBounds(shape);
    const text = editor.getShapeUtil(shape).getText(shape)?.trim();
    const transform = editor.getShapePageTransform(shape);
    const normalizedBounds = bounds
      ? [
          roundCoordinate((bounds.x - viewport.x) / Math.max(1, viewport.w)),
          roundCoordinate((bounds.y - viewport.y) / Math.max(1, viewport.h)),
          roundCoordinate(bounds.w / Math.max(1, viewport.w)),
          roundCoordinate(bounds.h / Math.max(1, viewport.h)),
        ]
      : undefined;
    return {
      id: shape.id,
      type: shape.type,
      kind: shape.type === "geo" ? shape.props.geo : undefined,
      text: text || undefined,
      parentId: typeof shape.parentId === "string" && shape.parentId.startsWith("shape:")
        ? shape.parentId
        : undefined,
      actor:
        typeof shape.meta.actor === "string" ? shape.meta.actor : "learner",
      semanticKind:
        typeof shape.meta.semanticKind === "string" ? shape.meta.semanticKind : undefined,
      semanticRef:
        typeof shape.meta.semanticRef === "string" ? shape.meta.semanticRef : undefined,
      semanticParents: Array.isArray(shape.meta.semanticParents)
        ? shape.meta.semanticParents.filter((value): value is string => typeof value === "string")
        : undefined,
      b: normalizedBounds,
      c: bounds ? normalizedPoint(viewport, bounds.center) : undefined,
      r: roundCoordinate((transform.rotation() * 180) / Math.PI),
      p: structuralPoints(editor, shape, viewport),
    };
  });

  return JSON.stringify({
    coordinateSystem: "All coordinates are normalized to the full visible board viewport: 0 is left/top and 1 is right/bottom. Values outside 0..1 are offscreen.",
    fields: {
      b: "axis-aligned bounds [x,y,width,height]",
      c: "centre [x,y]",
      r: "clockwise page rotation in degrees",
      p: "ordered structural points [x,y], including line/arrow endpoints and polygon vertices",
      semanticRef: "stable mathematical reference that semantic commands may target",
      semanticParents: "point refs that deterministically define a derived construction",
    },
    viewportPageBounds: {
      x: roundCoordinate(viewport.x),
      y: roundCoordinate(viewport.y),
      width: roundCoordinate(viewport.w),
      height: roundCoordinate(viewport.h),
    },
    note: "Every existing shape is listed. Bounds cover freehand and text shapes; the attached full-viewport image is the source of truth for handwriting.",
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
        const viewport = editor.getViewportPageBounds();
        const image = shapes.length > 0
          ? (await editor.toImage(shapes, {
              format: "png",
              background: true,
              bounds: viewport,
              padding: 0,
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
        const shapeRefs = new Map<string, TLShapeId>();
        const resolveTargetId = (targetId: string) => {
          const createdShapeId = shapeRefs.get(targetId);
          if (createdShapeId) return createdShapeId;
          const directId = (targetId.startsWith("shape:") ? targetId : `shape:${targetId}`) as TLShapeId;
          if (editor.getShape(directId)) return directId;
          const semanticShape = editor
            .getCurrentPageShapes()
            .find((shape) => shape.meta.semanticRef === targetId);
          return semanticShape?.id ?? directId;
        };
        const rememberRef = (shapeRef: string | undefined, shapeId: TLShapeId) => {
          if (shapeRef && !shapeRefs.has(shapeRef)) shapeRefs.set(shapeRef, shapeId);
        };
        const resolvePoint = (targetId: string) => {
          const shape = editor.getShape(resolveTargetId(targetId));
          if (!shape || shape.meta.semanticKind !== "point") return null;
          return editor.getShapePageBounds(shape)?.center ?? null;
        };
        const createSemanticText = (
          text: string,
          location: PagePoint,
          semanticRef: string,
          semanticParents: string[],
        ) => {
          const textId = createShapeId();
          editor.createShape({
            id: textId,
            type: "text",
            x: location.x,
            y: location.y,
            meta: {
              actor: "tutor",
              semanticKind: "label",
              semanticRef,
              semanticParents,
            },
            props: {
              richText: toRichText(text),
              color: "green",
              font: "serif",
              size: "s",
            },
          });
        };
        const createSemanticPoint = (
          center: PagePoint,
          semanticRef: string,
          label?: string,
        ) => {
          const zoom = Math.max(0.1, editor.getZoomLevel());
          const diameter = 10 / zoom;
          const shapeId = createShapeId();
          editor.createShape({
            id: shapeId,
            type: "geo",
            x: center.x - diameter / 2,
            y: center.y - diameter / 2,
            meta: {
              actor: "tutor",
              semanticKind: "point",
              semanticRef,
            },
            props: {
              geo: "ellipse",
              w: diameter,
              h: diameter,
              color: "green",
              fill: "solid",
              dash: "solid",
              size: "s",
            },
          });
          rememberRef(semanticRef, shapeId);
          if (label) {
            createSemanticText(
              label,
              { x: center.x + 8 / zoom, y: center.y - 22 / zoom },
              `${semanticRef}-label`,
              [semanticRef],
            );
          }
          return shapeId;
        };

        const wasReadonly = editor.getIsReadonly();
        let appliedCount = 0;
        if (wasReadonly) editor.updateInstanceState({ isReadonly: false });

        try {
          editor.run(() => {
            for (const action of actions) {
              if (
                action.type === "moveTutorShape" ||
                action.type === "resizeTutorShape" ||
                action.type === "rotateTutorShape" ||
                action.type === "styleTutorShape" ||
                action.type === "updateTutorText" ||
                action.type === "removeTutorShape"
              ) {
                const target = editor.getShape(resolveTargetId(action.targetId));
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
                } else if (action.type === "resizeTutorShape") {
                  const bounds = editor.getShapePageBounds(target);
                  if (bounds && bounds.w > 0 && bounds.h > 0) {
                    editor.resizeShape(target.id, {
                      x: Math.max(40, action.width * viewport.w) / bounds.w,
                      y: Math.max(32, action.height * viewport.h) / bounds.h,
                    });
                    appliedCount += 1;
                  }
                } else if (action.type === "rotateTutorShape") {
                  editor.updateShape({
                    id: target.id,
                    type: target.type,
                    rotation: (action.degrees * Math.PI) / 180,
                  });
                  appliedCount += 1;
                } else if (action.type === "styleTutorShape") {
                  if (styleTutorShape(editor, target.id, action)) appliedCount += 1;
                } else if (action.type === "updateTutorText") {
                  if (target.type === "text") {
                    editor.updateShape({
                      id: target.id,
                      type: "text",
                      props: { richText: toRichText(action.text) },
                    });
                    appliedCount += 1;
                  } else if (target.type === "geo") {
                    editor.updateShape({
                      id: target.id,
                      type: "geo",
                      props: { richText: toRichText(action.text) },
                    });
                    appliedCount += 1;
                  } else if (target.type === "arrow") {
                    editor.updateShape({
                      id: target.id,
                      type: "arrow",
                      props: { richText: toRichText(action.text) },
                    });
                    appliedCount += 1;
                  }
                } else if (action.type === "removeTutorShape") {
                  editor.deleteShape(target.id);
                  appliedCount += 1;
                }
                continue;
              }

              if (
                action.type === "groupTutorShapes" ||
                action.type === "alignTutorShapes" ||
                action.type === "distributeTutorShapes" ||
                action.type === "reorderTutorShapes"
              ) {
                const targetIds = tutorShapeIds(
                  editor,
                  action.targetIds.map((targetId) => resolveTargetId(targetId)),
                );
                if (action.type === "groupTutorShapes" && targetIds.length >= 2) {
                  const groupId = createShapeId();
                  editor.setCurrentTool("select");
                  editor.groupShapes(targetIds, { groupId, select: false });
                  const group = editor.getShape(groupId);
                  if (group) {
                    editor.updateShape({ id: group.id, type: "group", meta: { actor: "tutor" } });
                    rememberRef(action.ref, groupId);
                    appliedCount += 1;
                  }
                } else if (action.type === "alignTutorShapes" && targetIds.length >= 2) {
                  editor.alignShapes(targetIds, action.alignment);
                  appliedCount += 1;
                } else if (action.type === "distributeTutorShapes" && targetIds.length >= 3) {
                  editor.distributeShapes(targetIds, action.direction);
                  appliedCount += 1;
                } else if (action.type === "reorderTutorShapes" && targetIds.length >= 1) {
                  if (action.position === "front") editor.bringToFront(targetIds);
                  else if (action.position === "forward") editor.bringForward(targetIds);
                  else if (action.position === "backward") editor.sendBackward(targetIds);
                  else editor.sendToBack(targetIds);
                  appliedCount += 1;
                }
                continue;
              }

              if (action.type === "addPoint") {
                const center = point(action.x, action.y);
                createSemanticPoint(center, action.ref, action.label);
                appliedCount += 1;
                continue;
              }

              if (action.type === "addCenterPoint") {
                const circle = editor.getShape(resolveTargetId(action.circleId));
                if (!circle || circle.type !== "geo" || circle.props.geo !== "ellipse") continue;
                const center = editor.getShapePageBounds(circle)?.center;
                if (!center) continue;
                createSemanticPoint(center, action.ref, action.label);
                appliedCount += 1;
                continue;
              }

              if (action.type === "addSegment") {
                const start = resolvePoint(action.startPointId);
                const end = resolvePoint(action.endPointId);
                if (!start || !end) continue;
                const shapeId = createShapeId();
                editor.createShape({
                  id: shapeId,
                  type: "arrow",
                  x: start.x,
                  y: start.y,
                  meta: {
                    actor: "tutor",
                    semanticKind: "segment",
                    semanticRef: action.ref,
                    semanticParents: [action.startPointId, action.endPointId],
                  },
                  props: {
                    start: { x: 0, y: 0 },
                    end: { x: end.x - start.x, y: end.y - start.y },
                    color: "green",
                    dash: "draw",
                    arrowheadStart: "none",
                    arrowheadEnd: "none",
                  },
                });
                rememberRef(action.ref, shapeId);
                appliedCount += 1;
                continue;
              }

              if (action.type === "addCircumcircle") {
                const pointA = resolvePoint(action.pointAId);
                const pointB = resolvePoint(action.pointBId);
                const pointC = resolvePoint(action.pointCId);
                if (!pointA || !pointB || !pointC) continue;
                const center = centerOfCircleFromThreePoints(pointA, pointB, pointC);
                if (!center) continue;
                const radius = Math.hypot(pointA.x - center.x, pointA.y - center.y);
                const viewportDiagonal = Math.hypot(viewport.w, viewport.h);
                if (
                  !Number.isFinite(radius) ||
                  radius < 2 ||
                  radius > viewportDiagonal * 4
                ) continue;
                const shapeId = createShapeId();
                editor.createShape({
                  id: shapeId,
                  type: "geo",
                  x: center.x - radius,
                  y: center.y - radius,
                  meta: {
                    actor: "tutor",
                    semanticKind: "circumcircle",
                    semanticRef: action.ref,
                    semanticParents: [action.pointAId, action.pointBId, action.pointCId],
                  },
                  props: {
                    geo: "ellipse",
                    w: radius * 2,
                    h: radius * 2,
                    color: "green",
                    fill: "none",
                    dash: "draw",
                  },
                });
                rememberRef(action.ref, shapeId);
                appliedCount += 1;
                continue;
              }

              if (action.type === "addAngleMark") {
                const pointA = resolvePoint(action.pointAId);
                const vertex = resolvePoint(action.vertexPointId);
                const pointC = resolvePoint(action.pointCId);
                if (!pointA || !vertex || !pointC) continue;
                const armLength = Math.min(
                  Math.hypot(pointA.x - vertex.x, pointA.y - vertex.y),
                  Math.hypot(pointC.x - vertex.x, pointC.y - vertex.y),
                );
                const zoom = Math.max(0.1, editor.getZoomLevel());
                const radius = Math.min(36 / zoom, armLength * 0.28);
                if (!Number.isFinite(radius) || radius < 3 / zoom) continue;
                const startAngle = Math.atan2(pointA.y - vertex.y, pointA.x - vertex.x);
                const endAngle = Math.atan2(pointC.y - vertex.y, pointC.x - vertex.x);
                const delta = ((endAngle - startAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
                if (Math.abs(delta) < 0.03) continue;
                const arcPoints = Array.from({ length: 17 }, (_, index) => {
                  const angle = startAngle + delta * (index / 16);
                  return {
                    x: vertex.x + radius * Math.cos(angle),
                    y: vertex.y + radius * Math.sin(angle),
                  };
                });
                const origin = {
                  x: Math.min(...arcPoints.map((arcPoint) => arcPoint.x)),
                  y: Math.min(...arcPoints.map((arcPoint) => arcPoint.y)),
                };
                const shapeId = createShapeId();
                editor.createShape({
                  id: shapeId,
                  type: "draw",
                  x: origin.x,
                  y: origin.y,
                  meta: {
                    actor: "tutor",
                    semanticKind: "angleMark",
                    semanticRef: action.ref,
                    semanticParents: [action.pointAId, action.vertexPointId, action.pointCId],
                  },
                  props: {
                    ...editor.getShapeUtil("draw").getDefaultProps(),
                    color: "green",
                    fill: "none",
                    dash: "draw",
                    size: "s",
                    segments: compressLegacySegments([
                      {
                        type: "free",
                        points: arcPoints.map((arcPoint) => ({
                          x: arcPoint.x - origin.x,
                          y: arcPoint.y - origin.y,
                          z: 0.5,
                        })),
                      },
                    ]),
                    isComplete: true,
                    isClosed: false,
                    isPen: false,
                  },
                });
                rememberRef(action.ref, shapeId);
                if (action.label) {
                  const middleAngle = startAngle + delta / 2;
                  const labelRadius = radius + 12 / zoom;
                  createSemanticText(
                    action.label,
                    {
                      x: vertex.x + labelRadius * Math.cos(middleAngle),
                      y: vertex.y + labelRadius * Math.sin(middleAngle),
                    },
                    `${action.ref}-label`,
                    [action.ref],
                  );
                }
                appliedCount += 1;
                continue;
              }

              if (action.type === "addText") {
                const location = point(action.x, action.y);
                const shapeId = createShapeId();
                editor.createShape({
                  id: shapeId,
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
                rememberRef(action.ref, shapeId);
                appliedCount += 1;
                continue;
              }

              if (action.type === "addFraction") {
                const center = point(action.x, action.y);
                const zoom = Math.max(0.1, editor.getZoomLevel());
                const termOffset = 34 / zoom;
                const createTerm = (
                  text: string,
                  y: number,
                  suffix: "numerator" | "denominator",
                ) => {
                  const shapeId = createShapeId();
                  editor.createShape({
                    id: shapeId,
                    type: "text",
                    x: center.x,
                    y,
                    meta: {
                      actor: "tutor",
                      semanticKind: "fraction-term",
                      semanticRef: `${action.ref}-${suffix}`,
                      semanticParents: [action.ref],
                    },
                    props: {
                      richText: toRichText(text),
                      color: "green",
                      font: "serif",
                      size: "m",
                    },
                  });
                  const bounds = editor.getShapePageBounds(shapeId);
                  if (bounds) {
                    editor.updateShape({
                      id: shapeId,
                      type: "text",
                      x: center.x - bounds.w / 2,
                    });
                  }
                  rememberRef(`${action.ref}-${suffix}`, shapeId);
                  return shapeId;
                };

                const numeratorId = createTerm(
                  action.numerator,
                  center.y - termOffset,
                  "numerator",
                );
                const denominatorId = createTerm(
                  action.denominator,
                  center.y + 8 / zoom,
                  "denominator",
                );
                const numeratorBounds = editor.getShapePageBounds(numeratorId);
                const denominatorBounds = editor.getShapePageBounds(denominatorId);
                const barWidth = Math.max(
                  56 / zoom,
                  (numeratorBounds?.w ?? 0) + 16 / zoom,
                  (denominatorBounds?.w ?? 0) + 16 / zoom,
                );
                const barId = createShapeId();
                editor.createShape({
                  id: barId,
                  type: "arrow",
                  x: center.x - barWidth / 2,
                  y: center.y,
                  meta: {
                    actor: "tutor",
                    semanticKind: "fraction-bar",
                    semanticRef: `${action.ref}-bar`,
                    semanticParents: [action.ref],
                  },
                  props: {
                    start: { x: 0, y: 0 },
                    end: { x: barWidth, y: 0 },
                    color: "green",
                    dash: "draw",
                    arrowheadStart: "none",
                    arrowheadEnd: "none",
                  },
                });
                rememberRef(`${action.ref}-bar`, barId);

                const groupId = createShapeId();
                editor.groupShapes([numeratorId, barId, denominatorId], {
                  groupId,
                  select: false,
                });
                const group = editor.getShape(groupId);
                if (group) {
                  editor.updateShape({
                    id: group.id,
                    type: "group",
                    meta: {
                      actor: "tutor",
                      semanticKind: "fraction",
                      semanticRef: action.ref,
                    },
                  });
                  rememberRef(action.ref, groupId);
                  appliedCount += 1;
                }
                continue;
              }

              if (action.type === "cancelFraction") {
                const fraction = editor.getShape(resolveTargetId(action.fractionId));
                if (
                  !fraction ||
                  fraction.meta.actor !== "tutor" ||
                  fraction.meta.semanticKind !== "fraction"
                ) continue;
                const fractionRef =
                  typeof fraction.meta.semanticRef === "string"
                    ? fraction.meta.semanticRef
                    : action.fractionId;
                const descendants = [...editor.getShapeAndDescendantIds([fraction.id])]
                  .map((id) => editor.getShape(id))
                  .filter((shape): shape is TLShape => Boolean(shape));
                const numerator = descendants.find(
                  (shape) =>
                    shape.type === "text" &&
                    shape.meta.semanticRef === `${fractionRef}-numerator`,
                );
                const denominator = descendants.find(
                  (shape) =>
                    shape.type === "text" &&
                    shape.meta.semanticRef === `${fractionRef}-denominator`,
                );
                if (!numerator || !denominator) continue;

                const numeratorText = editor.getShapeUtil(numerator).getText(numerator)?.trim();
                const denominatorText = editor.getShapeUtil(denominator).getText(denominator)?.trim();
                const numeratorQuotient = numeratorText
                  ? divideBoardNumber(numeratorText, action.factor)
                  : null;
                const denominatorQuotient = denominatorText
                  ? divideBoardNumber(denominatorText, action.factor)
                  : null;
                if (numeratorQuotient === null || denominatorQuotient === null) continue;

                const zoom = Math.max(0.1, editor.getZoomLevel());
                const cancellationIds: TLShapeId[] = [];
                const createCancellation = (
                  term: TLShape,
                  quotient: string,
                  position: "numerator" | "denominator",
                ) => {
                  const bounds = editor.getShapePageBounds(term);
                  if (!bounds) return false;
                  const cutId = createShapeId();
                  editor.createShape({
                    id: cutId,
                    type: "arrow",
                    x: bounds.x - 3 / zoom,
                    y: bounds.y + bounds.h + 2 / zoom,
                    meta: {
                      actor: "tutor",
                      semanticKind: "fraction-cancel-mark",
                      semanticRef: `${action.ref}-${position}-cut`,
                      semanticParents: [fractionRef],
                    },
                    props: {
                      start: { x: 0, y: 0 },
                      end: { x: bounds.w + 6 / zoom, y: -bounds.h - 4 / zoom },
                      color: "red",
                      dash: "draw",
                      arrowheadStart: "none",
                      arrowheadEnd: "none",
                    },
                  });

                  const replacementId = createShapeId();
                  editor.createShape({
                    id: replacementId,
                    type: "text",
                    x: bounds.x + bounds.w + 7 / zoom,
                    y:
                      position === "numerator"
                        ? bounds.y - 17 / zoom
                        : bounds.y + bounds.h - 1 / zoom,
                    meta: {
                      actor: "tutor",
                      semanticKind: "fraction-cancel-result",
                      semanticRef: `${action.ref}-${position}-result`,
                      semanticParents: [fractionRef],
                    },
                    props: {
                      richText: toRichText(quotient),
                      color: "green",
                      font: "serif",
                      size: "s",
                    },
                  });
                  rememberRef(`${action.ref}-${position}-result`, replacementId);
                  cancellationIds.push(cutId, replacementId);
                  return true;
                };

                if (
                  !createCancellation(numerator, numeratorQuotient, "numerator") ||
                  !createCancellation(denominator, denominatorQuotient, "denominator")
                ) continue;

                const cancellationGroupId = createShapeId();
                editor.groupShapes(cancellationIds, {
                  groupId: cancellationGroupId,
                  select: false,
                });
                const cancellationGroup = editor.getShape(cancellationGroupId);
                if (cancellationGroup) {
                  editor.updateShape({
                    id: cancellationGroup.id,
                    type: "group",
                    meta: {
                      actor: "tutor",
                      semanticKind: "fraction-cancellation",
                      semanticRef: action.ref,
                      semanticParents: [fractionRef],
                    },
                  });
                  rememberRef(action.ref, cancellationGroupId);
                  appliedCount += 1;
                }
                continue;
              }

              if (action.type === "addCircle") {
                const location = point(action.x, action.y);
                const shapeId = createShapeId();
                editor.createShape({
                  id: shapeId,
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
                rememberRef(action.ref, shapeId);
                appliedCount += 1;
                continue;
              }

              if (action.type === "addShape") {
                const location = point(action.x, action.y);
                const shapeId = createShapeId();
                editor.createShape({
                  id: shapeId,
                  type: "geo",
                  x: location.x,
                  y: location.y,
                  meta: { actor: "tutor" },
                  props: {
                    geo: action.shape,
                    w: Math.max(48, action.width * viewport.w),
                    h: Math.max(48, action.height * viewport.h),
                    richText: toRichText(action.label ?? ""),
                    color: "green",
                    labelColor: "green",
                    fill: "none",
                    dash: "draw",
                    font: "serif",
                  },
                });
                rememberRef(action.ref, shapeId);
                appliedCount += 1;
                continue;
              }

              if (action.type === "highlight") {
                const location = point(action.x, action.y);
                const shapeId = createShapeId();
                editor.createShape({
                  id: shapeId,
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
                rememberRef(action.ref, shapeId);
                appliedCount += 1;
                continue;
              }

              if (
                action.type !== "addArrow" &&
                action.type !== "crossOut" &&
                action.type !== "addLine"
              ) continue;

              const start = point(action.startX, action.startY);
              const end = point(action.endX, action.endY);
              const shapeId = createShapeId();
              editor.createShape({
                id: shapeId,
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
              rememberRef(action.ref, shapeId);
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
