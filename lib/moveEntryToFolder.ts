import * as dotenv from "dotenv";
import pino from "pino";

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/move-entry-to-folder.log",
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

// Webiny Manage API endpoint, typically:
//   https://YOUR_DOMAIN/cms/manage/{locale_code}
// See: https://www.webiny.com/docs/headless-cms/graphql-api-overview#manage-api
// `WEBINY_MANAGE_API_URL` takes precedence. Otherwise we derive the Manage
// endpoint from `WEBINY_API_URL` by stripping any trailing `/graphql` and
// appending `/cms/manage`.
const rawManageUrl = process.env.WEBINY_MANAGE_API_URL || "";
const rawMainUrl = process.env.WEBINY_API_URL || "";
const baseFromMain = rawMainUrl.replace(/\/+$/, "").replace(/\/graphql$/, "");
const endpoint = rawManageUrl
  ? rawManageUrl
  : baseFromMain
    ? `${baseFromMain}/cms/manage`
    : "https://d2mp6wd3cv9own.cloudfront.net/cms/manage";
const token = process.env.WEBINY_API_TOKEN || "";
const tenant = process.env.WEBINY_TENANT || "root";

if (!endpoint || !token) {
  logger.error(
    "Missing required environment variables: WEBINY_MANAGE_API_URL (or WEBINY_API_URL) and/or WEBINY_API_TOKEN",
  );
  process.exit(1);
}

// Model ID of the content model the entry belongs to.
const modelId = process.env.WEBINY_CMS_MODEL_ID || "categoryPageLayout";

// Singular API name of the model in PascalCase. Webiny derives the per-model
// move mutation as `move<SingularApiName>` (e.g. `moveFiftyFiftyContentBlockCollection`).
// Defaults to PascalCasing the `modelId` — override via
// `WEBINY_CMS_MODEL_SINGULAR` for models whose configured singular API name
// differs.
const singularApiName =
  process.env.WEBINY_CMS_MODEL_SINGULAR ||
  modelId.charAt(0).toUpperCase() + modelId.slice(1);

// Revision ID of the entry to move, in `<entryId>#<version>` format
// (e.g. "6a2d37554a24ef000208b93e#0001"). The per-model move mutation's
// `revision` argument expects the revision id — a bare entry id will not
// match. `WEBINY_ENTRY_REVISION` is the preferred env var name;
// `WEBINY_ENTRY_ID` is accepted as a fallback.
const entryRevisionId =
  process.env.WEBINY_ENTRY_REVISION ||
  process.env.WEBINY_ENTRY_ID ||
  "6a28c16821ddf60002aa40ab#0001";

// Target folder ID to move the entry into. Use "ROOT" to move the entry to
// the root of the model's folder tree.
const targetFolderId =
  process.env.WEBINY_TARGET_FOLDER_ID || "6a30b39b34ad220002d68652";

const moveMutationName = `move${singularApiName}`;

// Per-model move mutation on the Manage API. Takes `revision` and `folderId`
// and returns a `<SingularApiName>MoveResponse` with `data: Boolean` and
// `error: CmsError`.
const moveEntryMutation = `
  mutation MoveEntry($revision: ID!, $folderId: ID!) {
    ${moveMutationName}(revision: $revision, folderId: $folderId) {
      data
      error {
        code
        message
        data
      }
    }
  }
`;

interface GraphQLError {
  message: string;
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

interface MoveEntryResponse {
  [key: string]: {
    data: boolean | null;
    error: { code?: string; message?: string; data?: unknown } | null;
  };
}

async function moveEntryToFolder(
  revisionId: string,
  folderId: string,
): Promise<boolean> {
  const variables = { revision: revisionId, folderId };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-tenant": tenant,
    },
    body: JSON.stringify({ query: moveEntryMutation, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error(
      { status: response.status, statusText: response.statusText, body },
      "HTTP error from Webiny Manage API",
    );
    throw new Error(
      `Webiny Manage API HTTP ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as GraphQLResponse<MoveEntryResponse>;

  if (json.errors && json.errors.length > 0) {
    logger.error(
      { errors: json.errors },
      "GraphQL errors from Webiny Manage API",
    );
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  const payload = json.data?.[moveMutationName];
  if (!payload) {
    throw new Error(
      `Missing payload for "${moveMutationName}" in GraphQL response`,
    );
  }

  if (payload.error) {
    logger.error(
      { error: payload.error },
      `${moveMutationName} returned error`,
    );
    throw new Error(
      payload.error.message || `Unknown ${moveMutationName} error`,
    );
  }

  return payload.data === true;
}

async function main() {
  if (!entryRevisionId) {
    logger.error(
      "Missing required entry revision id. Set WEBINY_ENTRY_REVISION to the `<entryId>#<version>` revision id.",
    );
    process.exit(1);
  }

  if (!/#\d+$/.test(entryRevisionId)) {
    logger.warn(
      { entryRevisionId },
      "WEBINY_ENTRY_REVISION does not match `<entryId>#<version>`; the move mutation expects a revision id",
    );
  }

  if (!targetFolderId) {
    logger.error(
      'Missing required target folder. Set WEBINY_TARGET_FOLDER_ID (use "ROOT" for the model\'s root).',
    );
    process.exit(1);
  }

  logger.info(
    {
      endpoint,
      tenant,
      modelId,
      mutation: moveMutationName,
      entryRevisionId,
      targetFolderId,
    },
    "Moving entry to a different folder via Webiny CMS Manage API",
  );

  const moved = await moveEntryToFolder(entryRevisionId, targetFolderId);

  logger.info(
    { modelId, entryRevisionId, targetFolderId, moved },
    "Entry moved",
  );
  logger.info({ modelId, entryRevisionId, targetFolderId }, "Done");
}

main().catch((err) => {
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    "Script failed",
  );
  process.exit(1);
});
