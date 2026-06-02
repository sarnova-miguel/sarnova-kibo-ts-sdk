import * as dotenv from "dotenv";
import pino from "pino";
import { Webiny, type CmsEntryData } from "@webiny/sdk";
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
        destination: "./logs/list-webiny-cms-entry.log",
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

const endpoint = process.env.WEBINY_API_URL || "";
const token = process.env.WEBINY_API_TOKEN || "";
const tenant = process.env.WEBINY_TENANT || "root";

if (!endpoint || !token) {
  logger.error(
    "Missing required environment variables: WEBINY_API_URL and/or WEBINY_API_TOKEN",
  );
  process.exit(1);
}

const sdk = new Webiny({ endpoint, token, tenant });

// Model ID of the content model the entry belongs to
const modelId = "aedCollection";

// Specific entry to fetch (override via WEBINY_ENTRY_ID env var or CLI arg)
const entryId = process.env.WEBINY_ENTRY_ID || "69d3e044c4d8710002cd1eec";

// Top-level entry fields requested for the model
const entryFields = [
  "id",
  "entryId",
  "createdOn",
  "savedOn",
  "values.contentId",
  "values.siteId",
  // "meta.status",
  // "meta.modelId",
  // "meta.version",
  // "meta.title",
];

// Fetch a single entry by entryId for the given model
async function getEntryByEntryId(modelId: string, entryId: string) {
  const result: Result<
    CmsEntryData,
    HttpError | ApiError | NetworkError | ValidationError
  > = await sdk.cms.getEntry({
    modelId,
    where: { entryId },
    fields: entryFields,
  });

  if (result.isFail()) {
    logger.error(
      { error: result.error.message, modelId, entryId },
      "Failed to get entry",
    );
    throw result.error;
  }

  logger.info(result, "RAW RESULT:");

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
    { endpoint, tenant, modelId, entryId },
    "Fetching entry from Webiny CMS",
  );

  const entry = await getEntryByEntryId(modelId, entryId);

  logger.info(
    {
      modelId,
      id: entry.id,
      entryId: entry.entryId,
      status: entry.meta?.status,
      version: entry.meta?.version,
      title: entry.meta?.title,
      createdOn: entry.createdOn,
      savedOn: entry.savedOn,
    },
    "Entry",
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
