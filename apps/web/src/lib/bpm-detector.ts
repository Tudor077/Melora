import { analyzeFullBuffer } from "realtime-bpm-analyzer";

export async function detectBpmFromPreview(previewUrl: string): Promise<number | null> {
  try {
    const response = await fetch(previewUrl);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    await audioContext.close();

    const tempos = await analyzeFullBuffer(audioBuffer);
    if (!tempos.length) return null;

    return Math.round(tempos[0].tempo);
  } catch {
    return null;
  }
}
