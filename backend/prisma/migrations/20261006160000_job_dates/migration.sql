ALTER TABLE "Job" ADD COLUMN "scheduledAt" DATE,
                  ADD COLUMN "jobCompletedAt" TIMESTAMP(3);

-- The previous boolean did not capture completion time. Preserve completed
-- status using the last known update as the best available historical date.
UPDATE "Job" SET "jobCompletedAt" = "updatedAt" WHERE "jobComplete" = true;
ALTER TABLE "Job" DROP COLUMN "jobComplete";
