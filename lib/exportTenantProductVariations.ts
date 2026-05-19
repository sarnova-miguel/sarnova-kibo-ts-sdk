import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import pino from "pino";
import Bottleneck from "bottleneck";
import { stringify } from "csv/sync";
import { Configuration } from "@kibocommerce/rest-sdk";
import { ProductsApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductsApi";
import { ProductVariationsApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductVariationsApi";

const pageSize = 200;

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/export-tenant-product-variations.log",
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
  minTime: 250,
});

const exportDir = path.join(__dirname, "..", "exports");
const outputFileName = "productVariations.csv";

// Ensure exports directory exists
function ensureExportDir() {
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
    logger.info({ exportDir }, "Created exports directory");
  }
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

// Resolve the semantic, cross-tenant-stable representation of an option value.
// Prefers localized stringValue (the human-readable label), falling back to
// the raw value coerced to a string. This is the field used to match
// variations across tenants where valueSequence numbers are regenerated.
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

// Fetch all parent productCodes that have configurable options
async function fetchConfigurableProductCodes(): Promise<string[]> {
  const productsClient = new ProductsApi(configuration);
  logger.info("Fetching products with hasConfigurableOptions eq true...");

  const products = await fetchAllPages<{ productCode?: string | null }>(
    (startIndex) =>
      productsClient.getProducts({
        pageSize,
        startIndex,
        filter: "hasConfigurableOptions eq true",
      }),
  );

  const codes: string[] = [];
  for (const p of products) {
    if (p.productCode) codes.push(p.productCode);
  }
  logger.info({ count: codes.length }, "Configurable parent products fetched");
  return codes;
}

// Export all variations for the given parent products into a CSV
async function exportProductVariations(productCodes: string[]) {
  const variationsClient = new ProductVariationsApi(configuration);
  const rows: Record<string, string>[] = [];
  let variationsTotal = 0;
  let variationsWithCode = 0;

  for (const productCode of productCodes) {
    await limiter.schedule(async () => {
      try {
        const variations = await fetchAllPages((startIndex) =>
          variationsClient.getProductVariations({
            productCode,
            pageSize,
            startIndex,
          }),
        );

        variationsTotal += variations.length;
        for (const v of variations) {
          if (!v.variationProductCode) continue;
          const options = v.options || [];
          if (options.length === 0) continue;
          variationsWithCode++;
          for (const opt of options) {
            rows.push({
              productCode,
              variationProductCode: v.variationProductCode,
              attributeFQN: opt.attributeFQN || "",
              value: semanticValue(opt),
            });
          }
        }

        logger.info(
          { productCode, variationCount: variations.length },
          "Fetched variations",
        );
      } catch (error) {
        logger.error(
          {
            productCode,
            error: error instanceof Error ? error.message : String(error),
          },
          "Error fetching variations",
        );
      }
    });
  }

  if (rows.length === 0) {
    logger.warn("No variation rows to export");
    return;
  }

  const csvContent = stringify(rows, {
    header: true,
    columns: ["productCode", "variationProductCode", "attributeFQN", "value"],
  });

  const filePath = path.join(exportDir, outputFileName);
  fs.writeFileSync(filePath, csvContent, "utf-8");
  logger.info(
    {
      filePath,
      rowCount: rows.length,
      productCount: productCodes.length,
      variationsTotal,
      variationsWithCode,
    },
    `Exported ${outputFileName}`,
  );
}

async function main() {
  logger.info(
    `Exporting product variations from Tenant: ${process.env.TENANT_ID}`,
  );
  ensureExportDir();
  const productCodes = await fetchConfigurableProductCodes();
  await exportProductVariations(productCodes);
  logger.info("*** Tenant product variations export complete! 👍🏽 ***");
}

main();
