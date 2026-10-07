import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  normalizeProposal,
  previewProposal,
  emptyProposal,
  savableProposal,
  reconcileMaterialProposals,
} from "../dist/src/jobs/proposals.js";
import { Transcript } from "../dist/src/voice/transcript.js";
import { InferenceScheduler } from "../dist/src/voice/inference-scheduler.js";
import { VoiceSessionService } from "../dist/src/voice/voice-session.service.js";
import { SessionStore } from "../dist/src/voice/session-store.js";
import { ProposalInterpreter } from "../dist/src/voice/proposal-interpreter.js";

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

test("scheduler waits for a brief pause and coalesces 100ms transcript corrections", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10_000 });
  const called = [];
  const scheduler = new InferenceScheduler(
    async (input) => {
      called.push(input);
      return input;
    },
    () => {},
    () => {},
  );
  t.after(() => scheduler.close());
  scheduler.request(1, "Used twelve");
  t.mock.timers.tick(100);
  scheduler.request(2, "Used twelve meters of cable");
  t.mock.timers.tick(349);
  assert.deepEqual(called, []);
  t.mock.timers.tick(1);
  assert.deepEqual(called, ["Used twelve meters of cable"]);
  await scheduler.flush();
});

test("continuous speech cannot postpone inference indefinitely", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10_000 });
  const called = [];
  const scheduler = new InferenceScheduler(
    async (input) => {
      called.push(input);
      return input;
    },
    () => {},
    () => {},
  );
  t.after(() => scheduler.close());
  scheduler.request(1, "word 1");
  for (let revision = 2; revision <= 10; revision++) {
    t.mock.timers.tick(100);
    scheduler.request(revision, `word ${revision}`);
  }
  assert.deepEqual(called, []);
  t.mock.timers.tick(100);
  assert.deepEqual(called, ["word 10"]);
  await scheduler.flush();
});

test("a superseded failure is silent and Finish processes the newest transcript", async () => {
  let rejectFirst;
  const failures = [];
  const published = [];
  const scheduler = new InferenceScheduler(
    (input) =>
      input === "partial"
        ? new Promise((_resolve, reject) => {
            rejectFirst = reject;
          })
        : Promise.resolve(input),
    (result) => published.push(result),
    (error) => failures.push(error),
    0,
  );
  scheduler.request(1, "partial");
  await delay(10);
  scheduler.request(2, "complete");
  const finishing = scheduler.flush();
  rejectFirst(new Error("incomplete interpretation"));
  await finishing;
  assert.deepEqual(failures, []);
  assert.deepEqual(published, ["complete"]);
  scheduler.close();
});

test("Finish bypasses debounce but still rejects a failed final interpretation", async () => {
  let called = 0;
  const scheduler = new InferenceScheduler(
    async () => {
      called++;
      throw new Error("provider unavailable");
    },
    () => {},
    () => {},
  );
  scheduler.request(1, "final words");
  await assert.rejects(() => scheduler.flush(), /provider unavailable/);
  assert.equal(called, 1);
  scheduler.close();
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

test("incomplete suggestions are skipped instead of blocking the visible preview", async (t) => {
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
  assert.deepEqual(session.proposal, emptyProposal());
  const saved = await f.voice.finish(
    "owner",
    session.id,
    session.proposalRevision,
  );
  assert.deepEqual(saved.materials, base.materials);
  assert.equal(f.commits(), 1);
});

test("unfinished live material details recover before Finish validates them", async (t) => {
  const f = fixture(t, {
    inference: async (_base, _previous, text) =>
      text.includes("ten")
        ? field("arrivalTime", "10:00")
        : normalizeProposal(
            row("create", "new:cable", {
              material: "Cable",
              quantity: null,
              unit: null,
            }),
            base,
          ),
  });
  const { session } = await connect(f);
  f.report({ start: 0, duration: 1, text: "Used cable", isFinal: false });
  await session.scheduler.flush();
  assert.deepEqual(session.proposal, emptyProposal());
  assert.equal(session.status, "listening");
  await f.voice.stop(session);
  assert.equal(session.status, "ready");
  assert.deepEqual(session.proposal.issues, []);
  await f.voice.finish("owner", session.id, session.proposalRevision);
  assert.equal(f.commits(), 1);
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

test("savable previews keep valid fields and skip invalid or incomplete operations", () => {
  const result = savableProposal(
    {
      fieldOps: [
        { op: "set", fieldKey: "distanceKm", value: 0 },
        { op: "clear", fieldKey: "arrivalTime", value: null },
        { op: "set", fieldKey: "priority", value: "invalid" },
      ],
      lineOps: [
        {
          op: "create",
          groupKey: "materials",
          lineId: "new:incomplete",
          values: { material: "Pipe", quantity: null, unit: "m" },
        },
        {
          op: "create",
          groupKey: "materials",
          lineId: "new:screws",
          values: { material: "Screws", quantity: 4, unit: "pcs" },
        },
        {
          op: "delete",
          groupKey: "materials",
          lineId: "foreign",
          values: null,
        },
      ],
      issues: ["Incomplete phrase"],
    },
    base,
  );
  assert.equal(result.fieldOps.length, 2);
  assert.equal(result.lineOps.length, 1);
  assert.equal(result.lineOps[0].lineId, "new:screws");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(normalizeProposal(result, base), result);
});

test("Finish accepts the displayed revision, not newer or still-running inference", async (t) => {
  let completeLate;
  const f = fixture(t, {
    inference: async (_base, _previous, text) => {
      if (text === "pending")
        return new Promise((resolve) => {
          completeLate = resolve;
        });
      return field("arrivalTime", text === "first" ? "11:00" : "12:00");
    },
  });
  const { session } = await connect(f);
  f.report({ start: 0, duration: 1, text: "first", isFinal: false });
  await session.scheduler.flush();
  const displayedRevision = session.proposalRevision;
  f.report({ start: 0, duration: 1, text: "second", isFinal: false });
  await session.scheduler.flush();
  assert.equal(session.proposal.fieldOps[0].value, "12:00");
  f.report({ start: 0, duration: 1, text: "pending", isFinal: false });
  const running = session.scheduler.flush();
  await delay(0);
  await assert.rejects(() => f.voice.stop(session, 999));
  await f.voice.stop(session, displayedRevision);
  completeLate(field("arrivalTime", "13:00"));
  await assert.rejects(() => running, /ended/);
  const saved = await f.voice.finish("owner", session.id, displayedRevision);
  assert.equal(saved.arrivalTime, "11:00");
  assert.equal(session.proposalRevision, displayedRevision);
  await f.voice.finish("owner", session.id, displayedRevision);
  assert.equal(f.commits(), 1);
});

test("Finish with no displayed suggestions saves no guessed changes", async (t) => {
  const f = fixture(t, {
    inference: async () => {
      throw new Error("provider failed");
    },
  });
  const { session } = await connect(f);
  f.report({ start: 0, duration: 1, text: "partial words", isFinal: false });
  await f.voice.stop(session, 0);
  const saved = await f.voice.finish("owner", session.id, 0);
  assert.equal(saved.arrivalTime, base.arrivalTime);
  assert.deepEqual(saved.materials, base.materials);
  assert.equal(
    f.events.some((event) => event.type === "warning"),
    false,
  );
});

test("a cable quantity correction preserves omitted screws and stable row identities", async () => {
  const emptyBase = { ...base, materials: [] };
  const cable = {
    op: "create",
    groupKey: "materials",
    lineId: "new:cable",
    values: { material: "Cable", quantity: 12, unit: "m" },
  };
  const screws = {
    op: "create",
    groupKey: "materials",
    lineId: "new:screws",
    values: { material: "Screws", quantity: 40, unit: "pcs" },
  };
  const outputs = [
    {
      fieldOps: [],
      lineOps: [cable, screws],
      issues: [],
      retractedLineIds: [],
    },
    {
      fieldOps: [],
      lineOps: [{ ...cable, values: { ...cable.values, quantity: 15 } }],
      issues: [],
      retractedLineIds: [],
    },
  ];
  const interpreter = new ProposalInterpreter({
    structured: async (schema, _instructions, input) => {
      if (outputs.length === 1)
        assert.equal(input.previousProposals.lineOps.length, 2);
      return schema.parse(outputs.shift());
    },
  });
  const initial = await interpreter.interpret(
    emptyBase,
    emptyProposal(),
    "I used twelve meters of cable and forty screws.",
    new AbortController().signal,
  );
  const corrected = await interpreter.interpret(
    emptyBase,
    initial,
    "I used twelve meters of cable and forty screws. Change it to fifteen meters.",
    new AbortController().signal,
  );
  assert.deepEqual(
    corrected.lineOps.map((op) => [op.lineId, op.values.quantity]),
    [
      ["new:cable", 15],
      ["new:screws", 40],
    ],
  );
  assert.equal(previewProposal(emptyBase, corrected).materials.length, 2);
  assert.equal(
    initial.lineOps[0].values.quantity,
    12,
    "Previous preview stays immutable",
  );
  const removed = reconcileMaterialProposals(
    { ...emptyProposal(), retractedLineIds: ["new:screws"] },
    corrected,
    emptyBase,
  );
  assert.deepEqual(
    removed.lineOps.map((op) => op.lineId),
    ["new:cable"],
  );
});

test("incomplete material corrections preserve good rows; reverting to saved values retracts only that update", () => {
  const initial = {
    ...emptyProposal(),
    lineOps: [
      {
        op: "update",
        groupKey: "materials",
        lineId: "existing-cable",
        values: { material: "Cable", quantity: 15, unit: "m" },
      },
      {
        op: "create",
        groupKey: "materials",
        lineId: "new:screws",
        values: { material: "Screws", quantity: 40, unit: "pcs" },
      },
    ],
  };
  const incomplete = reconcileMaterialProposals(
    {
      ...emptyProposal(),
      lineOps: [
        {
          ...initial.lineOps[0],
          values: { material: "Cable", quantity: null, unit: "m" },
        },
      ],
      retractedLineIds: [],
    },
    initial,
    base,
  );
  assert.deepEqual(incomplete, initial);
  const restored = reconcileMaterialProposals(
    {
      ...emptyProposal(),
      lineOps: [
        {
          ...initial.lineOps[0],
          values: { material: "Cable", quantity: 12, unit: "m" },
        },
      ],
      retractedLineIds: [],
    },
    initial,
    base,
  );
  assert.deepEqual(
    restored.lineOps.map((op) => op.lineId),
    ["new:screws"],
  );
  const retracted = reconcileMaterialProposals(
    { ...emptyProposal(), retractedLineIds: ["existing-cable"] },
    initial,
    base,
  );
  assert.deepEqual(retracted, restored);
});

test("corrected cable and untouched screws survive preview acceptance and Finish", async (t) => {
  const interpreter = new ProposalInterpreter({
    structured: async (schema, _instructions, input) =>
      schema.parse({
        fieldOps: [],
        issues: [],
        retractedLineIds: [],
        lineOps: input.transcript.includes("fifteen")
          ? [
              {
                op: "update",
                groupKey: "materials",
                lineId: "existing-cable",
                values: { material: "Cable", quantity: 15, unit: "m" },
              },
            ]
          : [
              {
                op: "create",
                groupKey: "materials",
                lineId: "new:screws",
                values: { material: "Screws", quantity: 40, unit: "pcs" },
              },
            ],
      }),
  });
  const f = fixture(t, {
    inference: (...args) => interpreter.interpret(...args),
  });
  const { session } = await connect(f);
  f.report({
    start: 0,
    duration: 2,
    text: "I used twelve meters of cable and forty screws.",
    isFinal: true,
  });
  await session.scheduler.flush();
  f.report({
    start: 2,
    duration: 1,
    text: "Change it to fifteen meters.",
    isFinal: false,
  });
  await session.scheduler.flush();
  const revision = session.proposalRevision;
  await f.voice.stop(session, revision);
  const saved = await f.voice.finish("owner", session.id, revision);
  assert.deepEqual(
    saved.materials.map((row) => [row.material, row.quantity, row.unit]),
    [
      ["Cable", 15, "m"],
      ["Screws", 40, "pcs"],
    ],
  );
});
