import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import { ResponseError } from "@kibocommerce/rest-sdk/client-runtime";
import {
  HeadlessAppApi,
} from "@kibocommerce/rest-sdk/clients/AppDevelopment";

dotenv.config();

// ── Pino logger (console + file) ──────────────────────────────────────────────
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/get-kibo-build-logs.log",
        mkdir: true,
      },
    },
    {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    },
  ],
});

const logger = pino(
  { level: process.env.LOG_LEVEL || "info" },
  transport,
);

// ── SDK configuration ─────────────────────────────────────────────────────────
const configuration = new Configuration({
  tenantId: process.env.TENANT_ID || "",
  siteId: process.env.SITE_ID || "",
  catalog: process.env.CATALOG || "",
  masterCatalog: process.env.MASTER_CATALOG || "",
  sharedSecret: process.env.SHARED_SECRET || "",
  clientId: process.env.CLIENT_ID || "",
  pciHost: process.env.PCI_HOST || "",
  authHost: process.env.AUTH_HOST || "",
  apiEnv: process.env.API_ENV || "",
});

// ── Main flow ─────────────────────────────────────────────────────────────────
async function main() {
  const branchName = "develop";
  logger.info({ branchName }, "=== Kibo Build Logs — starting ===");

  const headlessAppClient = new HeadlessAppApi(configuration);

  try {
    // ── Step 1: Get build jobs for the branch ───────────────────────────────
    // The SDK Configuration handles JWT auth automatically via clientId/sharedSecret
    logger.info({ branchName }, "Step 1 — Fetching build jobs...");
    const buildJobsResponse = await headlessAppClient.getApplicationBuildJobs(
      { branchName, maxResults: 100 },
    );

    const jobs = buildJobsResponse?.jobs ?? [];
    logger.info(
      {
        totalJobs: jobs.length,
        nextToken: buildJobsResponse?.nextToken ?? null,
      },
      "Build jobs retrieved",
    );

    if (jobs.length === 0) {
      logger.warn({ branchName }, "No build jobs found for this branch");
      return;
    }

    // Log summary of every job
    jobs.forEach((job, idx) => {
      logger.info(
        {
          index: idx + 1,
          jobId: job.jobId,
          status: job.status,
          commitId: job.commitId,
          commitTime: job.commitTime,
          startTime: job.startTime,
          endTime: job.endTime,
        },
        `Build job #${idx + 1}`,
      );
    });

    // ── Step 2: Fetch detailed build log for each job ───────────────────────
    logger.info("Step 2 — Fetching build logs for each job...");
    for (const job of jobs) {
      if (!job.jobId) {
        logger.warn({ job }, "Skipping job with no jobId");
        continue;
      }

      logger.info({ branchName, jobId: job.jobId }, "Fetching build log...");
      const buildLog = await headlessAppClient.getApplicationBuildLog(
        { branchName, jobId: job.jobId },
      );

      const steps = buildLog?.steps ?? [];
      logger.info(
        { jobId: buildLog?.jobId, totalSteps: steps.length },
        "Build log retrieved",
      );

      steps.forEach((step, sIdx) => {
        logger.info(
          {
            stepIndex: sIdx + 1,
            stepName: step.stepName,
            status: step.status,
            logUrl: step.logUrl,
            startTime: step.startTime,
            endTime: step.endTime,
          },
          `  Step #${sIdx + 1} — ${step.stepName}`,
        );
      });
    }

    logger.info("=== Kibo Build Logs — complete ===");
  } catch (error) {
    if (error instanceof ResponseError) {
      logger.error(
        {
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.response?.url,
          correlationId: error.response?.correlationId,
          apiError: error.apiError,
        },
        "Kibo API error",
      );
    } else {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        "Unexpected error",
      );
    }
    process.exit(1);
  }
}

main();
