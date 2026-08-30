# AI Tutor One-Day Build Plan

## Today's finish line

By the end of the day, one learner should be able to:

> Upload one photographed Class 9 maths problem, confirm the question, wait while the tutor privately prepares, discuss it by voice, see the tutor maintain a shared board, solve it through adaptive guidance, and attempt one similar check problem.

## Feature layers

The prototype has five separate layers:

1. **Problem intake:** Read and confirm the photographed question.
2. **Private preparation:** Build an accurate solution map and a pool of possible teaching moves before speaking.
3. **Live tutoring:** Listen to the learner and choose the smallest useful next response.
4. **Shared board:** Keep the problem, current focus, learner reasoning, and working steps visually grounded.
5. **Session closure:** Check whether the learner can explain and transfer the method.

The private preparation is a map, not a script. The learner's responses determine the conversation.

## Build order

### 1. Lock one golden problem and tutoring example — 20 minutes

Choose one real problem Tanusha might solve.

For the first test, use:

- The sector-area problem in `doc/golden-session-circle-sector-area.md`
- The authentic learner–tutor conversation in the same file

The conversation is a style example, not a dialogue script. It demonstrates that the tutor:

- Speaks very little
- Asks one question at a time
- Lets the learner perform the work
- Writes the learner's reasoning on the board
- Corrects small mistakes without taking over
- Returns control to the learner immediately after helping

Do not manually author a complete decision tree for this problem, and do not begin with broad support for all Class 9 maths.

### 2. Create the session screen — 45 minutes

Include only:

- Photo upload
- Original problem image
- Start and end session controls
- Microphone button
- Tutor voice status: listening, thinking, or speaking
- Shared board

The board should have four areas:

- Current focus
- What is given
- What we need to find
- Working steps

### 3. Add photo understanding and confirmation — 45 minutes

After upload:

- Extract the problem.
- Display the interpreted text.
- Ask by voice: “Is this the correct question?”
- Let Tanusha correct it verbally.
- Do not start teaching until it is confirmed.

If the image is unclear, the tutor must admit it and request a clearer photo.

### 4. Build private problem preparation — 60 minutes

After the learner confirms the interpreted question, prepare privately before beginning the tutoring conversation.

The preparation should contain:

- The confirmed problem statement
- The exact answer, approximate answer when useful, and correct units
- One complete solution path
- Other valid solution paths when they are materially different
- The main concept being tested
- Required prerequisite concepts
- Important reasoning checkpoints
- Likely misconceptions and calculation mistakes
- A pool of broad questions, focused hints, prerequisite checks, and rescue explanations
- One similar transfer problem

For the golden sector problem, the preparation is acceptable only if it identifies:

- Exact answer: `77/3 cm²`
- Approximate answer: `25.67 cm²`
- Main formula: `πr² × θ/360`
- Likely confusion between circle area `πr²` and circumference `2πr`

The preparation must finish before the tutor starts teaching. If it cannot confidently determine the problem or answer, it must stop and request clarification rather than improvise.

Keep the preparation inspectable during development, but hidden from the learner. It gives the live tutor somewhere reliable to return when the conversation wanders.

### 5. Build basic voice turn-taking — 60 minutes

Use simple push-to-talk first:

1. Tanusha speaks.
2. The tutor transcribes her response.
3. The tutor generates its next move.
4. The tutor speaks a short reply.

For today, exclude:

- Interrupting the tutor
- Simultaneous speech
- Perfect human intonation
- Advanced echo cancellation

Keep tutor responses to roughly one question or hint at a time.

### 6. Build the adaptive tutoring loop — 90 minutes

Use these as flexible landmarks rather than a fixed sequence:

1. Ask Tanusha what she understands.
2. Establish what is given.
3. Establish what must be found.
4. Ask for her first idea.
5. Diagnose the specific gap.
6. Choose a useful question or hint from the private preparation.
7. Check a prerequisite if her response reveals that it is missing.
8. Explain one small step only after unsuccessful guidance.
9. Ask Tanusha for the next step again.

After every learner response, decide:

> Given what the learner just said, the private solution map, and the current board state, what is the smallest useful thing to say or ask next?

Do not follow the prepared questions in a predetermined order. The learner should be able to take the conversation in an unexpected but relevant direction.

Every tutor response should produce:

- One short spoken reply
- One current question
- Any necessary board update
- The current learning phase
- The current hint level
- The reasoning checkpoint currently being pursued

The tutor should never produce a long worked solution in one turn.

### 7. Connect the tutor to the board — 60 minutes

As Tanusha speaks, the tutor should:

- Write her identified facts under “What is given.”
- Write the goal under “What we need to find.”
- Highlight the relevant line in the photographed question.
- Add only the current working step.
- Visually mark uncertain or incorrect ideas without immediately erasing them.
- Update the current question.

Tanusha controls the thinking through voice; the tutor controls the board. The board should externalize Tanusha's reasoning rather than become a worked solution presented by the tutor.

### 8. Add stuckness handling — 45 minutes

Define simple behaviour:

- First difficulty: redirect attention.
- Second difficulty: give a conceptual hint.
- Third difficulty: check the prerequisite.
- Missing prerequisite: teach it briefly with a tiny example.
- Continued confusion: explain one step, then return control to Tanusha.
- Frustration: acknowledge it and reduce the size of the next step.

This is more important than humour, memory, or voice polish.

### 9. Add session closure — 30 minutes

At the end:

- Ask Tanusha to explain the solution in her own words.
- Clean up the board into a short reasoning path.
- Give one similar transfer problem.
- Let her attempt the important step.
- Summarize what she understood and where she needed help.

Do not claim success merely because the original problem was completed.

### 10. Run one full 15-minute test — 60 minutes

Do not test only isolated features. Run the complete session.

Record:

- Did the tutor understand the image?
- Did private preparation produce the correct answer, concepts, and useful question pool before tutoring began?
- Did the board match what was being discussed?
- Did it ask one clear question at a time?
- Did it adapt to the learner instead of mechanically following its prepared questions?
- Did it reveal an answer prematurely?
- Did it recognize when Tanusha lacked a prerequisite?
- Did the session remain coherent?
- Could she make progress on the transfer problem?
- Where was manual intervention required?

Fix only issues that prevent this one loop from completing.

## Explicitly not today

- Learner writing on the board
- Topic-based problem generation
- Barge-in and simultaneous speech
- Persistent memory
- Multiple learners
- Multiple boards or curricula
- Parent reports
- Gamification
- Fully natural voice
- Infinite canvas
- Handwriting recognition
- One-hour sessions
- Production authentication, payments, or analytics

If time gets tight, preserve the tutoring loop and shared board. Cut voice polish, visual polish, and generality first.

## Definition of done

The prototype is done for the day only when one complete session can proceed from photo upload, through correct private preparation, to a transfer-problem attempt without losing conversational or board context. The live tutor must use the preparation as a reliable map while still adapting each response to the learner. The goal is evidence that the learner is doing mathematical thinking—not proof of human-tutor parity or improved exam marks.
