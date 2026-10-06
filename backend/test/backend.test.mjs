import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import "dotenv/config";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import WebSocket from "ws";

test("authentication and owned job persistence through the HTTP API", async (t) => {
  const connectionString =
    process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(
    connectionString,
    "Set TEST_DATABASE_URL or DATABASE_URL to a PostgreSQL database",
  );
  const schema = `formcast_test_${randomBytes(12).toString("hex")}`;
  const testUrl = new URL(connectionString);
  testUrl.searchParams.set("schema", schema);
  const admin = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
  });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  Object.assign(process.env, {
    NODE_ENV: "test",
    CHECKPOINT_DISABLE: "1",
    DATABASE_URL: testUrl.toString(),
    DIRECT_URL: testUrl.toString(),
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    TRUSTED_ORIGINS: "http://localhost:8081,formcast://",
    DEMO_EMAIL: "demo@formcast.local",
    DEMO_PASSWORD: randomBytes(24).toString("hex"),
    OPENAI_API_KEY: "mock-test-key",
    DEEPGRAM_API_KEY: "mock-test-key",
  });
  let app;
  try {
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { env: process.env, timeout: 60_000 },
    );
    const { createApp } = await import("../dist/src/app.js");
    const { PrismaService } =
      await import("../dist/src/database/prisma.service.js");
    let delayNextTransaction = false;
    const connect = PrismaPg.prototype.connect;
    t.mock.method(PrismaPg.prototype, "connect", async function (...args) {
      const adapter = await connect.apply(this, args);
      const startTransaction = adapter.startTransaction.bind(adapter);
      adapter.startTransaction = async (...transactionArgs) => {
        if (delayNextTransaction) {
          delayNextTransaction = false;
          // Simulate acquisition taking longer than Prisma's old 2-second limit.
          await delay(2500);
        }
        return startTransaction(...transactionArgs);
      };
      return adapter;
    });
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const prisma = app.get(PrismaService);
    const request = (path, cookie, body, method = body ? "POST" : "GET") =>
      fetch(`${base}/api${path}`, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body
            ? {
                "Content-Type": "application/json",
                Origin: "http://localhost:8081",
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    let cookie;
    let jobId;

    await t.test(
      "health is public and jobs require a valid session",
      async () => {
        assert.equal((await request("/health")).status, 200);
        assert.equal((await request("/jobs")).status, 401);
        assert.equal(
          (await request("/me", "better-auth.session_token=invalid")).status,
          401,
        );
      },
    );
    await t.test(
      "seed is repeatable and does not overwrite committed values",
      async () => {
        const seed = () =>
          execFileSync(process.execPath, ["dist/prisma/seed.js"], {
            env: process.env,
            timeout: 30_000,
          });
        seed();
        const job = await prisma.job.findFirstOrThrow({
          where: { title: { contains: "cable installation" } },
        });
        jobId = job.id;
        await prisma.job.update({
          where: { id: jobId },
          data: { generalRemarks: "Keep this value" },
        });
        seed();
        assert.equal(await prisma.job.count(), 3);
        assert.equal(
          (await prisma.job.findUniqueOrThrow({ where: { id: jobId } }))
            .generalRemarks,
          "Keep this value",
        );
      },
    );
    await t.test("login issues a working session cookie", async () => {
      const response = await request("/auth/sign-in/email", null, {
        email: process.env.DEMO_EMAIL,
        password: process.env.DEMO_PASSWORD,
      });
      assert.equal(response.status, 200, await response.text());
      cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      assert.ok(cookie.includes("session_token="));
      assert.equal((await request("/me", cookie)).status, 200);
      assert.equal((await request("/jobs", cookie)).status, 200);
      const job = await (await request(`/jobs/${jobId}`, cookie)).json();
      assert.equal(job.generalRemarks, "Keep this value");
      assert.deepEqual(job.tags, []);
      assert.deepEqual(job.materials, []);
      const schema = await (await request("/jobs/schema", cookie)).json();
      assert.equal(schema.fields.length, 6);
    });
    await t.test("another user cannot read the demo job", async () => {
      const response = await request("/auth/sign-up/email", null, {
        name: "Other Technician",
        email: "other@example.com",
        password: randomBytes(24).toString("hex"),
      });
      assert.equal(response.status, 200, await response.text());
      const otherCookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      assert.deepEqual(await (await request("/jobs", otherCookie)).json(), []);
      assert.equal((await request(`/jobs/${jobId}`, otherCookie)).status, 404);
      assert.equal(
        (
          await request(
            `/jobs/${jobId}`,
            otherCookie,
            { title: "Stolen" },
            "PATCH",
          )
        ).status,
        404,
      );
      assert.equal(
        (await request(`/jobs/${jobId}`, otherCookie, undefined, "DELETE"))
          .status,
        404,
      );
    });
    await t.test(
      "jobs support validated, owned CRUD and cascade deletion",
      async () => {
        assert.equal(
          (await request("/jobs", null, { title: "Unauthorized" })).status,
          401,
        );
        for (const body of [
          { title: " " },
          { title: "x", priority: "critical" },
          { title: "x", ownerId: "someone" },
          { title: "x", jobComplete: "yes" },
        ]) {
          assert.equal((await request("/jobs", cookie, body)).status, 400);
        }
        const created = await request("/jobs", cookie, {
          title: "  New installation  ",
          generalRemarks: "Inspect first",
          priority: "medium",
          jobComplete: false,
        });
        assert.equal(created.status, 201);
        const job = await created.json();
        assert.equal(job.title, "New installation");
        assert.ok(
          (await (await request("/jobs", cookie)).json()).some(
            (item) => item.id === job.id,
          ),
        );
        const material = await prisma.material.create({
          data: { jobId: job.id, material: "Cable", quantity: 2, unit: "m" },
        });
        const updated = await request(
          `/jobs/${job.id}`,
          cookie,
          {
            title: "Finished installation",
            generalRemarks: null,
            priority: null,
            jobComplete: true,
          },
          "PATCH",
        );
        assert.equal(updated.status, 200);
        const saved = await (await request(`/jobs/${job.id}`, cookie)).json();
        assert.equal(saved.title, "Finished installation");
        assert.equal(saved.jobComplete, true);
        assert.equal(saved.generalRemarks, null);
        assert.equal(saved.priority, null);
        assert.equal(saved.version, 1);
        assert.equal(saved.materials[0].id, material.id);
        assert.equal(
          (await request(`/jobs/${job.id}`, cookie, {}, "PATCH")).status,
          400,
        );
        const rejected = await fetch(`${base}/api/jobs/${job.id}`, {
          method: "DELETE",
          headers: { Cookie: cookie, Origin: "https://untrusted.example" },
        });
        assert.equal(rejected.status, 403);
        assert.equal(
          (await request(`/jobs/${job.id}`, cookie, undefined, "DELETE"))
            .status,
          204,
        );
        assert.equal((await request(`/jobs/${job.id}`, cookie)).status, 404);
        assert.equal(
          await prisma.material.count({ where: { jobId: job.id } }),
          0,
        );
        assert.equal(
          (await request(`/jobs/${job.id}`, cookie, undefined, "DELETE"))
            .status,
          404,
        );
      },
    );
    await t.test(
      "signup survives slow transaction acquisition and persists a complete account",
      async () => {
        delayNextTransaction = true;
        const response = await request("/auth/sign-up/email", null, {
          name: "Slow Connection",
          email: "slow@example.com",
          password: randomBytes(24).toString("hex"),
        });
        assert.equal(response.status, 200, await response.text());
        assert.equal(
          delayNextTransaction,
          false,
          "Auth must acquire a real transaction",
        );
        const slowCookie = response.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        assert.equal((await request("/me", slowCookie)).status, 200);
        const user = await prisma.user.findUniqueOrThrow({
          where: { email: "slow@example.com" },
        });
        assert.equal(
          await prisma.account.count({ where: { userId: user.id } }),
          1,
        );
      },
    );
    await t.test(
      "voice WebSocket previews, authenticated Finish, Cancel and version conflicts",
      async (t) => {
        const { DeepgramService } =
          await import("../dist/src/ai/deepgram.service.js");
        const { ProposalInterpreter } =
          await import("../dist/src/voice/proposal-interpreter.js");
        let report;
        let receivedAudio = 0;
        t.mock.method(
          app.get(DeepgramService),
          "connect",
          async (format, onResult) => {
            assert.equal(format.encoding, "int16");
            assert.equal(format.sampleRate, 16000);
            report = onResult;
            return {
              send(buffer) {
                receivedAudio += buffer.length;
              },
              close() {},
              async finish() {
                onResult({
                  start: 0,
                  duration: 2,
                  text: "Arrived at ten and used fifteen meters of cable.",
                  isFinal: true,
                });
              },
            };
          },
        );
        t.mock.method(
          app.get(ProposalInterpreter),
          "interpret",
          async (_base, _previous, transcript) => ({
            fieldOps: [
              {
                op: "set",
                fieldKey: "arrivalTime",
                value: transcript.includes("ten") ? "10:00" : "11:00",
              },
            ],
            lineOps: [
              {
                op: "create",
                groupKey: "materials",
                lineId: "new:cable",
                values: { material: "Cable", quantity: 15, unit: "m" },
              },
            ],
            issues: [],
          }),
        );
        const createdJob = await (
          await request("/jobs", cookie, { title: "Voice test" })
        ).json();
        const makeSession = async () => {
          const response = await request(
            `/jobs/${createdJob.id}/voice-sessions`,
            cookie,
            {},
          );
          assert.equal(response.status, 201, await response.clone().text());
          const session = await response.json();
          const ws = new WebSocket(`${base.replace("http", "ws")}/api/voice`, {
            headers: { Origin: "formcast://" },
          });
          t.after(() => ws.terminate());
          const events = [];
          ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
          const wait = async (type) => {
            const deadline = Date.now() + 6000;
            while (!events.some((event) => event.type === type)) {
              assert.ok(
                Date.now() < deadline,
                `Timed out waiting for ${type}: ${JSON.stringify(events)}`,
              );
              await delay(10);
            }
            return events.find((event) => event.type === type);
          };
          await new Promise((resolve, reject) => {
            ws.once("open", resolve);
            ws.once("error", reject);
          });
          ws.send(
            JSON.stringify({
              type: "connect",
              sessionId: session.sessionId,
              ticket: session.ticket,
            }),
          );
          await wait("connected");
          ws.send(
            JSON.stringify({
              type: "audio.start",
              encoding: "int16",
              sampleRate: 16000,
              channels: 1,
            }),
          );
          await wait("listening");
          return { ...session, ws, wait };
        };
        assert.equal(
          (await request(`/jobs/${createdJob.id}/voice-sessions`, null, {}))
            .status,
          401,
        );
        assert.equal(
          (await request("/jobs/unknown/voice-sessions", cookie, {})).status,
          404,
        );
        const untrusted = new WebSocket(
          `${base.replace("http", "ws")}/api/voice`,
          { headers: { Origin: "https://untrusted.example" } },
        );
        const untrustedCode = await new Promise((resolve) =>
          untrusted.once("close", resolve),
        );
        assert.equal(untrustedCode, 1008);
        const first = await makeSession();
        assert.equal(
          (await request(`/jobs/${createdJob.id}/voice-sessions`, cookie, {}))
            .status,
          409,
        );
        first.ws.send(Buffer.alloc(3200));
        report({
          start: 0,
          duration: 1,
          text: "Arrived at eleven",
          isFinal: false,
        });
        const preview = await first.wait("proposals");
        assert.equal(preview.proposal.fieldOps[0].value, "11:00");
        assert.equal(
          (
            await request(`/voice-sessions/${first.sessionId}/finish`, cookie, {
              revision: preview.revision,
            })
          ).status,
          409,
        );
        const before = await prisma.job.findUniqueOrThrow({
          where: { id: createdJob.id },
          include: { materials: true },
        });
        assert.equal(before.arrivalTime, null);
        assert.equal(before.materials.length, 0);
        first.ws.send(JSON.stringify({ type: "stop" }));
        const ready = await first.wait("ready");
        assert.equal(ready.proposal.fieldOps[0].value, "10:00");
        assert.equal(receivedAudio, 3200);
        assert.equal(
          (
            await request(`/voice-sessions/${first.sessionId}/finish`, null, {
              revision: ready.revision,
            })
          ).status,
          401,
        );
        const finishes = await Promise.all(
          [0, 1].map(() =>
            request(`/voice-sessions/${first.sessionId}/finish`, cookie, {
              revision: ready.revision,
            }),
          ),
        );
        for (const response of finishes)
          assert.equal(response.status, 201, await response.clone().text());
        const saved = await finishes[0].json();
        assert.equal(saved.arrivalTime, "10:00");
        assert.equal(saved.materials.length, 1);
        assert.equal(saved.version, 1);
        first.ws.close();

        const canceled = await makeSession();
        canceled.ws.send(JSON.stringify({ type: "cancel" }));
        await canceled.wait("canceled");
        assert.equal(
          (
            await request(
              `/voice-sessions/${canceled.sessionId}/finish`,
              cookie,
              { revision: 0 },
            )
          ).status,
          409,
        );
        assert.equal(
          await prisma.material.count({ where: { jobId: saved.id } }),
          1,
        );

        const conflict = await makeSession();
        conflict.ws.send(JSON.stringify({ type: "stop" }));
        const conflictReady = await conflict.wait("ready");
        await request(
          `/jobs/${saved.id}`,
          cookie,
          { title: "Edited elsewhere" },
          "PATCH",
        );
        assert.equal(
          (
            await request(
              `/voice-sessions/${conflict.sessionId}/finish`,
              cookie,
              { revision: conflictReady.revision },
            )
          ).status,
          409,
        );
        assert.equal(
          await prisma.material.count({ where: { jobId: saved.id } }),
          1,
        );
        assert.equal(
          (
            await request(
              `/voice-sessions/${conflict.sessionId}/cancel`,
              cookie,
              {},
            )
          ).status,
          201,
        );

        // Exercise the real persistence boundary for existing rows and scalar clears.
        const { JobsService } =
          await import("../dist/src/jobs/jobs.service.js");
        const jobs = app.get(JobsService);
        const latest = await prisma.job.findUniqueOrThrow({
          where: { id: saved.id },
          include: { materials: true },
        });
        const screw = await prisma.material.create({
          data: {
            jobId: saved.id,
            material: "Screws",
            quantity: 40,
            unit: "pcs",
          },
        });
        const committed = await jobs.commitProposal(
          latest.ownerId,
          saved.id,
          latest.version,
          {
            fieldOps: [
              { op: "clear", fieldKey: "arrivalTime", value: null },
              { op: "set", fieldKey: "distanceKm", value: 0 },
              { op: "set", fieldKey: "jobComplete", value: false },
              { op: "set", fieldKey: "tags", value: ["warranty"] },
            ],
            lineOps: [
              {
                op: "update",
                groupKey: "materials",
                lineId: latest.materials[0].id,
                values: { material: "Cable", quantity: 20, unit: "m" },
              },
              {
                op: "delete",
                groupKey: "materials",
                lineId: screw.id,
                values: null,
              },
            ],
            issues: [],
          },
        );
        assert.equal(committed.arrivalTime, null);
        assert.equal(committed.distanceKm, 0);
        assert.equal(committed.jobComplete, false);
        assert.deepEqual(committed.tags, ["warranty"]);
        assert.equal(committed.materials.length, 1);
        assert.equal(committed.materials[0].id, latest.materials[0].id);
        assert.equal(committed.materials[0].quantity, 20);
        await assert.rejects(() =>
          jobs.commitProposal(latest.ownerId, saved.id, committed.version, {
            fieldOps: [{ op: "set", fieldKey: "priority", value: "high" }],
            lineOps: [
              {
                op: "delete",
                groupKey: "materials",
                lineId: "foreign-row",
                values: null,
              },
            ],
            issues: [],
          }),
        );
        assert.equal(
          (await prisma.job.findUniqueOrThrow({ where: { id: saved.id } }))
            .priority,
          null,
        );
      },
    );
    await t.test(
      "invalid passwords and untrusted origins are rejected",
      async () => {
        assert.equal(
          (
            await request("/auth/sign-in/email", null, {
              email: process.env.DEMO_EMAIL,
              password: "wrong-password",
            })
          ).status,
          401,
        );
        const rejected = await fetch(`${base}/api/auth/sign-up/email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://untrusted.example",
          },
          body: JSON.stringify({
            name: "Blocked",
            email: "blocked@example.com",
            password: "long-enough-password",
          }),
        });
        assert.equal(rejected.status, 403);
      },
    );
    await t.test("logout revokes the session", async () => {
      assert.equal((await request("/auth/sign-out", cookie, {})).status, 200);
      assert.equal((await request("/me", cookie)).status, 401);
    });
  } finally {
    await app?.close();
    try {
      assert.match(schema, /^formcast_test_[a-f0-9]{24}$/);
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.end();
    }
  }
});
