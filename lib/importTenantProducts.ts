import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import pino from "pino";
import Bottleneck from "bottleneck";
import { parse } from "csv/sync";
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
        destination: "./logs/import-tenant-products.log",
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

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 500,
});

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

// Read a CSV file and return parsed rows as an array of objects
function readCsv(fileName: string): Record<string, any>[] {
  const filePath = path.join(exportDir, fileName);
  if (!fs.existsSync(filePath)) {
    logger.error({ filePath }, "CSV file not found");
    return [];
  }
  const csvContent = fs.readFileSync(filePath, "utf-8");
  const rows: Record<string, string>[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });
  logger.info({ filePath, rowCount: rows.length }, `Read ${fileName}`);
  return rows.map((row) => unflattenObject(row));
}

// Reverse of flattenObject: convert dot-notation keys back into nested objects
function unflattenObject(row: Record<string, string>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of Object.keys(row)) {
    const value = row[key];
    const parts = key.split(".");
    let current = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    const lastKey = parts[parts.length - 1];
    current[lastKey] = parseValue(value);
  }
  return result;
}

// Convert a value to an array: handles actual arrays, numeric-keyed objects from unflattenObject, or returns empty array
function toArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length > 0 && keys.every((k) => /^[0-9]+$/.test(k))) {
      return keys.sort((a, b) => Number(a) - Number(b)).map((k) => value[k]);
    }
  }
  return [];
}

// Parse a CSV string value back to its original type
function parseValue(value: string): any {
  if (value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  // Try to parse as JSON (for arrays and objects)
  if (
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("{") && value.endsWith("}"))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  // Try to parse as number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") {
    return num;
  }
  return value;
}

// Import product attributes
async function importProductAttributes() {
  const client = new ProductAttributesApi(configuration);
  const items = readCsv("productAttributes.csv");
  logger.info({ count: items.length }, "Importing product attributes...");

  try {
    for (const attributeData of items) {
      await limiter.schedule(async () => {
        try {
          const created = await client.addAttribute({
            catalogAdminsAttribute: attributeData,
          });
          logger.info(
            { attributeCode: created.attributeCode },
            "Created product attribute",
          );
        } catch (error) {
          logger.error(
            {
              attributeCode: attributeData.attributeCode,
              error: error instanceof Error ? error.message : String(error),
            },
            "Error creating product attribute",
          );
        }
      });
    }
    logger.info("All product attributes imported successfully");
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error in importProductAttributes",
    );
  }
}

// Import product types
async function importProductTypes() {
  const client = new ProductTypesApi(configuration);
  const items = readCsv("productTypes.csv");
  logger.info({ count: items.length }, "Importing product types...");

  try {
    for (const productTypeData of items) {
      // Skip the base product type as it already exists
      if (productTypeData.name?.toLowerCase() === "base") {
        logger.info(
          { productTypeName: productTypeData.name },
          "Skipping base product type",
        );
        continue;
      }
      await limiter.schedule(async () => {
        try {
          const created = await client.addProductType({
            productType: productTypeData,
          });
          logger.info(
            { productTypeName: created.name },
            "Created product type",
          );
        } catch (error) {
          logger.error(
            {
              productTypeName: productTypeData.name,
              error: error instanceof Error ? error.message : String(error),
            },
            "Error creating product type",
          );
        }
      });
    }
    logger.info("All product types imported successfully");
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error in importProductTypes",
    );
  }
}

// Import categories for every catalog present in categories.csv. Each catalog has an
// independent category ID and categoryCode namespace, so categories are created
// per-catalog and returned as Map<catalogId, Map<categoryCode, newCategoryId>>.
// On a "category already exists" error the destination tenant has stale data: the
// underlying createCategoriesForCatalog throws CategoryAlreadyExistsError, which
// main() catches to abort the import cleanly.
async function importCategories(
  catalogIdToSiteIdMap: Map<number, number>,
): Promise<Map<number, Map<string, number>>> {
  const csvCategories = readCsv("categories.csv");
  const uniqueCatalogIds = [
    ...new Set(
      csvCategories
        .map((c) => Number(c.catalogId))
        .filter((n) => !Number.isNaN(n)),
    ),
  ];
  logger.info(
    { uniqueCatalogIds, totalRows: csvCategories.length },
    "Importing categories for all catalogs in CSV",
  );

  const codeToNewIdByCatalog = new Map<number, Map<string, number>>();
  for (const catalogId of uniqueCatalogIds) {
    const siteId = catalogIdToSiteIdMap.get(catalogId);
    if (!siteId) {
      logger.error(
        { catalogId },
        "No siteId found for catalogId, skipping category creation",
      );
      continue;
    }
    const map = await createCategoriesForCatalog(
      catalogId,
      siteId,
      csvCategories,
    );
    codeToNewIdByCatalog.set(catalogId, map);
  }
  logger.info(
    { catalogCount: codeToNewIdByCatalog.size },
    "All categories imported successfully",
  );
  return codeToNewIdByCatalog;
}

// Thrown when a category code already exists in a destination catalog. Categories in
// Kibo are not inherited from the master catalog and each catalog has its own
// categoryCode namespace, so this error indicates the destination tenant was not
// fully cleaned before re-importing. Caught in main() to abort the whole import.
class CategoryAlreadyExistsError extends Error {
  constructor(
    public catalogId: number,
    public categoryCode: string,
  ) {
    super(
      `Category code "${categoryCode}" already exists in catalog ${catalogId}`,
    );
    this.name = "CategoryAlreadyExistsError";
  }
}

// Build a Configuration scoped to a specific catalog/site
function makeCatalogConfig(catalogId: number, siteId: number): Configuration {
  return new Configuration({
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
}

// Create categories in a specific catalog and return a map of categoryCode -> new category ID.
// Filters CSV rows to this catalog and creates them in two passes (top-level, then children).
// On a duplicate-code error we warn, stop this catalog's pass, and throw
// CategoryAlreadyExistsError so the orchestrator can abort the import.
async function createCategoriesForCatalog(
  catalogId: number,
  siteId: number,
  csvCategories: Record<string, any>[],
): Promise<Map<string, number>> {
  const client = new CategoriesApi(makeCatalogConfig(catalogId, siteId));
  const nameToNewId = new Map<string, number>();
  const codeToNewId = new Map<string, number>();
  const rows = csvCategories.filter((c) => Number(c.catalogId) === catalogId);

  logger.info(
    { catalogId, count: rows.length },
    "Creating categories for catalog",
  );

  const passes: Array<{ label: string; isChild: boolean }> = [
    { label: "top-level", isChild: false },
    { label: "child", isChild: true },
  ];

  for (const { label, isChild } of passes) {
    for (const categoryData of rows) {
      const rowIsChild = !!categoryData.parentCategoryName;
      if (rowIsChild !== isChild) continue;

      // Shallow copy so we don't mutate the shared CSV row; drop source-tenant id
      // so Kibo assigns a fresh one. parentCategoryId is set explicitly below.
      const payload: Record<string, any> = { ...categoryData };
      delete payload.id;

      if (isChild) {
        const parentCategoryId = nameToNewId.get(
          categoryData.parentCategoryName,
        );
        if (!parentCategoryId) {
          logger.error(
            {
              catalogId,
              parentCategoryName: categoryData.parentCategoryName,
              categoryName: categoryData.content?.name,
            },
            "Parent category not found for catalog category",
          );
          continue;
        }
        payload.parentCategoryId = parentCategoryId;
      }

      try {
        const created = await limiter.schedule(() =>
          client.addCategory({ catalogAdminsCategory: payload }),
        );
        logger.info(
          {
            catalogId,
            categoryName: created.content?.name,
            categoryCode: created.categoryCode,
            categoryId: created.id,
            parentCategoryName: categoryData.parentCategoryName,
          },
          `Created ${label} category for catalog`,
        );
        if (created.id && created.content?.name) {
          nameToNewId.set(created.content.name, created.id);
        }
        if (created.id && created.categoryCode) {
          codeToNewId.set(created.categoryCode, created.id);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/already exists/i.test(msg)) {
          logger.warn(
            {
              catalogId,
              categoryCode: categoryData.categoryCode,
              categoryName: categoryData.content?.name,
              error: msg,
            },
            "Category code already exists in destination catalog - stopping catalog pass and aborting import",
          );
          throw new CategoryAlreadyExistsError(
            catalogId,
            String(categoryData.categoryCode),
          );
        }
        logger.error(
          {
            catalogId,
            categoryName: categoryData.content?.name,
            categoryCode: categoryData.categoryCode,
            error: msg,
          },
          `Error creating ${label} category for catalog`,
        );
      }
    }
  }

  logger.info(
    {
      catalogId,
      mappedCodes: codeToNewId.size,
      codeIdPairs: Object.fromEntries(codeToNewId),
    },
    "Finished creating categories for catalog",
  );
  return codeToNewId;
}

type RemapReport = {
  remapped: Array<{
    field: string;
    oldId: number;
    code: string;
    newId: number;
  }>;
  skipped: Array<{
    field: string;
    oldId: number;
    reason: string;
    code?: string;
  }>;
};

// Remap category IDs in a catalog entry using the provided categoryCode -> newCatId map.
// Returns a report listing every remap performed and every ID that could not be remapped,
// so callers can log exactly what was sent to the API.
function remapCatalogCategories(
  catalog: Record<string, any>,
  oldCatIdToCodeMap: Map<number, string>,
  codeToNewCatIdMap: Map<string, number>,
): RemapReport {
  const report: RemapReport = { remapped: [], skipped: [] };

  const remapOne = (field: string, container: Record<string, any>) => {
    const oldCatId = Number(container.categoryId);
    if (!oldCatId || Number.isNaN(oldCatId)) {
      report.skipped.push({
        field,
        oldId: container.categoryId,
        reason: "missing or invalid categoryId",
      });
      return;
    }
    const catCode = oldCatIdToCodeMap.get(oldCatId);
    if (!catCode) {
      report.skipped.push({
        field,
        oldId: oldCatId,
        reason: "no categoryCode found for old categoryId in source-tenant map",
      });
      return;
    }
    const newCatId = codeToNewCatIdMap.get(catCode);
    if (!newCatId) {
      report.skipped.push({
        field,
        oldId: oldCatId,
        code: catCode,
        reason:
          "no new categoryId found for categoryCode in destination catalog",
      });
      return;
    }
    container.categoryId = newCatId;
    report.remapped.push({
      field,
      oldId: oldCatId,
      code: catCode,
      newId: newCatId,
    });
  };

  // Remap productCategories
  const categories = toArray(catalog.productCategories);
  if (categories.length > 0) {
    catalog.productCategories = categories;
    for (const pc of categories) {
      remapOne("productCategories", pc);
    }
  }
  // Remap primaryProductCategory
  if (catalog.primaryProductCategory?.categoryId) {
    remapOne("primaryProductCategory", catalog.primaryProductCategory);
  }
  return report;
}

// Import products in a single pass. All destination categories must already be created
// for every catalog referenced in productInCatalogs, so the categoryCode -> newCategoryId
// map for each catalog (codeToNewIdByCatalog) is passed in by main(). Every catalog entry
// in productInCatalogs is remapped before addProduct is called.
async function importProducts(
  codeToNewIdByCatalog: Map<number, Map<string, number>>,
) {
  const productClient = new ProductsApi(configuration);
  const productTypeClient = new ProductTypesApi(configuration);
  const items = readCsv("products.csv");
  logger.info({ count: items.length }, "Importing products...");

  // Build map of source product type ID -> name to resolve new product type IDs
  const csvProductTypes = readCsv("productTypes.csv");
  const oldTypeIdToNameMap = new Map<number, string>();
  for (const pt of csvProductTypes) {
    if (pt.id && pt.name) {
      oldTypeIdToNameMap.set(Number(pt.id), String(pt.name));
    }
  }

  // Build per-catalog map of source category ID -> categoryCode. Each catalog has its
  // own ID space so productInCatalogs entries are remapped using the map for their
  // own catalog.
  const csvCategories = readCsv("categories.csv");
  const oldCatIdToCodeMapByCatalog = new Map<number, Map<number, string>>();
  for (const cat of csvCategories) {
    if (cat.id && cat.categoryCode && cat.catalogId != null) {
      const catId = Number(cat.catalogId);
      if (!oldCatIdToCodeMapByCatalog.has(catId)) {
        oldCatIdToCodeMapByCatalog.set(catId, new Map());
      }
      oldCatIdToCodeMapByCatalog
        .get(catId)!
        .set(Number(cat.id), String(cat.categoryCode));
    }
  }

  try {
    const productTypeResponse = await productTypeClient.getProductTypes({
      pageSize,
      startIndex: 0,
    });
    const productTypes = productTypeResponse.items || [];

    for (const productData of items) {
      await limiter.schedule(async () => {
        try {
          // Resolve new product type ID via name lookup
          const oldProductTypeId = Number(productData.productTypeId);
          const prodTypeName = oldTypeIdToNameMap.get(oldProductTypeId);
          const prodTypeId = productTypes.find(
            (pt) => pt.name === prodTypeName,
          )?.id;
          productData.productTypeId = prodTypeId || 1;

          // Remap categoryIds in every catalog entry of productInCatalogs
          const catalogs = toArray(productData.productInCatalogs);
          if (catalogs.length > 0) {
            productData.productInCatalogs = catalogs;
            for (const entry of catalogs) {
              const catId = Number(entry.catalogId);
              const oldMap = oldCatIdToCodeMapByCatalog.get(catId);
              const newMap = codeToNewIdByCatalog.get(catId);
              const hasCategories =
                entry.primaryProductCategory ||
                toArray(entry.productCategories).length > 0;
              if (!oldMap || !newMap) {
                if (hasCategories) {
                  logger.warn(
                    {
                      productCode: productData.productCode,
                      catalogId: catId,
                      hasOldMap: !!oldMap,
                      hasNewMap: !!newMap,
                    },
                    "No category maps available for catalog - entry will be sent with source-tenant IDs",
                  );
                }
                continue;
              }
              const report = remapCatalogCategories(entry, oldMap, newMap);
              if (report.remapped.length > 0 || report.skipped.length > 0) {
                logger.info(
                  {
                    productCode: productData.productCode,
                    catalogId: catId,
                    remapped: report.remapped,
                    skipped: report.skipped,
                  },
                  "Category remap details",
                );
              }
              if (report.skipped.length > 0) {
                logger.warn(
                  {
                    productCode: productData.productCode,
                    catalogId: catId,
                    skipped: report.skipped,
                  },
                  "Some category IDs could not be remapped",
                );
              }
            }
          }

          const created = await productClient.addProduct({
            catalogAdminsProduct: productData,
          });
          logger.info(
            {
              productCode: created.productCode,
              productName: created.content?.productName,
            },
            "Created product",
          );
        } catch (error) {
          logger.error(
            {
              productCode: productData.productCode,
              productName: productData.content?.productName,
              error: error instanceof Error ? error.message : String(error),
            },
            "Error creating product",
          );
        }
      });
    }
    logger.info("DONE importing products!");
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error in importProducts",
    );
  }
}

// Build map of catalogId -> siteId from the tenant. Used to authenticate per-catalog
// API calls when creating categories in each catalog.
async function buildCatalogSiteMap(): Promise<Map<number, number>> {
  const tenantsClient = new TenantsApi(configuration);
  const tenant = await tenantsClient.getTenant({
    tenantId: Number(process.env.TENANT_ID),
  });
  const map = new Map<number, number>();
  for (const site of tenant.sites || []) {
    if (site.catalogId != null && site.id != null && !map.has(site.catalogId)) {
      map.set(site.catalogId, site.id);
    }
  }
  logger.info(
    { catalogSiteMap: Object.fromEntries(map) },
    "Built catalogId -> siteId map from tenant",
  );
  return map;
}

async function main() {
  logger.info(
    `Importing products to Tenant: ${process.env.TENANT_ID} Master Catalog`,
  );
  await importProductAttributes();
  await importProductTypes();
  try {
    const catalogIdToSiteIdMap = await buildCatalogSiteMap();
    const codeToNewIdByCatalog = await importCategories(catalogIdToSiteIdMap);
    await importProducts(codeToNewIdByCatalog);
  } catch (error) {
    if (error instanceof CategoryAlreadyExistsError) {
      logger.error(
        {
          catalogId: error.catalogId,
          categoryCode: error.categoryCode,
        },
        "Aborting import: stale categories detected in destination tenant. Delete leftover categories before retrying.",
      );
      return;
    }
    throw error;
  }
  logger.info("*** Tenant product data import complete! 👍🏽 ***");
}

main();
