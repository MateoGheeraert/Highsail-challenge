import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
      "date migration preserves legacy completion status",
      async () => {
        await admin.query("BEGIN");
        try {
          await admin.query(
            'CREATE TEMP TABLE "Job" (id text, "updatedAt" timestamp(3), "jobComplete" boolean) ON COMMIT DROP',
          );
          await admin.query(
            `INSERT INTO "Job" VALUES ('done', '2026-10-05 14:30:00', true), ('todo', '2026-10-05 14:30:00', false), ('unset', '2026-10-05 14:30:00', null)`,
          );
          await admin.query(
            readFileSync(
              new URL(
                "../prisma/migrations/20261006160000_job_dates/migration.sql",
                import.meta.url,
              ),
              "utf8",
            ),
          );
          const result = await admin.query(
            'SELECT id, "jobCompletedAt"::text AS completed, "scheduledAt" FROM "Job" ORDER BY id',
          );
          assert.deepEqual(
            result.rows.map((row) => [row.id, row.completed, row.scheduledAt]),
            [
              ["done", "2026-10-05 14:30:00", null],
              ["todo", null, null],
              ["unset", null, null],
            ],
          );
        } finally {
          await admin.query("ROLLBACK");
        }
      },
    );

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
      assert.equal(schema.fields.length, 5);
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
          { title: "x", jobComplete: true },
          { title: "x", jobCompletedAt: true },
          { title: "x", jobCompletedAt: "2026-02-30T10:00:00Z" },
          { title: "x", jobCompletedAt: "2026-10-06" },
          { title: "x", scheduledAt: "2026-02-30" },
        ]) {
          assert.equal((await request("/jobs", cookie, body)).status, 400);
        }
        const created = await request("/jobs", cookie, {
          title: "  New installation  ",
          generalRemarks: "Inspect first",
          priority: "medium",
          jobCompletedAt: null,
          scheduledAt: "2026-10-07",
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
            jobCompletedAt: "2026-10-06T14:30:00+02:00",
          },
          "PATCH",
        );
        assert.equal(updated.status, 200);
        const saved = await (await request(`/jobs/${job.id}`, cookie)).json();
        assert.equal(saved.title, "Finished installation");
        assert.equal(saved.jobCompletedAt, "2026-10-06T12:30:00.000Z");
        assert.equal(saved.scheduledAt, "2026-10-07T00:00:00.000Z");
        assert.equal(saved.generalRemarks, null);
        assert.equal(saved.priority, null);
        assert.equal(saved.version, 1);
        assert.equal(saved.materials[0].id, material.id);
        const reopened = await request(
          `/jobs/${job.id}`,
          cookie,
          { jobCompletedAt: null, scheduledAt: null },
          "PATCH",
        );
        assert.equal(reopened.status, 200);
        const cleared = await reopened.json();
        assert.equal(cleared.jobCompletedAt, null);
        assert.equal(cleared.scheduledAt, null);
        const listed = (await (await request("/jobs", cookie)).json()).find(
          (item) => item.id === job.id,
        );
        assert.equal(listed.jobCompletedAt, null);
        assert.equal(listed.scheduledAt, null);
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
      "manual materials create, edit, remove and enforce row ownership atomically",
      async () => {
        const created = await request("/jobs", cookie, {
          title: "Manual materials",
          materials: [{ material: "Cable", quantity: 12.5, unit: "m" }],
        });
        assert.equal(created.status, 201);
        const job = await created.json();
        const original = job.materials[0];
        assert.equal(original.quantity, 12.5);
        const path = "/jobs/" + job.id;
        const updated = await request(
          path,
          cookie,
          {
            materials: [
              { id: original.id, material: "Cable", quantity: 15, unit: "m" },
              { material: "Screws", quantity: 40, unit: "pcs" },
            ],
          },
          "PATCH",
        );
        assert.equal(updated.status, 200);
        const saved = await updated.json();
        assert.equal(saved.materials[0].id, original.id);
        assert.equal(saved.materials[0].quantity, 15);
        assert.equal(saved.materials[1].material, "Screws");
        const omitted = await (
          await request(path, cookie, { title: "Renamed" }, "PATCH")
        ).json();
        assert.equal(omitted.materials.length, 2);
        const foreignJob = await (
          await request("/jobs", cookie, {
            title: "Other job",
            materials: [{ material: "Pipe", quantity: 1, unit: "m" }],
          })
        ).json();
        for (const materials of [
          [
            {
              id: foreignJob.materials[0].id,
              material: "Pipe",
              quantity: 1,
              unit: "m",
            },
          ],
          [
            { id: original.id, material: "Cable", quantity: 1, unit: "m" },
            { id: original.id, material: "Cable", quantity: 2, unit: "m" },
          ],
          [{ material: "", quantity: 1, unit: "pcs" }],
          [{ material: "Cable", quantity: -1, unit: "m" }],
          [{ material: "Cable", quantity: 1, unit: "kg" }],
        ]) {
          assert.equal(
            (
              await request(
                path,
                cookie,
                { title: "Must roll back", materials },
                "PATCH",
              )
            ).status,
            400,
          );
        }
        const unchanged = await (await request(path, cookie)).json();
        assert.equal(unchanged.title, "Renamed");
        assert.equal(unchanged.version, omitted.version);
        assert.equal(unchanged.materials.length, 2);
        const removed = await (
          await request(
            path,
            cookie,
            {
              materials: [
                { id: original.id, material: "Cable", quantity: 0, unit: "m" },
              ],
            },
            "PATCH",
          )
        ).json();
        assert.equal(removed.materials.length, 1);
        assert.equal(removed.materials[0].id, original.id);
        assert.equal(removed.materials[0].quantity, 0);
        const cleared = await (
          await request(path, cookie, { materials: [] }, "PATCH")
        ).json();
        assert.deepEqual(cleared.materials, []);
        await request(path, cookie, undefined, "DELETE");
        await request("/jobs/" + foreignJob.id, cookie, undefined, "DELETE");
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
        first.ws.send(
          JSON.stringify({ type: "stop", revision: preview.revision }),
        );
        const ready = await first.wait("ready");
        assert.equal(ready.proposal.fieldOps[0].value, "11:00");
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
        assert.equal(saved.arrivalTime, "11:00");
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
        assert.equal(committed.jobCompletedAt, null);
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
