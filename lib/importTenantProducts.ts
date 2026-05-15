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

// Import categories
async function importCategories() {
  const client = new CategoriesApi(configuration);
  const items = readCsv("categories.csv");
  logger.info({ count: items.length }, "Importing categories...");

  // Map to store created category IDs by category name
  const categoryMap = new Map<string, number>();

  try {
    // First pass: create all top-level categories (no parent)
    logger.info("Creating top-level categories");
    for (const categoryData of items) {
      if (!categoryData.parentCategoryName) {
        await limiter.schedule(async () => {
          try {
            const created = await client.addCategory({
              catalogAdminsCategory: categoryData,
            });
            logger.info(
              {
                categoryName: created.content?.name,
                categoryId: created.id,
              },
              "Created top-level category",
            );
            if (created.id && created.content?.name) {
              categoryMap.set(created.content.name, created.id);
            }
          } catch (error) {
            logger.error(
              {
                categoryName: categoryData.content?.name,
                error: error instanceof Error ? error.message : String(error),
              },
              "Error creating top-level category",
            );
          }
        });
      }
    }

    // Second pass: create child categories
    logger.info("Creating child categories");
    for (const categoryData of items) {
      if (categoryData.parentCategoryName) {
        await limiter.schedule(async () => {
          try {
            const parentCategoryId = categoryMap.get(
              categoryData.parentCategoryName,
            );

            if (!parentCategoryId) {
              logger.error(
                {
                  parentCategoryName: categoryData.parentCategoryName,
                  categoryName: categoryData.content?.name,
                },
                "Parent category not found for category",
              );
              return;
            }

            const categoryWithParent = {
              ...categoryData,
              parentCategoryId,
            };

            const created = await client.addCategory({
              catalogAdminsCategory: categoryWithParent,
            });
            logger.info(
              {
                categoryName: created.content?.name,
                categoryId: created.id,
                parentCategoryName: categoryData.parentCategoryName,
              },
              "Created child category",
            );
            if (created.id && created.content?.name) {
              categoryMap.set(created.content.name, created.id);
            }
          } catch (error) {
            logger.error(
              {
                categoryName: categoryData.content?.name,
                error: error instanceof Error ? error.message : String(error),
              },
              "Error creating child category",
            );
          }
        });
      }
    }

    logger.info("All categories imported successfully");
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error in importCategories",
    );
  }
}

// Import products
async function importProducts() {
  const productClient = new ProductsApi(configuration);
  const productTypeClient = new ProductTypesApi(configuration);
  const items = readCsv("products.csv");
  logger.info({ count: items.length }, "Importing products...");

  // Read product types from CSV to build a map of old ID -> name
  const csvProductTypes = readCsv("productTypes.csv");
  const oldTypeIdToNameMap = new Map<number, string>();
  for (const pt of csvProductTypes) {
    if (pt.id && pt.name) {
      oldTypeIdToNameMap.set(Number(pt.id), String(pt.name));
    }
  }

  // Read categories from CSV to build a map of old category ID -> categoryCode
  const csvCategories = readCsv("categories.csv");
  const oldCatIdToCodeMap = new Map<number, string>();
  for (const cat of csvCategories) {
    if (cat.id && cat.categoryCode) {
      oldCatIdToCodeMap.set(Number(cat.id), String(cat.categoryCode));
    }
  }

  try {
    // Get newly entered product types from Kibo to map new product type IDs
    const productTypeResponse = await productTypeClient.getProductTypes({
      pageSize,
      startIndex: 0,
    });
    const productTypes = productTypeResponse.items || [];

    // Get newly created categories from Kibo to map categoryCode -> new category ID
    const categoryClient = new CategoriesApi(configuration);
    const categoryResponse = await categoryClient.getCategories({
      pageSize,
      startIndex: 0,
    });
    const kiboCategories = categoryResponse.items || [];
    const codeToNewCatIdMap = new Map<string, number>();
    for (const cat of kiboCategories) {
      if (cat.categoryCode && cat.id) {
        codeToNewCatIdMap.set(cat.categoryCode, cat.id);
      }
    }

    for (const productData of items) {
      await limiter.schedule(async () => {
        try {
          // Match the product type name from the CSV to the newly created product type ID
          const oldProductTypeId = Number(productData.productTypeId);
          const prodTypeName = oldTypeIdToNameMap.get(oldProductTypeId);
          const prodTypeId = productTypes.find(
            (pt) => pt.name === prodTypeName,
          )?.id;
          productData.productTypeId = prodTypeId || 1;

          // Remap old category IDs to new category IDs in productInCatalogs
          if (Array.isArray(productData.productInCatalogs)) {
            for (const catalog of productData.productInCatalogs) {
              // Remap productCategories
              if (Array.isArray(catalog.productCategories)) {
                for (const pc of catalog.productCategories) {
                  const oldCatId = Number(pc.categoryId);
                  const catCode = oldCatIdToCodeMap.get(oldCatId);
                  if (catCode) {
                    const newCatId = codeToNewCatIdMap.get(catCode);
                    if (newCatId) {
                      pc.categoryId = newCatId;
                    }
                  }
                }
              }
              // Remap primaryProductCategory
              if (catalog.primaryProductCategory?.categoryId) {
                const oldCatId = Number(
                  catalog.primaryProductCategory.categoryId,
                );
                const catCode = oldCatIdToCodeMap.get(oldCatId);
                if (catCode) {
                  const newCatId = codeToNewCatIdMap.get(catCode);
                  if (newCatId) {
                    catalog.primaryProductCategory.categoryId = newCatId;
                  }
                }
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
    logger.info("All products imported successfully");
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error in importProducts",
    );
  }
}

async function main() {
  logger.info(
    `Importing products to Tenant: ${process.env.TENANT_ID} Master Catalog`,
  );
  await importProductAttributes();
  await importProductTypes();
  await importCategories();
  await importProducts();
  logger.info("*** Tenant product data import complete! 👍🏽 ***");
}

main();
