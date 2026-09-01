# Axiom AI Tutor Session Prototype

A focused, UI-only prototype for a 15-minute personal maths tutoring session.
The learner uploads a textbook page, crops one problem, and works from a shared
tutor-controlled board while following the voice status and session transcript.

## Included

- Client-side textbook photo upload and rectangular crop tool
- Cropped problem preview with recrop and change-photo controls
- Shared board for the current focus, given information, goal, and working steps
- Mock listening, thinking, and speaking states
- Session timer, microphone control, and interaction transcript
- Responsive desktop and mobile layouts

The current prototype does not include OCR, AI tutoring logic, live voice,
authentication, analytics, or backend persistence.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Local AI drawing playground

Add `OPENAI_API_KEY` to `.env.local` alongside the existing Google credentials,
then open [http://localhost:3000/drawing-playground](http://localhost:3000/drawing-playground).
The playground compares Gemini 3.7 Flash, GPT-5.6 Luna, and GPT-5.6 Terra against
the same board snapshot and 24-command production drawing protocol. Semantic point,
segment, circumcircle, circle-centre, and angle commands let the renderer calculate
exact geometry instead of asking the model to estimate it. New shapes receive short
per-response references so later commands can style, resize, rotate, or group them.
Board state and run history
live only in the browser tab; refreshing the page resets both. The route is unavailable
in production unless `DRAWING_PLAYGROUND_ENABLED=true` is set explicitly.

## Checks

```bash
npm run lint
npm run build
```

## Project map

- `src/components/TutorSession.tsx` — session UI and client-side crop flow
- `src/app/globals.css` — visual system and responsive layout
- `doc/` — prototype scope and representative tutoring session
- `public/sample-sector-page.svg` — deterministic sample page for local review
