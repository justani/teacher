# Voice Tutor Backend Slice

## Goal

Ship one local prototype loop:

`cropped problem photo -> private Gemini preparation -> opening tutor question -> push-to-talk Sarvam transcription -> short Gemini tutor reply -> streamed Gemini 3.1 TTS playback`

The whiteboard, barge-in, persistent learner memory, authentication, and production rate limiting remain outside this slice.

## Backend boundaries

- Convex owns the session record, cropped image, private preparation, and durable tutor conversation.
- Vertex Gemini extracts the problem and prepares the hidden solution map in one structured call.
- The Convex Agent component owns the tutor's multi-turn message history.
- Sarvam's synchronous speech-to-text endpoint handles each push-to-talk clip. Raw audio is deleted after transcription.
- A Next.js Node route keeps Google credentials server-side and forwards Gemini 3.1 TTS audio chunks to the browser.
- The learner-facing session query never returns the private preparation or answer key.

## Implementation order

1. Add the Convex Agent component and typed server-only provider configuration.
2. Add session schema and storage/upload functions.
3. Add Gemini image extraction and private preparation.
4. Add the short Socratic tutor agent and opening turn.
5. Add Sarvam push-to-talk transcription and the next tutor turn.
6. Add the streamed Gemini 3.1 TTS route and browser PCM playback.
7. Replace the frontend mock states and transcript with live session state.
8. Verify TypeScript, lint, production build, and Convex code generation.

## Acceptance check

With provider secrets configured, one learner can crop a photo, start the session, hear a short opening question, hold the microphone to answer, see the transcript update, and hear the next short tutor reply begin playing before the entire audio response has downloaded.
