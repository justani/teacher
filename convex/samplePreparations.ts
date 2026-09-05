import type { Infer } from "convex/values";
import type { privatePreparation } from "./schema";
import { SAMPLE_PROBLEMS, type SampleProblem } from "../shared/sampleProblems";

type Preparation = Infer<typeof privatePreparation>;
type Plan = Omit<Preparation, "problemText" | "confidence">;

// Server-only authored content, reviewed against public/samples/*.png.
// Bump the version whenever an image, question, or teaching plan changes.
// Each session stores a snapshot; never expose these plans in the gallery query.
const SAMPLE_PREPARATION_VERSION = 1;
const plans = {
  "chocolate-fractions": {
    exactAnswer: "3/4 of the chocolate bar",
    mainConcept: "Add fractions of the same whole by expressing them in equal-sized parts.",
    prerequisites: ["Numerator and denominator", "Equivalent fractions"],
    completeSolution: ["Both fractions refer to the same bar.", "1/2 = 2/4.", "1/4 + 2/4 = 3/4.", "Check: three of four equal parts is less than one whole bar."],
    checkpoints: ["Identify addition from altogether.", "Express one half as two quarters.", "Add the number of quarters and explain why the denominator stays four."],
    likelyMisconceptions: ["Adding denominators to get 2/6.", "Treating the two fractions as parts of different-sized wholes."],
    teachingMoves: [
      { level: "redirect", prompt: "What does altogether ask us to find?" },
      { level: "hint", prompt: "If the bar has four equal pieces, how many pieces make half?" },
      { level: "prerequisite", prompt: "Draw one bar split into four equal pieces and identify one quarter and one half." },
      { level: "explain", prompt: "Half is two quarters. Combine Riya's one quarter with Aman's two quarters, keeping each piece the same size." },
    ],
    transferProblem: "Riya eats 1/3 of a bar and Aman eats 1/6 of the same bar. What fraction do they eat altogether?",
    transferAnswer: "1/3 + 1/6 = 2/6 + 1/6 = 3/6 = 1/2 of the bar.",
  },
  "straight-line-angles": {
    exactAnswer: "115°",
    units: "degrees",
    mainConcept: "Two angles forming a straight angle sum to 180 degrees.",
    prerequisites: ["A straight angle measures 180 degrees", "Subtraction"],
    completeSolution: ["Let the unknown angle be x degrees.", "x + 65 = 180.", "x = 180 - 65 = 115 degrees.", "Check: 65 + 115 = 180 degrees."],
    checkpoints: ["Recall the measure of a straight angle.", "Subtract the known angle from 180.", "Verify that the angles sum to 180 degrees."],
    likelyMisconceptions: ["Subtracting from 90 instead of 180.", "Assuming both angles are equal."],
    teachingMoves: [
      { level: "redirect", prompt: "How many degrees are in a straight angle?" },
      { level: "hint", prompt: "One part is 65 degrees. What must both parts total?" },
      { level: "prerequisite", prompt: "Compare a quarter turn with a half turn. Which makes a straight line?" },
      { level: "explain", prompt: "A straight angle is 180 degrees. Remove the known 65-degree part to find the remaining angle." },
    ],
    transferProblem: "Two angles form a straight angle. One is 125°. Find the other.",
    transferAnswer: "180° - 125° = 55°.",
  },
  "rectangle-coordinates": {
    exactAnswer: "D(1, 4)",
    mainConcept: "Use shared x- and y-coordinates to complete an axis-aligned rectangle with consecutive vertices A, B, C, D.",
    prerequisites: ["Ordered pairs (x, y)", "Horizontal and vertical lines", "Opposite sides of a rectangle are parallel"],
    completeSolution: ["Plot A(1, 1), B(5, 1), and C(5, 4).", "AB is horizontal and BC is vertical.", "D must lie directly above A, so its x-coordinate is 1.", "D must be level with C, so its y-coordinate is 4.", "D(1, 4) gives horizontal sides of length 4 and vertical sides of length 3, with four right angles."],
    checkpoints: ["Plot ordered pairs without reversing x and y.", "Identify D's vertical alignment with A.", "Identify D's horizontal alignment with C and check the closed rectangle."],
    likelyMisconceptions: ["Reversing coordinates to give (4, 1).", "Using the side lengths (4, 3) as D's coordinates."],
    teachingMoves: [
      { level: "redirect", prompt: "Plot the three given points. Which side is horizontal?" },
      { level: "hint", prompt: "The missing corner is directly above A and level with C. What stays the same in each direction?" },
      { level: "prerequisite", prompt: "On a vertical line, does x or y stay fixed?" },
      { level: "explain", prompt: "Use A's x-coordinate and C's y-coordinate so AD is vertical and CD is horizontal." },
    ],
    transferProblem: "A rectangle has consecutive vertices P(2, 2), Q(6, 2), R(6, 5), S. Find S.",
    transferAnswer: "S(2, 5).",
  },
  fractions: {
    exactAnswer: "3/4",
    mainConcept: "Add fractions with the same denominator by counting equal-sized parts.",
    prerequisites: ["Meaning of numerator and denominator"],
    completeSolution: ["Both fractions count quarters of the same whole.", "Add the numerators: 1 + 2 = 3.", "Keep the denominator 4: 1/4 + 2/4 = 3/4.", "3 and 4 have no common factor greater than 1, so the result is simplified."],
    checkpoints: ["Recognize that both denominators are 4.", "Explain why the part size stays the same.", "Count three quarters altogether."],
    likelyMisconceptions: ["Adding denominators and answering 3/8."],
    teachingMoves: [
      { level: "redirect", prompt: "What size pieces are both fractions counting?" },
      { level: "hint", prompt: "One quarter plus two quarters makes how many quarters?" },
      { level: "prerequisite", prompt: "Draw a whole divided into four equal pieces. What does each piece represent?" },
      { level: "explain", prompt: "Add the counts of pieces, 1 and 2. The pieces remain quarters, so the denominator stays 4." },
    ],
    transferProblem: "Add 2/7 + 3/7. Explain what happens to the denominator.",
    transferAnswer: "5/7; the pieces remain sevenths.",
  },
  area: {
    exactAnswer: "40 cm²",
    units: "cm²",
    mainConcept: "The area of a rectangle is length multiplied by width, measured in square units.",
    prerequisites: ["Multiplication", "Area counts unit squares"],
    completeSolution: ["The diagram labels the horizontal side 8 cm and the vertical side 5 cm.", "Area = length × width = 8 × 5 = 40 cm².", "Check by counting five rows of eight 1 cm² squares."],
    checkpoints: ["Distinguish inside area from boundary length.", "Multiply the two perpendicular side lengths.", "Use square centimetres."],
    likelyMisconceptions: ["Using perimeter 2 × (8 + 5) = 26.", "Adding 8 + 5.", "Writing cm instead of cm²."],
    teachingMoves: [
      { level: "redirect", prompt: "Are we measuring the space inside the rectangle or the distance around it?" },
      { level: "hint", prompt: "How many unit squares fit in each row, and how many rows are there?" },
      { level: "prerequisite", prompt: "Imagine covering the rectangle with 1 cm by 1 cm squares." },
      { level: "explain", prompt: "Multiply the number of squares in a row by the number of rows. Each square has area 1 cm²." },
    ],
    transferProblem: "A rectangle is 7 cm long and 3 cm wide. Find its area with units.",
    transferAnswer: "7 × 3 = 21 cm².",
  },
  percentages: {
    exactAnswer: "Rs 180",
    units: "rupees",
    mainConcept: "Find a percentage discount and subtract it from the original price.",
    prerequisites: ["Percent means out of 100", "One tenth", "Subtraction"],
    completeSolution: ["Discount = 10/100 × Rs 200 = Rs 20.", "Sale price = Rs 200 - Rs 20 = Rs 180.", "Check: paying 90% of Rs 200 also gives Rs 180."],
    checkpoints: ["Interpret 10% off as a reduction.", "Calculate the Rs 20 discount.", "Distinguish discount amount from sale price."],
    likelyMisconceptions: ["Answering Rs 20, the discount rather than the price.", "Subtracting Rs 10 instead of 10%.", "Adding the discount to the original price."],
    teachingMoves: [
      { level: "redirect", prompt: "Does 10% off make the price larger or smaller?" },
      { level: "hint", prompt: "10% is one tenth. What is one tenth of Rs 200?" },
      { level: "prerequisite", prompt: "If Rs 200 is split into ten equal parts, how much is one part?" },
      { level: "explain", prompt: "The discount is the amount saved. Subtract that amount from Rs 200 to get what you pay." },
    ],
    transferProblem: "A bag costs Rs 300 and has a 20% discount. What is the sale price?",
    transferAnswer: "Discount = Rs 60; sale price = Rs 240.",
  },
  equations: {
    exactAnswer: "x = 5",
    mainConcept: "Solve a two-step linear equation by applying inverse operations equally to both sides.",
    prerequisites: ["Equality as balance", "Inverse operations", "3x means 3 multiplied by x"],
    completeSolution: ["Start with 3x + 5 = 20.", "Subtract 5 from both sides: 3x = 15.", "Divide both sides by 3: x = 5.", "Check by substitution: 3 × 5 + 5 = 20."],
    checkpoints: ["Undo addition using subtraction on both sides.", "Undo multiplication by dividing both sides.", "Verify the value in the original equation."],
    likelyMisconceptions: ["Subtracting 5 on only one side.", "Treating 3x as 3 + x.", "Dividing only 3x by 3 while ignoring the other terms."],
    teachingMoves: [
      { level: "redirect", prompt: "What operations have been applied to x?" },
      { level: "hint", prompt: "How can we undo the +5 while keeping both sides equal?" },
      { level: "prerequisite", prompt: "Think of an equation as a balanced scale. What happens if you remove 5 from only one side?" },
      { level: "explain", prompt: "First subtract 5 from both sides. Then divide both sides by 3 to leave one x." },
    ],
    transferProblem: "Solve 4x + 3 = 23 and check your answer.",
    transferAnswer: "4x = 20, so x = 5. Check: 4 × 5 + 3 = 23.",
  },
} satisfies Record<SampleProblem["id"], Plan>;

export function getSamplePreparation(sampleId: string) {
  const sample = SAMPLE_PROBLEMS.find(({ id }) => id === sampleId);
  if (!sample) return null;
  return {
    ...sample,
    version: SAMPLE_PREPARATION_VERSION,
    preparation: {
      problemText: sample.question,
      confidence: "high" as const,
      ...plans[sample.id],
    },
  };
}
