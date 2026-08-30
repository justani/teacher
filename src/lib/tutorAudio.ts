const SAMPLE_RATE = 24000;

function mergeWithCarry(carry: Uint8Array, chunk: Uint8Array) {
  if (carry.length === 0) return chunk;
  const merged = new Uint8Array(carry.length + chunk.length);
  merged.set(carry);
  merged.set(chunk, carry.length);
  return merged;
}

export async function playTutorSpeech(context: AudioContext, text: string) {
  if (context.state === "suspended") await context.resume();

  const response = await fetch("/api/tts/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Tutor audio could not be generated.");
  }

  const reader = response.body.getReader();
  let carry = new Uint8Array(0);
  let nextStartTime = context.currentTime + 0.04;
  let scheduledAudio = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const bytes = mergeWithCarry(carry, value);
    const completeByteCount = bytes.length - (bytes.length % 2);
    carry = bytes.slice(completeByteCount);
    if (completeByteCount === 0) continue;

    const sampleCount = completeByteCount / 2;
    const audioBuffer = context.createBuffer(1, sampleCount, SAMPLE_RATE);
    const channel = audioBuffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, completeByteCount);

    for (let index = 0; index < sampleCount; index += 1) {
      channel[index] = view.getInt16(index * 2, true) / 32768;
    }

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    nextStartTime = Math.max(nextStartTime, context.currentTime + 0.02);
    source.start(nextStartTime);
    nextStartTime += audioBuffer.duration;
    scheduledAudio = true;
  }

  if (!scheduledAudio) throw new Error("Tutor audio was empty.");

  const remainingMilliseconds = Math.max(0, (nextStartTime - context.currentTime) * 1000);
  await new Promise((resolve) => window.setTimeout(resolve, remainingMilliseconds));
}
