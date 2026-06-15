import * as dotenv from "dotenv";
import pino from "pino";

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/list-webiny-cms-entry-graphql-manage-api.log",
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
const endpoint =
  process.env.WEBINY_MANAGE_API_URL ||
  "https://d2mp6wd3cv9own.cloudfront.net/cms/manage";
const token = process.env.WEBINY_API_TOKEN || "";
const tenant = process.env.WEBINY_TENANT || "root";

if (!endpoint || !token) {
  logger.error(
    "Missing required environment variables: WEBINY_MANAGE_API_URL (or WEBINY_API_URL) and/or WEBINY_API_TOKEN",
  );
  process.exit(1);
}

// Name of the list query exposed by the Manage API for the target model.
// Webiny derives this from the model's plural API name, e.g.
// `listPromoBanners` for the "Promo Banner" model.
const listQueryName = "listGaloSiteContentModels";

// GraphQL query string. Includes `meta.status` so the entry's publication
// status (draft / published / unpublished) is returned.
const query = `
  query ListEntries {
    ${listQueryName} {
      data {
        id
        entryId
        createdOn
        savedOn
        values {
          title
          contentId
        }
        live {
          version
        }
        wbyAco_location {
          folderId
        }
        meta {
          version
          status
          title
          modelId
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

interface EntryMeta {
  version?: number;
  status?: string;
  title?: string;
  modelId?: string;
}

interface Entry {
  id: string;
  entryId: string;
  createdOn?: string;
  savedOn?: string;
  values?: Record<string, unknown>;
  live?: { version?: number } | null;
  wbyAco_location?: { folderId?: string | null } | null;
  meta?: EntryMeta;
}

interface ListEntriesResponse {
  [key: string]: {
    data: Entry[] | null;
    error: { code?: string; message?: string; data?: unknown } | null;
  };
}

async function listEntries(): Promise<Entry[]> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-tenant": tenant,
    },
    body: JSON.stringify({ query }),
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

  const json = (await response.json()) as GraphQLResponse<ListEntriesResponse>;

  if (json.errors && json.errors.length > 0) {
    logger.error({ errors: json.errors }, "GraphQL errors from Manage API");
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  const payload = json.data?.[listQueryName];
  if (!payload) {
    throw new Error(
      `Missing payload for query "${listQueryName}" in GraphQL response`,
    );
  }

  if (payload.error) {
    logger.error({ error: payload.error }, "Manage API returned error");
    throw new Error(payload.error.message || "Unknown Manage API error");
  }

  return payload.data ?? [];
}

async function main() {
  logger.info(
    { endpoint, tenant, listQueryName },
    "Listing entries from Webiny CMS Manage API (raw GraphQL)",
  );

  const entries = await listEntries();

  logger.info({ count: entries.length }, "Entries returned");

  for (const entry of entries) {
    logger.info(
      // {
      //   id: entry.id,
      //   entryId: entry.entryId,
      //   status: entry.meta?.status,
      //   version: entry.meta?.version,
      //   title: entry.meta?.title,
      //   createdOn: entry.createdOn,
      //   savedOn: entry.savedOn,
      // },
      {
        entry: entry,
      },
      "Entry",
    );
  }

  logger.info({ listQueryName, count: entries.length }, "Done");
}

main().catch((err) => {
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    "Script failed",
  );
  process.exit(1);
});
