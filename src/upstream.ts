export async function readBoundedText(response: Response, service: string): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Invalid ${service} response body`);
  let size = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); throw new Error(`${service} response too large`); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
