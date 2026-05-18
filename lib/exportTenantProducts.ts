import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import pino from "pino";
import { stringify } from "csv/sync";
import { Configuration } from "@kibocommerce/rest-sdk";
import { ProductAttributesApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductAttributesApi";
import { ProductTypesApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductTypesApi";
import { CategoriesApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/CategoriesApi";
import { ProductsApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductsApi";
import { TenantsApi } from "@kibocommerce/rest-sdk/clients/Tenant/apis/TenantsApi";

const pageSize = 200;

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/export-tenant-products.log",
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

const exportDir = path.join(__dirname, "..", "exports");

// Ensure exports directory exists
function ensureExportDir() {
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
    logger.info({ exportDir }, "Created exports directory");
  }
}

// Flatten a nested object into dot-notation keys for CSV columns
function flattenObject(
  obj: Record<string, any>,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, fullKey));
    } else if (Array.isArray(value)) {
      result[fullKey] = JSON.stringify(value);
    } else {
      result[fullKey] = value == null ? "" : String(value);
    }
  }
  return result;
}

// Convert an array of objects to CSV and write to file
function writeCsv(fileName: string, items: Record<string, any>[]) {
  if (items.length === 0) {
    logger.warn({ fileName }, "No items to export");
    return;
  }

  const flattened = items.map((item) => flattenObject(item));

  // Collect all unique columns across all rows
  const columnsSet = new Set<string>();
  for (const row of flattened) {
    for (const key of Object.keys(row)) {
      columnsSet.add(key);
    }
  }
  const columns = Array.from(columnsSet);

  const csvContent = stringify(flattened, {
    header: true,
    columns,
  });

  const filePath = path.join(exportDir, fileName);
  fs.writeFileSync(filePath, csvContent, "utf-8");
  logger.info({ filePath, rowCount: items.length }, `Exported ${fileName}`);
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

    logger.info(
      {
        fetched: items.length,
        totalSoFar: allItems.length,
        totalCount: response.totalCount,
      },
      "Fetched page",
    );

    if (items.length < pageSize) {
      hasMore = false;
    } else {
      startIndex += pageSize;
    }
  }

  return allItems;
}

// Export product attributes
async function exportProductAttributes() {
  const client = new ProductAttributesApi(configuration);
  logger.info("Fetching product attributes...");

  try {
    const items = await fetchAllPages((startIndex) =>
      client.getAttributes({ pageSize, startIndex }),
    );

    writeCsv("productAttributes.csv", items);
    logger.info({ count: items.length }, "Product attributes export complete");
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error exporting product attributes",
    );
  }
}

// Export categories from every catalog in the tenant.
// Each catalog (master + children) has its own category ID space, and product
// entries in productInCatalogs reference IDs from their own catalog, so all
// catalogs' categories must be exported for the import to remap correctly.
async function exportCategories() {
  const tenantsClient = new TenantsApi(configuration);
  logger.info("Fetching categories from all catalogs in tenant...");

  try {
    const tenant = await tenantsClient.getTenant({
      tenantId: Number(process.env.TENANT_ID),
    });

    // Map each unique catalogId to a siteId that can be used to authenticate calls
    const catalogIdToSiteIdMap = new Map<number, number>();
    for (const site of tenant.sites || []) {
      if (
        site.catalogId != null &&
        site.id != null &&
        !catalogIdToSiteIdMap.has(site.catalogId)
      ) {
        catalogIdToSiteIdMap.set(site.catalogId, site.id);
      }
    }
    logger.info(
      { catalogSiteMap: Object.fromEntries(catalogIdToSiteIdMap) },
      "Built catalogId -> siteId map from tenant",
    );

    const allCategories: Record<string, any>[] = [];
    for (const [catalogId, siteId] of catalogIdToSiteIdMap) {
      const catalogConfig = new Configuration({
        tenantId: process.env.TENANT_ID || "",
        siteId: String(siteId),
        catalog: String(catalogId),
        masterCatalog: process.env.MASTER_CATALOG || "",
        sharedSecret: process.env.SHARED_SECRET || "",
        clientId: process.env.CLIENT_ID || "",
        pciHost: process.env.PCI_HOST || "",
        authHost: process.env.AUTH_HOST || "",
        apiEnv: process.env.API_ENV || "",
      });
      const client = new CategoriesApi(catalogConfig);
      const items = await fetchAllPages((startIndex) =>
        client.getCategories({ pageSize, startIndex }),
      );
      logger.info(
        { catalogId, count: items.length },
        "Fetched categories for catalog",
      );
      allCategories.push(...(items as Record<string, any>[]));
    }

    writeCsv("categories.csv", allCategories);
    logger.info({ count: allCategories.length }, "Categories export complete");
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error exporting categories",
    );
  }
}

// Export products
async function exportProducts() {
  const client = new ProductsApi(configuration);
  logger.info("Fetching products...");

  try {
    const items = await fetchAllPages((startIndex) =>
      client.getProducts({ pageSize, startIndex }),
    );

    writeCsv("products.csv", items);
    logger.info({ count: items.length }, "Products export complete");
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error exporting products",
    );
  }
}

// Export product types
async function exportProductTypes() {
  const client = new ProductTypesApi(configuration);
  logger.info("Fetching product types...");

  try {
    const items = await fetchAllPages((startIndex) =>
      client.getProductTypes({ pageSize, startIndex }),
    );

    writeCsv("productTypes.csv", items);
    logger.info({ count: items.length }, "Product types export complete");
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error exporting product types",
    );
  }
}

async function main() {
  logger.info(`Exporting products from Tenant: ${process.env.TENANT_ID}`);
  ensureExportDir();
  await exportProductAttributes();
  await exportProductTypes();
  await exportCategories();
  await exportProducts();
  logger.info("*** Tenant product data export complete! 👍🏽 ***");
}

main();
