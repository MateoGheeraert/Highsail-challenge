// Opt-in live provider check. Uses API credits, but never connects to PostgreSQL.
import "reflect-metadata";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { readConfig } from "../dist/src/config.js";
import { OpenAiService } from "../dist/src/ai/openai.service.js";
import { DeepgramService } from "../dist/src/ai/deepgram.service.js";
import { ProposalInterpreter } from "../dist/src/voice/proposal-interpreter.js";
import { Transcript } from "../dist/src/voice/transcript.js";
import { InferenceScheduler } from "../dist/src/voice/inference-scheduler.js";
import { emptyProposal, previewProposal } from "../dist/src/jobs/proposals.js";

const config = readConfig();
assert.ok(
  config.OPENAI_API_KEY && config.DEEPGRAM_API_KEY,
  "Configure both backend API keys first.",
);
const abort = new AbortController();
const interpreter = new ProposalInterpreter(new OpenAiService(config));
const base = {
  id: "smoke-only",
  version: 0,
  title: "Smoke test (not persisted)",
  arrivalTime: null,
  distanceKm: null,
  generalRemarks: null,
  scheduledAt: null,
  jobCompletedAt: null,
  priority: null,
  tags: [],
  materials: [],
};
let previous = emptyProposal();
const began = Date.now();
try {
  previous = await interpreter.interpret(
    base,
    previous,
    "I arrived at eleven AM.",
    abort.signal,
  );
  assert.equal(previewProposal(base, previous).arrivalTime, "11:00");
  console.log("GPT-5 mini: first structured proposal passed.");
  const retracted = await interpreter.interpret(
    base,
    previous,
    "I arrived at eleven AM. No, scrap that.",
    abort.signal,
  );
  assert.deepEqual(retracted, emptyProposal());
  console.log("GPT-5 mini: standalone retraction passed.");

  let text =
    "I arrived at eleven AM. No scrap that. It was ten AM. I drove forty-two kilometers. Used twelve meters of cable and forty screws. Actually make the cable fifteen meters. Forget the screws.";
  let streamedProposal;
  const audioPath = process.argv[2];
  if (audioPath) {
    const wav = await readFile(audioPath);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    let pcm;
    let sampleRate;
    let channels;
    let bits;
    for (let offset = 12; offset + 8 <= wav.length;) {
      const name = wav.toString("ascii", offset, offset + 4);
      const size = wav.readUInt32LE(offset + 4);
      if (name === "fmt ") {
        assert.equal(
          wav.readUInt16LE(offset + 8),
          1,
          "WAV must be uncompressed PCM",
        );
        channels = wav.readUInt16LE(offset + 10);
        sampleRate = wav.readUInt32LE(offset + 12);
        bits = wav.readUInt16LE(offset + 22);
      }
      if (name === "data") pcm = wav.subarray(offset + 8, offset + 8 + size);
      offset += 8 + size + (size % 2);
    }
    assert.ok(pcm?.length);
    assert.equal(channels, 1);
    assert.equal(bits, 16);
    const transcript = new Transcript();
    let recognitionError;
    let interimCount = 0;
    let liveProposals = 0;
    let recording = true;
    const captureBegan = Date.now();
    const scheduler = new InferenceScheduler(
      (latest) => interpreter.interpret(base, previous, latest, abort.signal),
      (proposal) => {
        streamedProposal = proposal;
        previous = proposal;
        if (recording) {
          liveProposals++;
          if (liveProposals === 1)
            console.log(
              `First live proposal after ${((Date.now() - captureBegan) / 1000).toFixed(1)}s, while audio is still streaming.`,
            );
        }
      },
      () =>
        console.log(
          "An interim interpretation failed; the final drain must recover.",
        ),
    );
    const speech = await new DeepgramService(config).connect(
      { sampleRate, channels, encoding: "int16" },
      (result) => {
        if (transcript.update(result))
          scheduler.request(transcript.revision, transcript.text);
        if (!result.isFinal && result.text) interimCount++;
      },
      (error) => {
        recognitionError = error;
      },
      abort.signal,
    );
    try {
      const frameBytes = Math.floor(sampleRate / 10) * 2;
      for (let offset = 0; offset < pcm.length; offset += frameBytes) {
        if (recognitionError) throw recognitionError;
        speech.send(pcm.subarray(offset, offset + frameBytes));
        await delay(100);
      }
      recording = false;
      await speech.finish();
      await scheduler.flush();
      if (recognitionError) throw recognitionError;
      assert.ok(
        transcript.finalText.length > 20,
        "Expected a final transcript",
      );
      assert.ok(interimCount > 0, "Expected live interim transcripts");
      assert.ok(
        liveProposals > 0,
        "Expected proposal updates before audio stopped",
      );
      assert.equal(
        transcript.interimText,
        "",
        "All transcript text should be finalized",
      );
      text = transcript.finalText;
      console.log(
        `Nova-3: ${interimCount} interim results, ${liveProposals} live proposal updates, drain completed. Transcript: ${text}`,
      );
    } finally {
      scheduler.close();
      speech.close();
    }
  }
  const proposal =
    streamedProposal ??
    (await interpreter.interpret(base, previous, text, abort.signal));
  const preview = previewProposal(base, proposal);
  assert.equal(preview.arrivalTime, "10:00");
  assert.equal(preview.distanceKm, 42);
  assert.equal(preview.materials.length, 1);
  assert.match(preview.materials[0].material, /cable/i);
  assert.equal(preview.materials[0].quantity, 15);
  assert.equal(preview.materials[0].unit, "m");
  assert.deepEqual(proposal.issues, []);
  const extended = await interpreter.interpret(
    base,
    proposal,
    `${text} Set priority to high. Tag this as warranty and follow-up. Remove the follow-up tag. The job is complete. General remarks: access panel replaced.`,
    abort.signal,
  );
  const extendedPreview = previewProposal(base, extended);
  assert.equal(extendedPreview.priority, "high");
  assert.deepEqual(extendedPreview.tags, ["warranty"]);
  assert.equal(extendedPreview.jobCompletedAt, null);
  assert.match(extendedPreview.generalRemarks, /access panel replaced/i);
  assert.equal(extendedPreview.materials.length, 1);
  assert.equal(extendedPreview.materials[0].id, preview.materials[0].id);
  assert.deepEqual(extended.issues, []);
  console.log(
    `Live correction script passed in ${Math.round((Date.now() - began) / 1000)}s. No database writes.`,
  );
} catch (error) {
  // Provider errors may contain request details; never print headers or secrets.
  console.error(
    "Live voice check failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
} finally {
  abort.abort();
}
