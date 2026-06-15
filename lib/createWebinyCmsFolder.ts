import * as dotenv from "dotenv";
import pino from "pino";

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/create-webiny-cms-folder.log",
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

// Webiny Main GraphQL API endpoint, typically:
//   https://YOUR_DOMAIN/graphql
// The ACO (Advanced Content Organization) schema — including `Query.aco` and
// `aco.getFolder` — is exposed on the Main API, not the Headless CMS Manage
// API (`/cms/manage/...`), which only exposes CMS model queries.
const rawEndpoint =
  process.env.WEBINY_API_URL || "https://d2mp6wd3cv9own.cloudfront.net/graphql";
const token = process.env.WEBINY_API_TOKEN || "";
const tenant = process.env.WEBINY_TENANT || "root";

if (!rawEndpoint || !token) {
  logger.error(
    "Missing required environment variables: WEBINY_API_URL and/or WEBINY_API_TOKEN",
  );
  process.exit(1);
}

// Normalize: ensure the endpoint targets the `/graphql` path on the Main API.
// Webiny returns `404 { "error": "Unable to resolve the request!" }` when the
// request lands on the host root (or any non-GraphQL path).
const endpoint = /\/graphql\/?$/.test(rawEndpoint)
  ? rawEndpoint.replace(/\/$/, "")
  : `${rawEndpoint.replace(/\/$/, "")}/graphql`;

// CMS entry folder definition. Folder `type` is always "cms:<modelId>",
// where <modelId> is the target Headless CMS model's modelId.
const cmsModelId =
  process.env.WEBINY_CMS_MODEL_ID || "fiftyFiftyContentBlockCollection";
const folderTitle = process.env.WEBINY_FOLDER_TITLE || "New Test Folder";
const folderSlug = process.env.WEBINY_FOLDER_SLUG || "new-test-folder";
const folderParentId = process.env.WEBINY_FOLDER_PARENT_ID || null;

if (!cmsModelId) {
  logger.error(
    "Missing required environment variable: WEBINY_CMS_MODEL_ID (the Headless CMS modelId the folder belongs to)",
  );
  process.exit(1);
}

const folderType = `cms:${cmsModelId}`;

const createFolderMutation = `
  mutation CreateFolder($data: FolderCreateInput!) {
    aco {
      createFolder(data: $data) {
        data {
          id
          title
          slug
          type
          parentId
          createdOn
          createdBy {
            id
            displayName
            type
          }
        }
        error {
          code
          message
          data
        }
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

interface Folder {
  id: string;
  title: string;
  slug: string;
  type: string;
  parentId?: string | null;
  createdOn?: string;
  createdBy?: { id: string; displayName?: string; type?: string } | null;
}

interface CreateFolderResponse {
  aco: {
    createFolder: {
      data: Folder | null;
      error: { code?: string; message?: string; data?: unknown } | null;
    };
  };
}

async function createFolder(): Promise<Folder> {
  const variables = {
    data: {
      title: folderTitle,
      slug: folderSlug,
      type: folderType,
      parentId: folderParentId,
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-tenant": tenant,
    },
    body: JSON.stringify({ query: createFolderMutation, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error(
      { status: response.status, statusText: response.statusText, body },
      "HTTP error from Webiny API",
    );
    throw new Error(
      `Webiny API HTTP ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as GraphQLResponse<CreateFolderResponse>;

  if (json.errors && json.errors.length > 0) {
    logger.error({ errors: json.errors }, "GraphQL errors from Webiny API");
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  const payload = json.data?.aco?.createFolder;
  if (!payload) {
    throw new Error("Missing payload for aco.createFolder in GraphQL response");
  }

  if (payload.error) {
    logger.error({ error: payload.error }, "ACO createFolder returned error");
    throw new Error(payload.error.message || "Unknown ACO createFolder error");
  }

  if (!payload.data) {
    throw new Error("ACO createFolder returned no data");
  }

  return payload.data;
}

async function main() {
  logger.info(
    {
      endpoint,
      tenant,
      folder: {
        title: folderTitle,
        slug: folderSlug,
        type: folderType,
        modelId: cmsModelId,
        parentId: folderParentId,
      },
    },
    "Creating CMS entry folder via Webiny ACO API",
  );

  const folder = await createFolder();

  logger.info({ folder }, "Folder created");
  logger.info({ id: folder.id }, "Done");
}

main().catch((err) => {
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    "Script failed",
  );
  process.exit(1);
});
