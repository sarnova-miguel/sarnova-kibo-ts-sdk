import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import pino from "pino";
import Bottleneck from "bottleneck";
import { parse, stringify } from "csv/sync";
import { Configuration } from "@kibocommerce/rest-sdk";
import { ProductVariationsApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductVariationsApi";
import type { ProductVariation } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/models";

const pageSize = 200;

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/import-tenant-product-variations.log",
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

const configuration = new Configuration({
  tenantId: process.env.TENANT_ID || "",
  siteId: process.env.SITE_ID || "",
  catalog: process.env.CATALOG || "",
  masterCatalog: process.env.MASTER_CATALOG || "",
  sharedSecret: process.env.SHARED_SECRET || "",
  clientId: process.env.CLIENT_ID || "",
  pciHost: process.env.PCI_HOST || "",
  authHost: process.env.AUTH_HOST || "",
  apiEnv: process.env.API_ENV || "",
});

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 500,
});

const exportDir = path.join(__dirname, "..", "exports");
const inputFileName = "productVariations.csv";
const summaryFileName = "variationCodeMigration.csv";

// Canonical, order-independent key for an option tuple. Uses the semantic
// value (the human-readable label) so the key matches across tenants where
// valueSequence numbers are regenerated.
function tupleKey(
  opts: Array<{ attributeFQN: string; value: string }>,
): string {
  return JSON.stringify(
    [...opts]
      .map((o) => [o.attributeFQN.toLowerCase(), String(o.value)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

// Same semantic-value resolution used in the export script
function semanticValue(option: {
  value?: any;
  content?: { stringValue?: string | null } | null;
}): string {
  const sv = option.content?.stringValue;
  if (sv != null && sv !== "") return String(sv);
  if (option.value == null) return "";
  return typeof option.value === "object"
    ? JSON.stringify(option.value)
    : String(option.value);
}

// Fetch all pages for a paginated API endpoint
async function fetchAllPages<T>(
  fetchPage: (
    startIndex: number,
  ) => Promise<{ items?: T[] | null; totalCount?: number }>,
): Promise<T[]> {
  const allItems: T[] = [];
  let startIndex = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await fetchPage(startIndex);
    const items = response.items || [];
    allItems.push(...items);

    if (items.length < pageSize) {
      hasMore = false;
    } else {
      startIndex += pageSize;
    }
  }

  return allItems;
}

type SourceVariation = {
  productCode: string;
  variationProductCode: string;
  options: Array<{ attributeFQN: string; value: string }>;
};

type MigrationStatus =
  | "migrated"
  | "already_set"
  | "conflict_existing_code"
  | "not_found_in_destination"
  | "error";

type SummaryRow = {
  productCode: string;
  variationProductCode: string;
  destVariationKey: string;
  optionTuple: string;
  status: MigrationStatus;
  error: string;
};

// Read the export CSV and group rows by productCode -> variations[]
// (each variation aggregates one row per option)
function loadSourceVariations(): Map<string, SourceVariation[]> {
  const filePath = path.join(exportDir, inputFileName);
  if (!fs.existsSync(filePath)) {
    logger.error({ filePath }, "Source CSV not found");
    return new Map();
  }

  const csvContent = fs.readFileSync(filePath, "utf-8");
  const rows: Array<Record<string, string>> = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });

  const byProduct = new Map<string, Map<string, SourceVariation>>();
  for (const row of rows) {
    const productCode = row.productCode;
    const variationProductCode = row.variationProductCode;
    const attributeFQN = row.attributeFQN;
    const value = row.value ?? "";
    if (!productCode || !variationProductCode || !attributeFQN) continue;

    if (!byProduct.has(productCode)) {
      byProduct.set(productCode, new Map());
    }
    const inner = byProduct.get(productCode)!;
    if (!inner.has(variationProductCode)) {
      inner.set(variationProductCode, {
        productCode,
        variationProductCode,
        options: [],
      });
    }
    inner.get(variationProductCode)!.options.push({ attributeFQN, value });
  }

  const result = new Map<string, SourceVariation[]>();
  for (const [productCode, inner] of byProduct) {
    result.set(productCode, Array.from(inner.values()));
  }
  logger.info(
    { productCount: result.size, rowCount: rows.length },
    `Read ${inputFileName}`,
  );
  return result;
}

// Migrate variation codes for a single parent product. Performs one paged GET
// against the destination to learn the destination's variationkey values,
// matches each source variation by its option tuple, then sends a single bulk
// PUT carrying only { variationkey, variationProductCode } per item.
async function migrateOneProduct(
  variationsClient: ProductVariationsApi,
  productCode: string,
  sourceVariations: SourceVariation[],
  summary: SummaryRow[],
): Promise<void> {
  let destVariations: ProductVariation[];
  try {
    destVariations = await fetchAllPages<ProductVariation>((startIndex) =>
      variationsClient.getProductVariations({
        productCode,
        pageSize,
        startIndex,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { productCode, error: message },
      "Failed to fetch destination variations",
    );
    for (const sv of sourceVariations) {
      summary.push({
        productCode,
        variationProductCode: sv.variationProductCode,
        destVariationKey: "",
        optionTuple: tupleKey(sv.options),
        status: "error",
        error: message,
      });
    }
    return;
  }

  // Build destination lookup keyed by canonical option tuple. We do NOT
  // filter by variationkey here because inactive variations can come back
  // with a null variationkey (the system assigns it when isActive flips to
  // true) and we still need to match those so we can activate them.
  type DestEntry = {
    variationkey: string;
    currentCode: string;
    options: NonNullable<ProductVariation["options"]>;
    isActive: boolean;
  };
  const destByTuple = new Map<string, DestEntry>();
  for (const dv of destVariations) {
    if (!dv.options || dv.options.length === 0) continue;
    const key = tupleKey(
      dv.options.map((o) => ({
        attributeFQN: o.attributeFQN || "",
        value: semanticValue(o),
      })),
    );
    destByTuple.set(key, {
      variationkey: dv.variationkey || "",
      currentCode: dv.variationProductCode || "",
      options: dv.options,
      isActive: dv.isActive === true,
    });
  }

  const items: ProductVariation[] = [];
  const pendingSummary: SummaryRow[] = [];

  for (const sv of sourceVariations) {
    const key = tupleKey(sv.options);
    const dest = destByTuple.get(key);
    if (!dest) {
      pendingSummary.push({
        productCode,
        variationProductCode: sv.variationProductCode,
        destVariationKey: "",
        optionTuple: key,
        status: "not_found_in_destination",
        error: "",
      });
      continue;
    }
    // Already fully migrated: same code AND already active
    if (dest.currentCode === sv.variationProductCode && dest.isActive) {
      pendingSummary.push({
        productCode,
        variationProductCode: sv.variationProductCode,
        destVariationKey: dest.variationkey,
        optionTuple: key,
        status: "already_set",
        error: "",
      });
      continue;
    }
    // Destination already has a different variationProductCode set. Per the
    // schema, variationProductCode becomes read-only after the merchant
    // supplies it, so we skip rather than risk an error.
    if (dest.currentCode && dest.currentCode !== sv.variationProductCode) {
      pendingSummary.push({
        productCode,
        variationProductCode: sv.variationProductCode,
        destVariationKey: dest.variationkey,
        optionTuple: key,
        status: "conflict_existing_code",
        error: `Destination already set to '${dest.currentCode}'`,
      });
      continue;
    }
    // Include options[] so the server can match the row even when the
    // destination variationkey is null (inactive variations). Setting
    // isActive=true activates the variation in the same call.
    const item: ProductVariation = {
      options: dest.options,
      variationProductCode: sv.variationProductCode,
      isActive: true,
    };
    if (dest.variationkey) item.variationkey = dest.variationkey;
    items.push(item);
    pendingSummary.push({
      productCode,
      variationProductCode: sv.variationProductCode,
      destVariationKey: dest.variationkey,
      optionTuple: key,
      status: "migrated",
      error: "",
    });
  }

  if (items.length === 0) {
    summary.push(...pendingSummary);
    logger.info(
      {
        productCode,
        sourceCount: sourceVariations.length,
        destCount: destVariations.length,
      },
      "No variations to write for product",
    );
    return;
  }

  try {
    await variationsClient.updateProductVariations({
      productCode,
      productVariationCollection: { items },
    });
    summary.push(...pendingSummary);
    logger.info(
      { productCode, written: items.length, total: sourceVariations.length },
      "Updated product variations",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const row of pendingSummary) {
      if (row.status === "migrated") {
        row.status = "error";
        row.error = message;
      }
    }
    summary.push(...pendingSummary);
    logger.error(
      { productCode, error: message },
      "PUT updateProductVariations failed",
    );
  }
}

async function importProductVariations() {
  const variationsClient = new ProductVariationsApi(configuration);
  const sourceMap = loadSourceVariations();
  if (sourceMap.size === 0) return;

  const summary: SummaryRow[] = [];
  for (const [productCode, sourceVariations] of sourceMap) {
    await limiter.schedule(() =>
      migrateOneProduct(
        variationsClient,
        productCode,
        sourceVariations,
        summary,
      ),
    );
  }

  const csvContent = stringify(summary, {
    header: true,
    columns: [
      "productCode",
      "variationProductCode",
      "destVariationKey",
      "optionTuple",
      "status",
      "error",
    ],
  });

  const summaryPath = path.join(exportDir, summaryFileName);
  fs.writeFileSync(summaryPath, csvContent, "utf-8");

  const tally = summary.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  logger.info({ summaryPath, tally }, "Migration summary written");
}

async function main() {
  logger.info(
    `Importing product variation codes into Tenant: ${process.env.TENANT_ID}`,
  );
  await importProductVariations();
  logger.info("*** Tenant product variations import complete! 👍🏽 ***");
}

main();
