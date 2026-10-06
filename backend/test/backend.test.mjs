import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaPg } from '@prisma/adapter-pg';

test('authentication and owned job persistence through the HTTP API', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  assert.ok(connectionString, 'Set TEST_DATABASE_URL or DATABASE_URL to a PostgreSQL database');
  const schema = `formcast_test_${randomBytes(12).toString('hex')}`;
  const testUrl = new URL(connectionString);
  testUrl.searchParams.set('schema', schema);
  const admin = new pg.Client({ connectionString, connectionTimeoutMillis: 15_000 });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  Object.assign(process.env, {
    NODE_ENV: 'test',
    CHECKPOINT_DISABLE: '1',
    DATABASE_URL: testUrl.toString(),
    DIRECT_URL: testUrl.toString(),
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    TRUSTED_ORIGINS: 'http://localhost:8081,formcast://',
    DEMO_EMAIL: 'demo@formcast.local',
    DEMO_PASSWORD: randomBytes(24).toString('hex'),
  });
  let app;
  try {
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, timeout: 60_000 });
    const { createApp } = await import('../dist/src/app.js');
    const { PrismaService } = await import('../dist/src/database/prisma.service.js');
    let delayNextTransaction = false;
    const connect = PrismaPg.prototype.connect;
    t.mock.method(PrismaPg.prototype, 'connect', async function (...args) {
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
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const prisma = app.get(PrismaService);
    const request = (path, cookie, body) => fetch(`${base}/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json', Origin: 'http://localhost:8081' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let cookie;
    let jobId;

    await t.test('health is public and jobs require a valid session', async () => {
      assert.equal((await request('/health')).status, 200);
      assert.equal((await request('/jobs')).status, 401);
      assert.equal((await request('/me', 'better-auth.session_token=invalid')).status, 401);
    });
    await t.test('seed is repeatable and does not overwrite committed values', async () => {
      const seed = () => execFileSync(process.execPath, ['dist/prisma/seed.js'], { env: process.env, timeout: 30_000 });
      seed();
      const job = await prisma.job.findFirstOrThrow();
      jobId = job.id;
      await prisma.job.update({ where: { id: jobId }, data: { generalRemarks: 'Keep this value' } });
      seed();
      assert.equal(await prisma.job.count(), 1);
      assert.equal((await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).generalRemarks, 'Keep this value');
    });
    await t.test('login issues a working session cookie', async () => {
      const response = await request('/auth/sign-in/email', null, { email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD });
      assert.equal(response.status, 200, await response.text());
      cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
      assert.ok(cookie.includes('session_token='));
      assert.equal((await request('/me', cookie)).status, 200);
      assert.equal((await request('/jobs', cookie)).status, 200);
      const job = await (await request(`/jobs/${jobId}`, cookie)).json();
      assert.equal(job.generalRemarks, 'Keep this value');
      assert.deepEqual(job.tags, []);
      assert.deepEqual(job.materials, []);
      const schema = await (await request('/jobs/schema', cookie)).json();
      assert.equal(schema.fields.length, 6);
    });
    await t.test('another user cannot read the demo job', async () => {
      const response = await request('/auth/sign-up/email', null, {
        name: 'Other Technician', email: 'other@example.com', password: randomBytes(24).toString('hex'),
      });
      assert.equal(response.status, 200, await response.text());
      const otherCookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
      assert.deepEqual(await (await request('/jobs', otherCookie)).json(), []);
      assert.equal((await request(`/jobs/${jobId}`, otherCookie)).status, 404);
    });
    await t.test('signup survives slow transaction acquisition and persists a complete account', async () => {
      delayNextTransaction = true;
      const response = await request('/auth/sign-up/email', null, {
        name: 'Slow Connection', email: 'slow@example.com', password: randomBytes(24).toString('hex'),
      });
      assert.equal(response.status, 200, await response.text());
      assert.equal(delayNextTransaction, false, 'Auth must acquire a real transaction');
      const slowCookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
      assert.equal((await request('/me', slowCookie)).status, 200);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'slow@example.com' } });
      assert.equal(await prisma.account.count({ where: { userId: user.id } }), 1);
    });
    await t.test('invalid passwords and untrusted origins are rejected', async () => {
      assert.equal((await request('/auth/sign-in/email', null, { email: process.env.DEMO_EMAIL, password: 'wrong-password' })).status, 401);
      const rejected = await fetch(`${base}/api/auth/sign-up/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
        body: JSON.stringify({ name: 'Blocked', email: 'blocked@example.com', password: 'long-enough-password' }),
      });
      assert.equal(rejected.status, 403);
    });
    await t.test('logout revokes the session', async () => {
      assert.equal((await request('/auth/sign-out', cookie, {})).status, 200);
      assert.equal((await request('/me', cookie)).status, 401);
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
