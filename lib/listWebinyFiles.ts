import * as dotenv from "dotenv";
import pino from "pino";
import { Webiny } from "@webiny/sdk";

const pageSize = 100;

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/list-webiny-files.log",
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

// Fields requested from the File Manager listFiles query
const fields = [
  "id",
  "name",
  "key",
  "type",
  "size",
  "src",
  "createdOn",
  "tags",
  "location { folderId }",
];

// Fetch every page of files from the File Manager using cursor pagination
async function listAllFiles() {
  const allFiles: Record<string, any>[] = [];
  let after: string | undefined = undefined;
  let pageNumber = 0;

  while (true) {
    pageNumber += 1;
    const result = await sdk.fileManager.listFiles({
      limit: pageSize,
      after,
      fields,
    });

    if (result.isFail()) {
      logger.error(
        { error: result.error.message, page: pageNumber },
        "Failed to list files",
      );
      throw result.error;
    }

    const { data, meta } = result.value;
    allFiles.push(...data);

    logger.info(
      {
        page: pageNumber,
        fetched: data.length,
        totalSoFar: allFiles.length,
        totalCount: meta.totalCount,
      },
      "Fetched page of files",
    );

    if (!meta.hasMoreItems || !meta.cursor) {
      break;
    }
    after = meta.cursor;
  }

  return allFiles;
}

async function main() {
  logger.info({ endpoint, tenant }, "Listing files from Webiny File Manager");

  const files = await listAllFiles();

  for (const file of files) {
    logger.info(
      {
        id: file.id,
        name: file.name,
        key: file.key,
        type: file.type,
        size: file.size,
        src: file.src,
        createdOn: file.createdOn,
        tags: file.tags,
        folderId: file.location?.folderId,
      },
      "File",
    );
  }

  logger.info({ total: files.length }, "Done");
}

main().catch((err) => {
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    "Script failed",
  );
  process.exit(1);
});
