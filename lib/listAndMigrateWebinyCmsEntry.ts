import * as dotenv from "dotenv";
import pino from "pino";
import {
  Webiny,
  type CmsEntryData,
  type CreateCmsEntryData,
} from "@webiny/sdk";
import type { Result } from "@webiny/sdk";
import type {
  HttpError,
  ApiError,
  NetworkError,
  ValidationError,
} from "@webiny/sdk";

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/list-and-migrate-webiny-cms-entry.log",
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
  {
    level: process.env.LOG_LEVEL || "info",
  },
  transport,
);

dotenv.config();

// Source tenant config (falls back to the shared WEBINY_* vars)
const sourceEndpoint =
  process.env.WEBINY_SOURCE_API_URL || process.env.WEBINY_API_URL || "";
const sourceToken =
  process.env.WEBINY_SOURCE_API_TOKEN || process.env.WEBINY_API_TOKEN || "";
const sourceTenant =
  process.env.WEBINY_SOURCE_TENANT || process.env.WEBINY_TENANT || "root";

// Target tenant config
const targetEndpoint =
  process.env.WEBINY_TARGET_API_URL || process.env.WEBINY_API_URL || "";
const targetToken =
  process.env.WEBINY_TARGET_API_TOKEN || process.env.WEBINY_API_TOKEN || "";
const targetTenant = process.env.WEBINY_TARGET_TENANT || "root";

if (!sourceEndpoint || !sourceToken) {
  logger.error(
    "Missing required source environment variables: WEBINY_SOURCE_API_URL/WEBINY_API_URL and/or WEBINY_SOURCE_API_TOKEN/WEBINY_API_TOKEN",
  );
  process.exit(1);
}

if (!targetEndpoint || !targetToken) {
  logger.error(
    "Missing required target environment variables: WEBINY_TARGET_API_URL and/or WEBINY_TARGET_API_TOKEN",
  );
  process.exit(1);
}

const sourceSdk = new Webiny({
  endpoint: sourceEndpoint,
  token: sourceToken,
  tenant: sourceTenant,
});

const targetSdk = new Webiny({
  endpoint: targetEndpoint,
  token: targetToken,
  tenant: targetTenant,
});

// Model ID of the content model the entry belongs to
const modelId = "aedCollection";

// Specific entry to fetch from the source tenant
const entryId = process.env.WEBINY_ENTRY_ID || "69d3e044c4d8710002cd1eec";

// Top-level entry fields requested from the source (include "values.*" for the
// values that must be migrated into the target tenant)
const sourceEntryFields = [
  "id",
  "entryId",
  "createdOn",
  "savedOn",
  "values.contentId",
  "values.siteId",
];

// Fields to return from the createEntry mutation on the target tenant
const createEntryFields = [
  "id",
  "entryId",
  "createdOn",
  "savedOn",
  "values.contentId",
  "values.siteId",
];

// Fetch a single entry by entryId from the source tenant
async function getSourceEntryByEntryId(modelId: string, entryId: string) {
  const result: Result<
    CmsEntryData,
    HttpError | ApiError | NetworkError | ValidationError
  > = await sourceSdk.cms.getEntry({
    modelId,
    where: { entryId },
    fields: sourceEntryFields,
  });

  if (result.isFail()) {
    logger.error(
      { error: result.error.message, modelId, entryId, tenant: sourceTenant },
      "Failed to get source entry",
    );
    throw result.error;
  }

  logger.info(result, "RAW SOURCE RESULT:");

  return result.value;
}

// Create the entry in the target tenant
async function createTargetEntry(
  modelId: string,
  values: Record<string, unknown>,
) {
  const result: Result<
    CreateCmsEntryData,
    HttpError | ApiError | NetworkError | ValidationError
  > = await targetSdk.cms.createEntry({
    modelId,
    data: { values },
    fields: createEntryFields,
  });

  if (result.isFail()) {
    logger.error(
      { error: result.error.message, modelId, tenant: targetTenant },
      "Failed to create target entry",
    );
    throw result.error;
  }

  logger.info(result, "RAW TARGET RESULT:");

  return result.value;
}

async function main() {
  if (!modelId) {
    logger.error("Missing required modelId");
    process.exit(1);
  }

  if (!entryId) {
    logger.error(
      "Missing required entryId. Pass it as a CLI argument or set WEBINY_ENTRY_ID.",
    );
    process.exit(1);
  }

  logger.info(
    {
      sourceEndpoint,
      sourceTenant,
      targetEndpoint,
      targetTenant,
      modelId,
      entryId,
    },
    "Migrating entry between Webiny CMS tenants",
  );

  const sourceEntry = await getSourceEntryByEntryId(modelId, entryId);

  logger.info(
    {
      modelId,
      id: sourceEntry.id,
      entryId: sourceEntry.entryId,
      status: sourceEntry.meta?.status,
      version: sourceEntry.meta?.version,
      title: sourceEntry.meta?.title,
      createdOn: sourceEntry.createdOn,
      savedOn: sourceEntry.savedOn,
    },
    "Source entry",
  );

  const sourceValues = sourceEntry.values;
  if (!sourceValues) {
    logger.error({ modelId, entryId }, "Source entry has no values to migrate");
    process.exit(1);
  }

  const createdEntry = await createTargetEntry(modelId, sourceValues);

  logger.info(
    {
      modelId,
      id: createdEntry.id,
      values: createdEntry.values,
      createdOn: createdEntry.createdOn,
      savedOn: createdEntry.savedOn,
    },
    "Created entry in target tenant",
  );

  logger.info({ modelId, entryId }, "Done");
}

main().catch((err) => {
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    "Script failed",
  );
  process.exit(1);
});
