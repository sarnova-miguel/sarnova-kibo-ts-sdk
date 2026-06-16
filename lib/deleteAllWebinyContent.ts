import * as dotenv from "dotenv";
import pino from "pino";

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/delete-all-webiny-content.log",
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

const logger = pino({ level: process.env.LOG_LEVEL || "info" }, transport);

dotenv.config();

// ── Endpoints ───────────────────────────────────────────────────────────────
// The Manage API (`/cms/manage/{locale}`) hosts content models, content model
// groups, and the per-model typed entry queries/mutations. The Main GraphQL
// API (`/graphql`) hosts ACO folders. Both endpoints share the same
// Authorization token and `x-tenant` header.
const rawMain = (process.env.WEBINY_API_URL || "").replace(/\/+$/, "");
const base = rawMain.replace(/\/graphql$/, "");
const locale = process.env.WEBINY_LOCALE || "en-US";
const mainEndpoint = base ? `${base}/graphql` : "";
const manageEndpoint =
  process.env.WEBINY_MANAGE_API_URL ||
  (base ? `${base}/cms/manage/${locale}` : "");
const token = process.env.WEBINY_API_TOKEN || "";
const tenant = process.env.TENANT_ID || process.env.WEBINY_TENANT || "root";

// Destructive-operation safety guard. Set WEBINY_CONFIRM_DELETE_ALL="yes" in
// the .env to allow the script to run.
const confirmed = process.env.WEBINY_CONFIRM_DELETE_ALL === "yes";

// Models excluded from every phase. These are Webiny system/plugin models that
// either cannot be deleted at runtime or whose entries must not be touched by
// a tenant wipe.
const SKIPPED_MODELS = new Set<string>([
  "backgroundTaskSettings",
  "webhook",
  "webhookDelivery",
  "webhookSettings",
  "wbyLanguage",
  "wbyTenant",
]);

if (!mainEndpoint || !manageEndpoint || !token) {
  logger.error(
    "Missing required env vars: WEBINY_API_URL and/or WEBINY_API_TOKEN",
  );
  process.exit(1);
}
if (!confirmed) {
  logger.error(
    { tenant },
    'Refusing to run. Set WEBINY_CONFIRM_DELETE_ALL="yes" to proceed.',
  );
  process.exit(1);
}

// ── Shared GraphQL helper ───────────────────────────────────────────────────
interface GqlResp<T> {
  data?: T;
  errors?: { message: string }[];
}

async function gql<T>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-tenant": tenant,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${res.statusText}: ${await res.text()}`,
    );
  }
  const json = (await res.json()) as GqlResp<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new Error("Empty GraphQL response");
  return json.data;
}

// ── Retry helper ────────────────────────────────────────────────────────────
// Wraps an individual step (one GraphQL call) with bounded exponential
// backoff. Permanent errors (schema validation, non-retryable HTTP 4xx) are
// detected and re-thrown immediately so we don't waste attempts on, e.g.,
// singleton models that don't expose a `list*` query.
function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /Cannot query field|Unknown argument|Syntax Error|Variable .* is not defined|is not defined by type/i.test(
      msg,
    )
  ) {
    return false;
  }
  const httpMatch = msg.match(/^HTTP (\d{3})/);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      return false;
    }
  }
  return true;
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isRetryable(err)) break;
      const delayMs = baseDelay * 2 ** (attempt - 1);
      logger.warn(
        {
          label,
          attempt,
          attempts,
          delayMs,
          error: err instanceof Error ? err.message : String(err),
        },
        "step failed; retrying",
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

interface ContentModel {
  modelId: string;
  singularApiName: string;
  pluralApiName: string;
  plugin?: boolean;
}

type EntryListResp = Record<
  string,
  { data: { id: string }[] | null; error: { message?: string } | null }
>;
type EntryDeleteResp = Record<
  string,
  { data: boolean | null; error: { message?: string } | null }
>;

// ── Phase 1: delete every entry of every model (Manage API) ─────────────────
// For each model we call the per-model `list<PluralApiName>` to get revision
// ids, then `delete<SingularApiName>(revision: $r)` per entry.
async function deleteAllEntries(models: ContentModel[]): Promise<void> {
  logger.info({ endpoint: manageEndpoint }, "Phase 1: deleting entries");
  logger.info(
    "entry delete failed - Tried to get value from a failed Result. messages come from inside Webiny's server-side delete resolver, after the entry has already been removed from storage. Confirm deletion in UI",
  );
  for (const m of models) {
    try {
      const listQ = `query { list${m.pluralApiName} { data { id } error { message } } }`;
      const lr = await withRetry(`list${m.pluralApiName}`, () =>
        gql<EntryListResp>(manageEndpoint, listQ),
      );
      const list = lr[`list${m.pluralApiName}`];
      if (list?.error) {
        logger.warn(
          { model: m.modelId, error: list.error },
          "list entries failed; skipping model",
        );
        continue;
      }
      const entries = list?.data ?? [];
      logger.info(
        { model: m.modelId, count: entries.length },
        "deleting entries for model",
      );
      for (const e of entries) {
        try {
          const mut = `mutation D($r: ID!) { delete${m.singularApiName}(revision: $r) { data error { message } } }`;
          const dr = await withRetry(`delete${m.singularApiName}`, () =>
            gql<EntryDeleteResp>(manageEndpoint, mut, { r: e.id }),
          );
          const p = dr[`delete${m.singularApiName}`];
          if (p?.error)
            logger.warn(
              { model: m.modelId, id: e.id, error: p.error },
              "entry delete failed",
            );
          else logger.info({ model: m.modelId, id: e.id }, "entry deleted");
        } catch (err) {
          logger.warn(
            {
              model: m.modelId,
              id: e.id,
              error: err instanceof Error ? err.message : String(err),
            },
            "entry delete threw; continuing",
          );
        }
      }
    } catch (err) {
      logger.warn(
        {
          model: m.modelId,
          error: err instanceof Error ? err.message : String(err),
        },
        "model entry processing failed; skipping model",
      );
    }
  }
  logger.info("Phase 1 complete");
}

// ── Phase 2: delete every CMS ACO folder (Main API) ─────────────────────────
// Folder `type` is always `cms:<modelId>`. Webiny refuses to delete a folder
// that still contains child folders or entries, so we list per model type and
// order parents last (leaves first).
type FolderListResp = {
  aco: {
    listFolders: {
      data: { id: string; parentId: string | null }[] | null;
      error: { message?: string } | null;
    };
  };
};
type FolderDeleteResp = {
  aco: {
    deleteFolder: {
      data: boolean | null;
      error: { message?: string } | null;
    };
  };
};

async function deleteAllFolders(models: ContentModel[]): Promise<void> {
  logger.info({ endpoint: mainEndpoint }, "Phase 2: deleting folders");
  for (const m of models) {
    const type = `cms:${m.modelId}`;
    try {
      const listQ = `query L($t: String!) { aco { listFolders(where: { type: $t }) { data { id parentId } error { message } } } }`;
      const lr = await withRetry(`listFolders:${type}`, () =>
        gql<FolderListResp>(mainEndpoint, listQ, { t: type }),
      );
      const folders = lr.aco.listFolders.data ?? [];
      const parents = new Set(
        folders.map((f) => f.parentId).filter((p): p is string => !!p),
      );
      const ordered = [...folders].sort(
        (a, b) => Number(parents.has(a.id)) - Number(parents.has(b.id)),
      );
      logger.info(
        { type, count: folders.length },
        "deleting folders for model",
      );
      for (const f of ordered) {
        try {
          const mut = `mutation D($id: ID!) { aco { deleteFolder(id: $id) { data error { message } } } }`;
          const dr = await withRetry(`deleteFolder:${f.id}`, () =>
            gql<FolderDeleteResp>(mainEndpoint, mut, { id: f.id }),
          );
          if (dr.aco.deleteFolder.error)
            logger.warn(
              { id: f.id, type, error: dr.aco.deleteFolder.error },
              "folder delete failed",
            );
          else logger.info({ id: f.id, type }, "folder deleted");
        } catch (err) {
          logger.warn(
            {
              id: f.id,
              type,
              error: err instanceof Error ? err.message : String(err),
            },
            "folder delete threw; continuing",
          );
        }
      }
    } catch (err) {
      logger.warn(
        {
          type,
          error: err instanceof Error ? err.message : String(err),
        },
        "folder processing failed; skipping model",
      );
    }
  }
  logger.info("Phase 2 complete");
}

// ── Phase 3: delete every content model (Manage API) ────────────────────────
// Models registered via plugin code cannot be deleted at runtime; they are
// logged and skipped.
type ModelDeleteResp = {
  deleteContentModel: {
    data: boolean | null;
    error: { message?: string } | null;
  };
};

async function deleteAllContentModels(models: ContentModel[]): Promise<void> {
  logger.info(
    { endpoint: manageEndpoint, count: models.length },
    "Phase 3: deleting content models",
  );
  for (const m of models) {
    if (m.plugin) {
      logger.warn(
        { modelId: m.modelId },
        "plugin model; cannot delete at runtime",
      );
      continue;
    }
    try {
      const mut = `mutation D($id: ID!) { deleteContentModel(modelId: $id) { data error { message } } }`;
      const dr = await withRetry(`deleteContentModel:${m.modelId}`, () =>
        gql<ModelDeleteResp>(manageEndpoint, mut, { id: m.modelId }),
      );
      if (dr.deleteContentModel.error)
        logger.warn(
          { modelId: m.modelId, error: dr.deleteContentModel.error },
          "model delete failed",
        );
      else logger.info({ modelId: m.modelId }, "model deleted");
    } catch (err) {
      logger.warn(
        {
          modelId: m.modelId,
          error: err instanceof Error ? err.message : String(err),
        },
        "model delete threw; continuing",
      );
    }
  }
  logger.info("Phase 3 complete");
}

// ── Phase 4: delete every content model group (Manage API) ──────────────────
// Webiny refuses to delete a group that still contains models, so this phase
// must run after Phase 3.
type GroupListResp = {
  listContentModelGroups: {
    data: { id: string; name: string; plugin?: boolean }[] | null;
    error: { message?: string } | null;
  };
};
type GroupDeleteResp = {
  deleteContentModelGroup: {
    data: boolean | null;
    error: { message?: string } | null;
  };
};

async function deleteAllContentModelGroups(): Promise<void> {
  logger.info(
    { endpoint: manageEndpoint },
    "Phase 4: deleting content model groups",
  );
  let groups: { id: string; name: string; plugin?: boolean }[] = [];
  try {
    const listQ = `query { listContentModelGroups { data { id name plugin } error { message } } }`;
    const lr = await withRetry("listContentModelGroups", () =>
      gql<GroupListResp>(manageEndpoint, listQ),
    );
    groups = lr.listContentModelGroups.data ?? [];
    logger.info({ count: groups.length }, "groups discovered");
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      "Phase 4 list failed",
    );
    return;
  }
  for (const g of groups) {
    if (g.plugin) {
      logger.warn(
        { id: g.id, name: g.name },
        "plugin group; cannot delete at runtime",
      );
      continue;
    }
    try {
      const mut = `mutation D($id: ID!) { deleteContentModelGroup(id: $id) { data error { message } } }`;
      const dr = await withRetry(`deleteContentModelGroup:${g.id}`, () =>
        gql<GroupDeleteResp>(manageEndpoint, mut, { id: g.id }),
      );
      if (dr.deleteContentModelGroup.error)
        logger.warn(
          { id: g.id, error: dr.deleteContentModelGroup.error },
          "group delete failed",
        );
      else logger.info({ id: g.id, name: g.name }, "group deleted");
    } catch (err) {
      logger.warn(
        {
          id: g.id,
          error: err instanceof Error ? err.message : String(err),
        },
        "group delete threw; continuing",
      );
    }
  }
  logger.info("Phase 4 complete");
}

// ── Orchestrator ────────────────────────────────────────────────────────────
// Discovers all content models once and runs the four phases in the order
// required by Webiny's referential integrity: entries → folders → models →
// groups.
type ModelListResp = {
  listContentModels: {
    data: ContentModel[] | null;
    error: { message?: string } | null;
  };
};

async function main() {
  logger.info(
    { tenant, locale, mainEndpoint, manageEndpoint },
    "Starting tenant wipe",
  );
  const listQ = `query { listContentModels { data { modelId singularApiName pluralApiName plugin } error { message } } }`;
  const lr = await withRetry("listContentModels", () =>
    gql<ModelListResp>(manageEndpoint, listQ),
  );
  const discovered = lr.listContentModels.data ?? [];
  const skipped = discovered.filter((m) => SKIPPED_MODELS.has(m.modelId));
  const models = discovered.filter((m) => !SKIPPED_MODELS.has(m.modelId));
  logger.info(
    {
      discovered: discovered.length,
      skipped: skipped.map((m) => m.modelId),
      processing: models.length,
    },
    "Discovered content models",
  );

  await deleteAllEntries(models);
  await deleteAllFolders(models);
  await deleteAllContentModels(models);
  await deleteAllContentModelGroups();

  logger.info("Tenant wipe complete");
}

main().catch((err) => {
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    "Script failed",
  );
  process.exit(1);
});
