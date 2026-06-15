import * as dotenv from "dotenv";
import pino from "pino";

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/get-webiny-cms-folder.log",
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

// Normalize endpoint: if no path is provided, default to `/graphql` (Main API).
function resolveMainApiEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = "/graphql";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

const endpoint = resolveMainApiEndpoint(rawEndpoint);

if (!endpoint || !token) {
  logger.error(
    "Missing required environment variables: WEBINY_API_URL and/or WEBINY_API_TOKEN",
  );
  process.exit(1);
}

// Folder lookup. Provide the folder ID via WEBINY_FOLDER_ID.
const folderId = process.env.WEBINY_FOLDER_ID || "6a2c46161d7ee70002fca3c3";

if (!folderId) {
  logger.error("Missing required environment variable: WEBINY_FOLDER_ID");
  process.exit(1);
}

const getFolderQuery = `
  query GetFolder($id: ID!) {
    aco {
      getFolder(id: $id) {
        data {
          id
          title
          slug
          type
          parentId
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

interface GetFolderResponse {
  aco: {
    getFolder: {
      data: Folder | null;
      error: { code?: string; message?: string; data?: unknown } | null;
    };
  };
}

async function getFolder(): Promise<Folder> {
  const variables = { id: folderId };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-tenant": tenant,
    },
    body: JSON.stringify({ query: getFolderQuery, variables }),
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

  const json = (await response.json()) as GraphQLResponse<GetFolderResponse>;

  if (json.errors && json.errors.length > 0) {
    logger.error({ errors: json.errors }, "GraphQL errors from Webiny API");
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  const payload = json.data?.aco?.getFolder;
  if (!payload) {
    throw new Error("Missing payload for aco.getFolder in GraphQL response");
  }

  if (payload.error) {
    logger.error({ error: payload.error }, "ACO getFolder returned error");
    throw new Error(payload.error.message || "Unknown ACO getFolder error");
  }

  if (!payload.data) {
    throw new Error("ACO getFolder returned no data");
  }

  return payload.data;
}

async function main() {
  logger.info(
    {
      endpoint,
      tenant,
      folderId,
    },
    "Fetching folder via Webiny ACO API",
  );

  const folder = await getFolder();

  logger.info({ folder }, "Folder fetched");
  logger.info({ id: folder.id }, "Done");
}

main().catch((err) => {
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    "Script failed",
  );
  process.exit(1);
});
