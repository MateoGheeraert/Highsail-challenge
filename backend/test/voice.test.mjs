import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  normalizeProposal,
  previewProposal,
  emptyProposal,
} from "../dist/src/jobs/proposals.js";
import { Transcript } from "../dist/src/voice/transcript.js";
import { InferenceScheduler } from "../dist/src/voice/inference-scheduler.js";
import { VoiceSessionService } from "../dist/src/voice/voice-session.service.js";
import { SessionStore } from "../dist/src/voice/session-store.js";

const base = {
  id: "job",
  version: 3,
  title: "Demo",
  arrivalTime: "09:00",
  distanceKm: null,
  generalRemarks: null,
  scheduledAt: null,
  jobCompletedAt: null,
  priority: null,
  tags: [],
  materials: [
    {
      id: "existing-cable",
      material: "Cable",
      quantity: 12,
      unit: "m",
      position: 0,
    },
  ],
};
const field = (fieldKey, value, op = "set") => ({
  fieldOps: [{ op, fieldKey, value }],
  lineOps: [],
  issues: [],
});
const row = (op, lineId, values) => ({
  fieldOps: [],
  lineOps: [{ op, groupKey: "materials", lineId, values }],
  issues: [],
});

test("retraction restores committed data; clear is a real change; zero survives", () => {
  assert.equal(
    previewProposal(
      base,
      normalizeProposal(field("arrivalTime", "11:00"), base),
    ).arrivalTime,
    "11:00",
  );
  assert.equal(previewProposal(base, emptyProposal()).arrivalTime, "09:00");
  assert.equal(
    previewProposal(
      base,
      normalizeProposal(field("arrivalTime", null, "clear"), base),
    ).arrivalTime,
    null,
  );
  assert.equal(
    previewProposal(base, normalizeProposal(field("distanceKm", 0), base))
      .distanceKm,
    0,
  );
  assert.throws(() =>
    normalizeProposal(field("jobCompletedAt", "2026-10-06T12:30:00Z"), base),
  );
  assert.throws(() =>
    normalizeProposal(field("scheduledAt", "2026-10-07"), base),
  );
  assert.equal(
    normalizeProposal(field("arrivalTime", "09:00"), base).fieldOps.length,
    0,
  );
  assert.equal(base.arrivalTime, "09:00");
});

test("material proposals replace, revise and retract without duplicating rows", () => {
  let proposal = normalizeProposal(
    row("create", "new:screws", {
      material: "Screws",
      quantity: 40,
      unit: "pcs",
    }),
    base,
  );
  assert.equal(previewProposal(base, proposal).materials.length, 2);
  proposal = normalizeProposal(
    row("create", "new:screws", {
      material: "Screws",
      quantity: 45,
      unit: "pcs",
    }),
    base,
  );
  assert.equal(previewProposal(base, proposal).materials.length, 2);
  assert.equal(previewProposal(base, proposal).materials[1].quantity, 45);
  assert.equal(previewProposal(base, emptyProposal()).materials.length, 1);
  assert.equal(
    previewProposal(
      base,
      normalizeProposal(
        row("update", "existing-cable", {
          material: "Cable",
          quantity: 15,
          unit: "m",
        }),
        base,
      ),
    ).materials[0].quantity,
    15,
  );
  assert.equal(
    previewProposal(
      base,
      normalizeProposal(row("delete", "existing-cable", null), base),
    ).materials.length,
    0,
  );
  assert.equal(base.materials[0].quantity, 12);
});

test("domain validation rejects wrong types, duplicates, invented IDs, and invalid values", () => {
  for (const invalid of [
    field("arrivalTime", "25:00"),
    field("distanceKm", -2),
    field("priority", "critical"),
    field("tags", ["unknown"]),
    field("jobComplete", "yes"),
    field("arrivalTime", "10:00", "clear"),
    row("delete", "new:missing", null),
    row("update", "foreign-id", { material: "Cable", quantity: 4, unit: "m" }),
    row("create", "existing-cable", {
      material: "Cable",
      quantity: 4,
      unit: "m",
    }),
  ]) {
    assert.throws(() => normalizeProposal(invalid, base));
  }
  const duplicate = field("priority", "high");
  duplicate.fieldOps.push({ ...duplicate.fieldOps[0] });
  assert.throws(() => normalizeProposal(duplicate, base));
  const incomplete = normalizeProposal(
    row("create", "new:cable", {
      material: "Cable",
      quantity: null,
      unit: "m",
    }),
    base,
  );
  assert.equal(incomplete.lineOps[0].values.quantity, null);
  assert.ok(incomplete.issues.length);
});

test("tags use final set semantics and preserve unrelated committed tags", () => {
  const tagged = { ...base, tags: ["urgent"] };
  const proposal = normalizeProposal(
    field("tags", ["urgent", "warranty", "follow-up"]),
    tagged,
  );
  assert.deepEqual(previewProposal(tagged, proposal).tags, [
    "follow-up",
    "urgent",
    "warranty",
  ]);
  assert.deepEqual(
    previewProposal(
      tagged,
      normalizeProposal(field("tags", ["urgent", "warranty"]), tagged),
    ).tags,
    ["urgent", "warranty"],
  );
});

test("transcript replaces interim text and ignores replayed finalized ranges", () => {
  const transcript = new Transcript();
  const segment = (text, isFinal = false, start = 0, duration = 2) => ({
    text,
    isFinal,
    start,
    duration,
  });
  transcript.update(segment("Used twelve"));
  transcript.update(segment("Used twelve meters of cable"));
  assert.equal(transcript.text, "Used twelve meters of cable");
  transcript.update(segment("Used twelve meters of cable.", true));
  transcript.update(segment("Used twelve", false));
  transcript.update(segment("Used twelve meters of cable.", true));
  transcript.update(segment("Actually fifteen.", false, 2));
  assert.equal(
    transcript.text,
    "Used twelve meters of cable. Actually fifteen.",
  );
  transcript.update(segment("Actually fifteen.", true, 2));
  assert.equal(transcript.interimText, "");
  assert.equal(
    transcript.finalText,
    "Used twelve meters of cable. Actually fifteen.",
  );
});

test("scheduler coalesces speech while a request runs and drains the newest revision", async () => {
  let release;
  const called = [];
  const published = [];
  const scheduler = new InferenceScheduler(
    async (input) => {
      called.push(input);
      if (input === "first")
        await new Promise((resolve) => {
          release = resolve;
        });
      return input;
    },
    (result, revision) => published.push([result, revision]),
    (error) => {
      throw error;
    },
    0,
  );
  scheduler.request(1, "first");
  await delay(10);
  scheduler.request(2, "obsolete");
  scheduler.request(3, "latest");
  const finishing = scheduler.flush();
  release();
  await finishing;
  assert.deepEqual(called, ["first", "latest"]);
  assert.deepEqual(published, [
    ["first", 1],
    ["latest", 3],
  ]);
  scheduler.close();
});

test("canceled inference never publishes late results", async () => {
  let release;
  let published = false;
  const scheduler = new InferenceScheduler(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    () => {
      published = true;
    },
    () => {},
    0,
  );
  scheduler.request(1, "hello");
  await delay(10);
  scheduler.close();
  release(emptyProposal());
  await delay(10);
  assert.equal(published, false);
});

function fixture(t, { inference, drainError = false, empty = false } = {}) {
  let report;
  let commits = 0;
  const events = [];
  const store = new SessionStore();
  const voice = new VoiceSessionService(
    store,
    {
      get: async () => structuredClone(base),
      commitProposal: async (_owner, _id, _version, proposal) => {
        commits++;
        await delay(5);
        return { ...previewProposal(base, proposal), version: 4 };
      },
    },
    {
      connect: async (_format, onResult) => {
        report = onResult;
        return {
          send() {},
          close() {},
          finish: async () => {
            if (drainError) throw new Error("provider disconnected");
            if (!empty)
              report({
                start: 0,
                duration: 2,
                text: "Arrived at ten.",
                isFinal: true,
              });
          },
        };
      },
    },
    { interpret: inference || (async () => field("arrivalTime", "10:00")) },
    { OPENAI_API_KEY: "mock", DEEPGRAM_API_KEY: "mock" },
  );
  t.after(() => voice.onModuleDestroy());
  return {
    voice,
    store,
    events,
    report: (result) => report(result),
    commits: () => commits,
  };
}
async function connect(f) {
  const created = await f.voice.create("owner", "job");
  const session = f.voice.attach(
    created.sessionId,
    created.ticket,
    (event) => f.events.push(event),
    () => {},
  );
  await f.voice.start(session, {
    sampleRate: 16000,
    channels: 1,
    encoding: "int16",
  });
  return { created, session };
}

test("Finish drains last speech; no early writes; duplicate Finish saves only once", async (t) => {
  const f = fixture(t);
  const { created, session } = await connect(f);
  assert.throws(() =>
    f.voice.attach(
      created.sessionId,
      created.ticket,
      () => {},
      () => {},
    ),
  );
  f.report({
    start: 0,
    duration: 1,
    text: "Arrived at eleven",
    isFinal: false,
  });
  assert.equal(f.commits(), 0);
  await assert.rejects(() => f.voice.finish("owner", session.id, 0));
  await f.voice.stop(session);
  assert.equal(f.commits(), 0);
  assert.equal(session.status, "ready");
  assert.equal(session.transcript.text, "Arrived at ten.");
  await assert.rejects(() =>
    f.voice.finish("other-user", session.id, session.proposalRevision),
  );
  await assert.rejects(() => f.voice.finish("owner", session.id, 999));
  const [a, b] = await Promise.all([
    f.voice.finish("owner", session.id, session.proposalRevision),
    f.voice.finish("owner", session.id, session.proposalRevision),
  ]);
  assert.equal(a.arrivalTime, "10:00");
  assert.deepEqual(a, b);
  await f.voice.finish("owner", session.id, session.proposalRevision);
  assert.equal(f.commits(), 1);
});

test("Cancel, drain failure, and empty microphone never commit", async (t) => {
  for (const options of [{}, { drainError: true }, { empty: true }]) {
    const f = fixture(t, options);
    const { session } = await connect(f);
    if (!options.drainError && !options.empty)
      f.voice.cancel("owner", session.id);
    else await f.voice.stop(session);
    await assert.rejects(() =>
      f.voice.finish("owner", session.id, session.proposalRevision),
    );
    assert.equal(f.commits(), 0);
  }
});

test("incomplete proposals cannot be committed", async (t) => {
  const f = fixture(t, {
    inference: async () =>
      normalizeProposal(
        row("create", "new:cable", {
          material: "Cable",
          quantity: null,
          unit: null,
        }),
        base,
      ),
  });
  const { session } = await connect(f);
  await f.voice.stop(session);
  await assert.rejects(() =>
    f.voice.finish("owner", session.id, session.proposalRevision),
  );
  assert.equal(f.commits(), 0);
});

test("finalizing unchanged words updates the transcript UI without duplicate inference", async (t) => {
  const f = fixture(t);
  const { session } = await connect(f);
  f.report({ start: 0, duration: 2, text: "Arrived at ten.", isFinal: false });
  const revision = session.transcript.revision;
  f.report({ start: 0, duration: 2, text: "Arrived at ten.", isFinal: true });
  const last = f.events.filter((event) => event.type === "transcript").at(-1);
  assert.equal(last.final, "Arrived at ten.");
  assert.equal(last.interim, "");
  assert.equal(last.revision, revision);
});

test("Cancel during drain prevents a late ready event or save", async (t) => {
  const f = fixture(t);
  const { session } = await connect(f);
  let drained;
  session.speech.finish = () =>
    new Promise((resolve) => {
      drained = resolve;
    });
  const stopping = f.voice.stop(session);
  f.voice.cancel("owner", session.id);
  drained();
  await stopping;
  assert.equal(session.status, "canceled");
  assert.equal(
    f.events.some((event) => event.type === "ready"),
    false,
  );
  assert.equal(f.commits(), 0);
});
