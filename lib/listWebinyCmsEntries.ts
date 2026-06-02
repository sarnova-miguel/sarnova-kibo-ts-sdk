import * as dotenv from "dotenv";
import pino from "pino";
import { Webiny, type ListEntriesResult } from "@webiny/sdk";
import type { Result } from "@webiny/sdk";
import type {
  HttpError,
  ApiError,
  NetworkError,
  ValidationError,
} from "@webiny/sdk";

const pageSize = 100;

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/list-webiny-cms-entries.log",
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

// Model ID of the content model whose entries should be listed
const modelId = "aedCollection";

// Top-level entry fields requested for the model
const entryFields = [
  "id",
  "entryId",
  "createdOn",
  "savedOn",
  // "meta.status",
  // "meta.modelId",
  // "meta.version",
  // "meta.title",
];

// Fetch every page of entries for a single model using cursor pagination
async function listAllEntriesForModel(modelId: string) {
  const allEntries: Record<string, any>[] = [];
  let after: string | undefined = undefined;
  let pageNumber = 0;

  while (true) {
    pageNumber += 1;
    const result: Result<
      ListEntriesResult,
      HttpError | ApiError | NetworkError | ValidationError
    > = await sdk.cms.listEntries({
      modelId,
      limit: pageSize,
      after,
      fields: entryFields,
    });

    if (result.isFail()) {
      logger.error(
        { error: result.error.message, modelId, page: pageNumber },
        "Failed to list entries",
      );
      throw result.error;
    }

    logger.info(result, "RAW RESULT:");

    const { data, meta } = result.value;
    allEntries.push(...data);

    logger.info(
      {
        modelId,
        page: pageNumber,
        fetched: data.length,
        totalSoFar: allEntries.length,
        totalCount: meta.totalCount,
      },
      "Fetched page of entries",
    );

    if (!meta.hasMoreItems || !meta.cursor) {
      break;
    }
    after = meta.cursor;
  }

  return allEntries;
}

async function main() {
  if (!modelId) {
    logger.error("Missing required modelId");
    process.exit(1);
  }

  logger.info({ endpoint, tenant, modelId }, "Listing entries from Webiny CMS");

  const entries = await listAllEntriesForModel(modelId);

  for (const entry of entries) {
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
  }

  logger.info({ modelId, total: entries.length }, "Done");
}

main().catch((err) => {
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    "Script failed",
  );
  process.exit(1);
});
