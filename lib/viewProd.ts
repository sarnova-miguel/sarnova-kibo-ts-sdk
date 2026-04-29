import Bottleneck from "bottleneck";
import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import { ProductsApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductsApi";

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/view-product.log",
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
//   catalog: process.env.CATALOG || "",
  masterCatalog: process.env.MASTER_CATALOG || "",
  sharedSecret: process.env.SHARED_SECRET || "",
  clientId: process.env.CLIENT_ID || "",
  pciHost: process.env.PCI_HOST || "",
  authHost: process.env.AUTH_HOST || "",
  apiEnv: process.env.API_ENV || "",
});

/**
 * Get a single product by productCode
 * @param productCode - The unique product code to retrieve
 * @returns The product object or null if not found
 */
async function getProductByCode(productCode: string) {
  const productClient = new ProductsApi(configuration);

  logger.info({ productCode }, "Fetching product by code...");

  try {
    const product = await limiter.schedule(async () => {
      return await productClient.getProduct({
        productCode,
      });
    });

    logger.info({
      productCode: product.productCode,
      productName: product.content?.productName,
      productTypeId: product.productTypeId,
    }, "Successfully retrieved product");

    return product;
  } catch (error) {
    logger.error({
      productCode,
      error: error instanceof Error ? error.message : String(error),
      fullError: error
    }, "Error fetching product");
    return null;
  }
}

/**
 * Main function to demonstrate usage
 */
async function main() {
  // Get a specific product by code
  const productCode = "999"; // Replace with actual product code
  const product = await getProductByCode(productCode);

  if (product) {
    const altText = product.content?.productImages?.[0]?.altText;
    const { bt, ths, aedss } = altText ? JSON.parse(altText) : {};
    console.log("\n=== Product Details ===");
    console.log(`Product Code: ${product.productCode}`);
    console.log(`Product Name: ${product.content?.productName}`);
    console.log(`Product Type ID: ${product.productTypeId}`);
    console.log(`Price: ${product.price?.price}`);
    console.log(`Sale Price: ${product.price?.salePrice}`);
    console.log(`BoundTree img altText: ${bt}`);
    console.log(`THS img altText: ${ths}`);
    console.log(`AED SS img altText: ${aedss}`);
  }
}

// Run the main function
main().catch((error) => {
  logger.error({
    error: error instanceof Error ? error.message : String(error),
  }, "Error in main function");
  process.exit(1);
});
