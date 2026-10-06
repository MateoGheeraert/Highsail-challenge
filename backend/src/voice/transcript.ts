import type { SpeechResult } from "../ai/deepgram.service.js";

export class Transcript {
  private finals: SpeechResult[] = [];
  private interim: SpeechResult | null = null;
  revision = 0;

  update(result: SpeechResult): boolean {
    const before = this.text;
    const end = this.finals.at(-1);
    const finalizedThrough = end ? end.start + end.duration : 0;
    // Deepgram finalizes consecutive time ranges. Ignore replayed finals and
    // late interim hypotheses for a range which is already final.
    if (result.start + 0.001 < finalizedThrough) return false;
    if (result.isFinal) {
      this.finals.push(result);
      if (
        this.interim &&
        this.interim.start < result.start + result.duration + 0.001
      )
        this.interim = null;
    } else this.interim = result;
    if (before !== this.text) {
      this.revision++;
      return true;
    }
    return false;
  }

  get finalText() {
    return this.finals
      .map((result) => result.text.trim())
      .filter(Boolean)
      .join(" ");
  }
  get interimText() {
    return this.interim?.text.trim() || "";
  }
  get text() {
    return [this.finalText, this.interimText].filter(Boolean).join(" ");
  }
}
