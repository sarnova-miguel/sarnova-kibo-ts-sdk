import Bottleneck from "bottleneck";
import * as dotenv from "dotenv";
import pino from "pino";
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
        destination: "./logs/delete-sandbox-products.log",
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

// delete products from master catalog
async function deleteProducts() {
  const masterCatalogId = process.env.MASTER_CATALOG || "1";

  // Create a configuration specifically for master catalog operations
  // Setting 'catalog' and 'siteId' to undefined ensures those headers are not sent,
  // so API calls will operate at the master catalog level without site/child catalog context
  const masterCatalogConfiguration = new Configuration({
    tenantId: process.env.TENANT_ID || "",
    siteId: undefined, // No site context for master catalog operations
    catalog: undefined, // No child catalog context
    masterCatalog: masterCatalogId,
    sharedSecret: process.env.SHARED_SECRET || "",
    clientId: process.env.CLIENT_ID || "",
    pciHost: process.env.PCI_HOST || "",
    authHost: process.env.AUTH_HOST || "",
    apiEnv: process.env.API_ENV || "",
  });

  const productClient = new ProductsApi(masterCatalogConfiguration);

  logger.info({ masterCatalogId }, "Starting master catalog products deletion...");

  try {
    let totalDeleted = 0;
    let hasMoreProducts = true;

    while (hasMoreProducts) {
      // Get products from master catalog in batches
      const productsResponse = await productClient.getProducts({
        pageSize,
        startIndex: 0, // Always get from the beginning since we're deleting
      });

      const products = productsResponse.items || [];
      const productsCount = products.length;

      logger.info({
        count: productsCount,
        totalDeleted,
        masterCatalogId
      }, "Found products in master catalog batch");

      if (productsCount === 0) {
        logger.info("No more products found in master catalog to delete");
        hasMoreProducts = false;
        break;
      }

      for (const product of products) {
        if (!product.productCode) {
          logger.warn({
            productName: product.content?.productName
          }, "Product has no productCode, skipping");
          continue;
        }

        // Use limiter to rate-limit API calls
        await limiter.schedule(async () => {
          try {
            // deleteProduct removes the product from the master catalog entirely
            await productClient.deleteProduct({
              productCode: product.productCode!,
            });
            logger.info({
              productCode: product.productCode,
              productName: product.content?.productName,
              masterCatalogId
            }, "Deleted product from master catalog");
            totalDeleted++;
          } catch (error) {
            logger.error({
              productCode: product.productCode,
              productName: product.content?.productName,
              masterCatalogId,
              error: error instanceof Error ? error.message : String(error),
            }, "Error deleting product from master catalog");
          }
        });
      }

      logger.info({
        batchDeleted: productsCount,
        totalDeleted,
        masterCatalogId
      }, "Completed master catalog batch deletion");

      // If we got fewer products than the page size, we're done
      if (productsCount < pageSize) {
        hasMoreProducts = false;
      }
    }

    logger.info({ totalDeleted, masterCatalogId }, "All master catalog products deleted successfully");
  } catch (error) {
    logger.error({
      masterCatalogId,
      error: error instanceof Error ? error.message : String(error),
    }, "Error in deleteProducts");
  }
}

// delete categories
async function deleteCategories() {
  const categoryClient = new CategoriesApi(configuration);

  logger.info("Starting categories deletion...");

  try {
    let totalDeleted = 0;
    let hasMoreCategories = true;

    while (hasMoreCategories) {
      // Get categories in batches
      const categoriesResponse = await categoryClient.getCategories({
        pageSize,
        startIndex: 0, // Always get from the beginning since we're deleting
      });

      const categories = categoriesResponse.items || [];
      const categoriesCount = categories.length;

      logger.info({
        count: categoriesCount,
        totalDeleted
      }, "Found categories in this batch");

      if (categoriesCount === 0) {
        logger.info("No more categories found to delete");
        hasMoreCategories = false;
        break;
      }

      // Delete categories in reverse order (children first, then parents)
      // This ensures we don't have orphaned categories
      const reversedCategories = [...categories].reverse();

      for (const category of reversedCategories) {
        if (!category.id) {
          logger.warn({ categoryName: category.content?.name }, "Category has no ID, skipping");
          continue;
        }

        // Use limiter to rate-limit API calls
        await limiter.schedule(async () => {
          try {
            await categoryClient.deleteCategoryById({
              categoryId: category.id!,
              cascadeDelete: true, // Delete child categories if any
            });
            logger.info({
              categoryId: category.id,
              categoryName: category.content?.name,
              categoryCode: category.categoryCode,
            }, "Deleted category");
            totalDeleted++;
          } catch (error) {
            logger.error({
              categoryId: category.id,
              categoryName: category.content?.name,
              categoryCode: category.categoryCode,
              error: error instanceof Error ? error.message : String(error),
            }, "Error deleting category");
          }
        });
      }

      logger.info({
        batchDeleted: categoriesCount,
        totalDeleted
      }, "Completed batch deletion");

      // If we got fewer categories than the page size, we're done
      if (categoriesCount < pageSize) {
        hasMoreCategories = false;
      }
    }

    logger.info({ totalDeleted }, "All categories deleted successfully");
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, "Error in deleteCategories");
  }
}

// delete product types
async function deleteProductTypes() {
  const productTypeClient = new ProductTypesApi(configuration);

  logger.info("Starting product types deletion...");

  try {
    let totalDeleted = 0;
    let hasMoreProductTypes = true;

    while (hasMoreProductTypes) {
      // Get product types in batches
      const productTypesResponse = await productTypeClient.getProductTypes({
        pageSize,
        startIndex: 0, // Always get from the beginning since we're deleting
      });

      const productTypes = productTypesResponse.items || [];
      const productTypesCount = productTypes.length;

      logger.info({
        count: productTypesCount,
        totalDeleted
      }, "Found product types in this batch");

      if (productTypesCount === 0) {
        logger.info("No more product types found to delete");
        hasMoreProductTypes = false;
        break;
      }

      for (const productType of productTypes) {
        if (!productType.id) {
          logger.warn({ productTypeName: productType.name }, "Product type has no ID, skipping");
          continue;
        }

        // Skip the Base product type
        if (productType.name === "Base" || productType.name?.toLowerCase() === "base") {
          logger.info({
            productTypeId: productType.id,
            productTypeName: productType.name
          }, "Skipping Base product type");
          continue;
        }

        // Use limiter to rate-limit API calls
        await limiter.schedule(async () => {
          try {
            await productTypeClient.deleteProductType({
              productTypeId: productType.id!,
            });
            logger.info({
              productTypeId: productType.id,
              productTypeName: productType.name,
            }, "Deleted product type");
            totalDeleted++;
          } catch (error) {
            logger.error({
              productTypeId: productType.id,
              productTypeName: productType.name,
              error: error instanceof Error ? error.message : String(error),
            }, "Error deleting product type");
          }
        });
      }

      logger.info({
        batchDeleted: productTypesCount,
        totalDeleted
      }, "Completed batch deletion");

      // If we got fewer product types than the page size, we're done
      if (productTypesCount < pageSize) {
        hasMoreProductTypes = false;
      }
    }

    logger.info({ totalDeleted }, "All product types deleted successfully");
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, "Error in deleteProductTypes");
  }
}

// delete product attributes
async function deleteProductAttributes() {
  const productAttributeClient = new ProductAttributesApi(configuration);

  // System attributes that should not be deleted
  const systemAttributeCodes = [
    "allow-auto-substitutions",
    "availability",
    "product-crosssell",
    "hide-product",
    "popularity",
    "price-list-entry-type",
    "rating",
    "product-related",
    "substitute-products",
    "substitute-variants",
    "sales-rank-long-term",
    "sales-rank-medium-term",
    "sales-rank-short-term",
    "product-upsell"
  ];

  logger.info("Starting product attributes deletion...");

  try {
    let totalDeleted = 0;
    let totalSkipped = 0;
    let hasMoreAttributes = true;

    while (hasMoreAttributes) {
      // Get product attributes in batches
      const attributesResponse = await productAttributeClient.getAttributes({
        pageSize,
        startIndex: 0, // Always get from the beginning since we're deleting
      });

      const attributes = attributesResponse.items || [];
      const attributesCount = attributes.length;

      logger.info({
        count: attributesCount,
        totalDeleted,
        totalSkipped
      }, "Found product attributes in this batch");

      if (attributesCount === 0) {
        logger.info("No more product attributes found to delete");
        hasMoreAttributes = false;
        break;
      }

      for (const attribute of attributes) {
        if (!attribute.attributeFQN) {
          logger.warn({
            attributeCode: attribute.attributeCode,
            adminName: attribute.adminName
          }, "Product attribute has no attributeFQN, skipping");
          continue;
        }

        // Skip system attributes
        if (attribute.attributeCode && systemAttributeCodes.includes(attribute.attributeCode)) {
          logger.info({
            attributeFQN: attribute.attributeFQN,
            attributeCode: attribute.attributeCode,
            adminName: attribute.adminName
          }, "Skipping system attribute");
          totalSkipped++;
          continue;
        }

        // Use limiter to rate-limit API calls
        await limiter.schedule(async () => {
          try {
            await productAttributeClient.deleteAttribute({
              attributeFQN: attribute.attributeFQN!,
            });
            logger.info({
              attributeFQN: attribute.attributeFQN,
              attributeCode: attribute.attributeCode,
              adminName: attribute.adminName,
            }, "Deleted product attribute");
            totalDeleted++;
          } catch (error) {
            logger.error({
              attributeFQN: attribute.attributeFQN,
              attributeCode: attribute.attributeCode,
              adminName: attribute.adminName,
              error: error instanceof Error ? error.message : String(error),
            }, "Error deleting product attribute");
          }
        });
      }

      logger.info({
        batchDeleted: attributesCount,
        totalDeleted,
        totalSkipped
      }, "Completed batch deletion");

      // If we got fewer attributes than the page size, we're done
      if (attributesCount < pageSize) {
        hasMoreAttributes = false;
      }
    }

    logger.info({
      totalDeleted,
      totalSkipped
    }, "All product attributes deleted successfully");
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, "Error in deleteProductAttributes");
  }
}




// ***** ready functions *****
async function main() {
    await deleteProducts();
    await deleteCategories();
    await deleteProductTypes();
    await deleteProductAttributes();
    logger.info('*** Products, Categories, Prod Types, Prod Attributes deletion complete!👍🏽 ***');
}


main();