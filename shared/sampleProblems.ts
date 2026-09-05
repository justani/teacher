// Public gallery metadata only. Private answers and teaching plans live in convex/samplePreparations.ts.
export const SAMPLE_PROBLEMS = [
  { id: "chocolate-fractions", grade: 5, topic: "Sharing a chocolate bar", question: "Riya ate 1/4 of a chocolate bar. Aman ate 1/2 of the same bar. What fraction did they eat altogether?" },
  { id: "straight-line-angles", grade: 7, topic: "Angles on a straight line", question: "Two angles together form a straight angle. One is 65°. How large is the other?" },
  { id: "rectangle-coordinates", grade: 8, topic: "The missing corner", question: "Plot A(1, 1), B(5, 1), and C(5, 4). Where should D be to complete rectangle ABCD?" },
  { id: "fractions", grade: 5, topic: "Adding fractions", question: "Add the fractions: 1/4 + 2/4 = ?" },
  { id: "area", grade: 6, topic: "Area of a rectangle", question: "A rectangle is 8 cm long and 5 cm wide. What is its area?" },
  { id: "percentages", grade: 7, topic: "Everyday percentages", question: "A bag costs Rs 200. It is on sale at 10% off. What is the sale price?" },
  { id: "equations", grade: 8, topic: "Solving an equation", question: "Find the value of x: 3x + 5 = 20." },
] as const;
export type SampleProblem = (typeof SAMPLE_PROBLEMS)[number];
