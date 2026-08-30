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
