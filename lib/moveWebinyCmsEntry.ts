import * as dotenv from "dotenv";
import pino from "pino";

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/move-webiny-cms-entry.log",
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
// The Main `/graphql` API only exposes a generic `cms.updateEntryRevision`
// with `data: JSON!`; the per-model typed `Input` types (including the
// top-level `wbyAco_location` field) are only generated on the Manage API.
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
const modelId =
  process.env.WEBINY_CMS_MODEL_ID || "fiftyFiftyContentBlockCollection";

// Singular API name of the model in PascalCase. Webiny derives the per-model
// mutation as `update<SingularApiName>` and the input type as
// `<SingularApiName>Input` (e.g. `updateFiftyFiftyContentBlockCollection` /
// `FiftyFiftyContentBlockCollectionInput`). Defaults to PascalCasing the
// `modelId` — override via `WEBINY_CMS_MODEL_SINGULAR` for models whose
// configured singular API name differs.
const singularApiName =
  process.env.WEBINY_CMS_MODEL_SINGULAR ||
  modelId.charAt(0).toUpperCase() + modelId.slice(1);

// Revision ID of the entry to update, in `<entryId>#<version>` format
// (e.g. "6a2d37554a24ef000208b93e#0001"). The per-model update mutation's
// `revision` argument expects the revision id — a bare entry id will not
// match. `WEBINY_ENTRY_REVISION` is the preferred env var name;
// `WEBINY_ENTRY_ID` is accepted as a fallback.
const entryRevisionId =
  process.env.WEBINY_ENTRY_REVISION ||
  process.env.WEBINY_ENTRY_ID ||
  "6a2d37554a24ef000208b93e#0001";

// Target folder ID to move the entry into. Use "ROOT" to move the entry to
// the root of the model's folder tree.
const targetFolderId =
  process.env.WEBINY_TARGET_FOLDER_ID || "6a2d37cf4a24ef000208b940";

const updateMutationName = `update${singularApiName}`;
const inputTypeName = `${singularApiName}Input`;

// Per-model update mutation on the Manage API. `wbyAco_location` is a
// top-level field on the model's `Input` type (see WbyAcoLocationInput in
// introspectionSchema.json), not nested under `values`.
const updateEntryMutation = `
  mutation MoveEntry($revision: ID!, $data: ${inputTypeName}!) {
    ${updateMutationName}(revision: $revision, data: $data) {
      data {
        id
        entryId
        wbyAco_location {
          folderId
        }
      }
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

interface UpdatedEntry {
  id: string;
  entryId: string;
  wbyAco_location?: { folderId?: string | null } | null;
}

interface UpdateEntryResponse {
  [key: string]: {
    data: UpdatedEntry | null;
    error: { code?: string; message?: string; data?: unknown } | null;
  };
}

async function moveEntryToFolder(
  revisionId: string,
  folderId: string,
): Promise<UpdatedEntry> {
  const variables = {
    revision: revisionId,
    data: { wbyAco_location: { folderId } },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-tenant": tenant,
    },
    body: JSON.stringify({ query: updateEntryMutation, variables }),
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

  const json = (await response.json()) as GraphQLResponse<UpdateEntryResponse>;

  if (json.errors && json.errors.length > 0) {
    logger.error(
      { errors: json.errors },
      "GraphQL errors from Webiny Manage API",
    );
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  const payload = json.data?.[updateMutationName];
  if (!payload) {
    throw new Error(
      `Missing payload for "${updateMutationName}" in GraphQL response`,
    );
  }

  if (payload.error) {
    logger.error(
      { error: payload.error },
      `${updateMutationName} returned error`,
    );
    throw new Error(
      payload.error.message || `Unknown ${updateMutationName} error`,
    );
  }

  if (!payload.data) {
    throw new Error(`${updateMutationName} returned no data`);
  }

  return payload.data;
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
      "WEBINY_ENTRY_REVISION does not match `<entryId>#<version>`; cms.updateEntryRevision expects a revision id",
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
      mutation: updateMutationName,
      inputType: inputTypeName,
      entryRevisionId,
      targetFolderId,
    },
    "Moving entry to a different folder via Webiny CMS Manage API",
  );

  const updated = await moveEntryToFolder(entryRevisionId, targetFolderId);

  logger.info(
    { modelId, entryRevisionId, targetFolderId, updated },
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
