import Bottleneck from "bottleneck";
import { Configuration } from "@kibocommerce/rest-sdk";
import { ProductAttributesApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductAttributesApi";
import * as dotenv from "dotenv";
import productAttributesData from "./data/productAttributes.json";

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

// create product attributes
const productAttributes = productAttributesData;

async function createProductAttributes() {
  const productAttributeClient = new ProductAttributesApi(configuration);

  try {
    for (const attributeData of productAttributes) {
      // Use limiter to rate-limit API calls
      await limiter.schedule(async () => {
        try {
          const createdAttribute = await productAttributeClient.addAttribute({
            catalogAdminsAttribute: attributeData,
          });
          console.log(
            `Created product attribute: ${createdAttribute.attributeCode}`
          );
        } catch (error) {
          console.error(
            `Error creating attribute ${attributeData.attributeCode}:`,
            error
          );
        }
      });
    }
    console.log("All product attributes created successfully");
  } catch (error) {
    console.error("Error in createProductAttributes:", error);
  }
}

// create product types

// create categories

// create products





// ***** ready functions *****
createProductAttributes();
