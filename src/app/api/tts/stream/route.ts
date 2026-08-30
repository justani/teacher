import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TTS_CHARACTERS = 500;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured on the server.`);
  return value;
}

function createGeminiClient() {
  return new GoogleGenAI({
    vertexai: true,
    project: requiredEnv("GOOGLE_CLOUD_PROJECT"),
    location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
    googleAuthOptions: {
      credentials: {
        client_email: requiredEnv("GOOGLE_CLIENT_EMAIL"),
        private_key: requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      },
    },
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("text" in body) ||
    typeof body.text !== "string"
  ) {
    return Response.json({ error: "A text string is required." }, { status: 400 });
  }

  const text = body.text.trim();
  if (!text || text.length > MAX_TTS_CHARACTERS) {
    return Response.json(
      { error: `Text must contain 1 to ${MAX_TTS_CHARACTERS} characters.` },
      { status: 400 },
    );
  }

  let stream;
  try {
    stream = await createGeminiClient().interactions.create({
      model: process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview",
      input: `Speak as a warm, concise female Indian maths tutor. Read only this response naturally, including any Hinglish and spoken maths:\n\n${text}`,
      response_format: {
        type: "audio",
        mime_type: "audio/l16",
        sample_rate: 24000,
        delivery: "inline",
      },
      generation_config: {
        speech_config: [{ voice: process.env.GEMINI_TTS_VOICE ?? "Kore" }],
      },
      stream: true,
      store: false,
    });
  } catch {
    return Response.json(
      { error: "Tutor audio could not be generated. Check the server TTS configuration." },
      { status: 502 },
    );
  }

  const audio = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.event_type === "step.delta" &&
            event.delta.type === "audio" &&
            event.delta.data
          ) {
            controller.enqueue(Buffer.from(event.delta.data, "base64"));
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(audio, {
    headers: {
      "Content-Type": "audio/l16;rate=24000;channels=1",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
