import "reflect-metadata";
import { readConfig } from "../src/config.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { createAuth } from "../src/auth/auth.js";

const config = readConfig();
if (config.NODE_ENV === "production")
  throw new Error("Demo seeding is disabled in production");
const prisma = new PrismaService(config);
try {
  const email = (
    process.env.DEMO_EMAIL ?? "mateogheeraert04@gmail.com"
  ).toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const password = process.env.DEMO_PASSWORD;
    if (!password || password.length < 12)
      throw new Error("Set DEMO_PASSWORD to at least 12 characters");
    const result = await createAuth(prisma, config).api.signUpEmail({
      body: { email, password, name: "Mateo Gheeeraert" },
    });
    user = await prisma.user.findUniqueOrThrow({
      where: { id: result.user.id },
    });
  }
  await prisma.job.upsert({
    where: { id: `demo-job-${user.id}` },
    create: {
      id: `demo-job-${user.id}`,
      title: "Demo job — cable installation",
      ownerId: user.id,
    },
    update: {},
  });
  for (const job of [
    {
      key: "inspection",
      title: "Boiler inspection",
      priority: "high" as const,
      generalRemarks: "Check the pressure and inspect the connections.",
      scheduledAt: new Date("2026-10-07T00:00:00.000Z"),
      jobCompletedAt: null,
    },
    {
      key: "maintenance",
      title: "Ventilation maintenance",
      priority: "low" as const,
      generalRemarks: "Filters replaced and airflow checked.",
      scheduledAt: new Date("2026-10-05T00:00:00.000Z"),
      jobCompletedAt: new Date("2026-10-05T14:30:00.000Z"),
    },
  ]) {
    const { key, ...data } = job;
    await prisma.job.upsert({
      where: { id: `demo-${key}-${user.id}` },
      create: { id: `demo-${key}-${user.id}`, ownerId: user.id, ...data },
      update: {},
    });
  }
  console.log(
    "Demo user and three jobs are ready. Existing job values were preserved.",
  );
} finally {
  await prisma.$disconnect();
}
