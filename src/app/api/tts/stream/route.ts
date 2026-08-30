import { GoogleGenAI, Modality } from "@google/genai";

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
    stream = await createGeminiClient().models.generateContentStream({
      model: process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview",
      contents: `Speak as a warm, concise female Indian maths tutor. Read only this response naturally, including any Hinglish and spoken maths:\n\n${text}`,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          languageCode: "en-IN",
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: process.env.GEMINI_TTS_VOICE ?? "Kore",
            },
          },
        },
      },
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
          for (const candidate of event.candidates ?? []) {
            for (const part of candidate.content?.parts ?? []) {
              if (part.inlineData?.data) {
                controller.enqueue(Buffer.from(part.inlineData.data, "base64"));
              }
            }
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
      "Content-Type": "audio/pcm;rate=24000;channels=1",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
