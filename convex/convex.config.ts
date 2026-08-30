import agent from "@convex-dev/agent/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    GOOGLE_CLOUD_PROJECT: v.optional(v.string()),
    GOOGLE_CLOUD_LOCATION: v.optional(v.string()),
    GOOGLE_CLIENT_EMAIL: v.optional(v.string()),
    GOOGLE_PRIVATE_KEY: v.optional(v.string()),
    GEMINI_TEXT_MODEL: v.optional(v.string()),
    SARVAM_API_KEY: v.optional(v.string()),
  },
});

app.use(agent);

export default app;
