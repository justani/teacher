import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DrawingPlayground } from "@/components/DrawingPlayground";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Axiom · AI drawing lab",
  description: "A local workbench for comparing AI-generated tldraw instructions.",
};

export default function DrawingPlaygroundPage() {
  const enabled =
    process.env.NODE_ENV !== "production" ||
    process.env.DRAWING_PLAYGROUND_ENABLED === "true";
  if (!enabled) notFound();
  return <DrawingPlayground />;
}
