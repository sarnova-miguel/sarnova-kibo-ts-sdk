import Bottleneck from "bottleneck";
import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import { ProductAttributesApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductAttributesApi";
import { ProductTypesApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductTypesApi";
import { CategoriesApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/CategoriesApi";

import productAttributesData from "./data/productAttributes.json";
import productTypesData from "./data/productTypes.json";
import productCategoriesData from "./data/productCategories.json";

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/add-sandbox-products.log",
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
  transport
);

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 500
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

const productAttributes = productAttributesData;
const productTypes = productTypesData;
const productCategories = productCategoriesData;

// create product attributes
async function createProductAttributes() {
  const productAttributeClient = new ProductAttributesApi(configuration);

  logger.info("Starting product attributes creation...");

  try {
    for (const attributeData of productAttributes) {
      // Use limiter to rate-limit API calls
      await limiter.schedule(async () => {
        try {
          const createdAttribute = await productAttributeClient.addAttribute({
            catalogAdminsAttribute: attributeData,
          });
          logger.info({
            attributeCode: createdAttribute.attributeCode,
          }, "Created product attribute");
        } catch (error) {
          logger.error({
            attributeCode: attributeData.attributeCode,
            error: error instanceof Error ? error.message : String(error),
          }, "Error creating attribute");
        }
      });
    }
    logger.info("All product attributes created successfully");
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, "Error in createProductAttributes");
  }
}

// create product types
async function createProductTypes() {
  const productTypeClient = new ProductTypesApi(configuration);

  logger.info("Starting product types creation...");

  try {
    for (const productTypeData of productTypes) {
      // Use limiter to rate-limit API calls
      await limiter.schedule(async () => {
        try {
          const createdProductType = await productTypeClient.addProductType({
            productType: productTypeData,
          });
          logger.info({
            productTypeName: createdProductType.name,
          }, "Created product type");
        } catch (error) {
          logger.error({
            productTypeName: productTypeData.name,
            error: error instanceof Error ? error.message : String(error),
          }, "Error creating product type");
        }
      });
    }
    logger.info("All product types created successfully");
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, "Error in createProductTypes");
  }
}

// create categories
async function createCategories() {
  const categoryClient = new CategoriesApi(configuration);

  // Map to store created category IDs by category name
  const categoryMap = new Map<string, number>();

  logger.info("Starting categories creation...");

  try {
    // First pass: create all top-level categories (no parent)
    logger.info("Creating top-level categories");
    for (const categoryData of productCategories) {
      if (!categoryData.parentCategoryName) {
        await limiter.schedule(async () => {
          try {
            const createdCategory = await categoryClient.addCategory({
              catalogAdminsCategory: categoryData,
            });
            logger.info({
              categoryName: createdCategory.content?.name,
              categoryId: createdCategory.id,
            }, "Created top-level category");
            // Store the category ID for later reference
            if (createdCategory.id && createdCategory.content?.name) {
              categoryMap.set(createdCategory.content.name, createdCategory.id);
            }
          } catch (error) {
            logger.error({
              categoryName: categoryData.content?.name,
              error: error instanceof Error ? error.message : String(error),
            }, "Error creating category");
          }
        });
      }
    }

    // Second pass: create child categories
    logger.info("Creating child categories");
    for (const categoryData of productCategories) {
      if (categoryData.parentCategoryName) {
        await limiter.schedule(async () => {
          try {
            // Get parent category ID from the map
            const parentCategoryId = categoryMap.get(categoryData.parentCategoryName);

            if (!parentCategoryId) {
              logger.error({
                parentCategoryName: categoryData.parentCategoryName,
                categoryName: categoryData.content?.name,
              }, "Parent category not found for category");
              return;
            }

            // Add parent category ID to the category data
            const categoryWithParent = {
              ...categoryData,
              parentCategoryId: parentCategoryId,
            };

            const createdCategory = await categoryClient.addCategory({
              catalogAdminsCategory: categoryWithParent,
            });
            logger.info({
              categoryName: createdCategory.content?.name,
              categoryId: createdCategory.id,
              parentCategoryName: categoryData.parentCategoryName,
            }, "Created child category");
            // Store the category ID for potential nested children
            if (createdCategory.id && createdCategory.content?.name) {
              categoryMap.set(createdCategory.content.name, createdCategory.id);
            }
          } catch (error) {
            logger.error({
              categoryName: categoryData.content?.name,
              error: error instanceof Error ? error.message : String(error),
            }, "Error creating category");
          }
        });
      }
    }

    logger.info("All categories created successfully");
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, "Error in createCategories");
  }
}

// create products





// ***** ready functions *****
async function main() {
    await createProductAttributes();
    await createProductTypes();
    await createCategories();
    logger.info('*** Products load process complete!👍🏽 ***');
}


main();