import Bottleneck from "bottleneck";
import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import { ProductAttributesApi } from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductAttributesApi";

dotenv.config();

const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/add-subscription-attributes.log",
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

const limiter = new Bottleneck({
  minTime: 200,
  maxConcurrent: 1,
});

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

const subscriptionAttributes = [
  {
    adminName: "Subscription Mode",
    namespace: "system",
    attributeCode: "subscription-mode",
    attributeFQN: "system~subscription-mode",
    inputType: "List",
    valueType: "Predefined",
    dataType: "String",
    isOption: false,
    isExtra: false,
    isProperty: true,
    availableForOrderRouting: false,
    content: {
      localeCode: "en-US",
      name: "Subscription Mode",
      description:
        "Defines if a product is for subscription only or subscription and one time purchase.",
    },
    vocabularyValues: [
      {
        value: "SO",
        content: { localeCode: "en-US", stringValue: "Subscription Only" },
        displayOrder: 1,
      },
      {
        value: "SAOT",
        content: {
          localeCode: "en-US",
          stringValue: "Subscription and one-time purchase",
        },
        displayOrder: 2,
      },
    ],
    searchSettings: {
      searchableInStorefront: false,
      searchableInAdmin: true,
      searchDisplayValue: true,
      allowFilteringAndSortingInStorefront: false,
    },
  },
  {
    adminName: "Subscription Frequency",
    namespace: "system",
    attributeCode: "subscription-frequency",
    attributeFQN: "system~subscription-frequency",
    inputType: "List",
    valueType: "Predefined",
    dataType: "String",
    isOption: false,
    isExtra: false,
    isProperty: true,
    availableForOrderRouting: false,
    content: {
      localeCode: "en-US",
      name: "Subscription Frequency",
      description:
        "Defines the frequencies available for customers to select for their subscriptions.",
    },
    vocabularyValues: [
      { value: "D15", content: { localeCode: "en-US", stringValue: "15 Days" }, displayOrder: 1 },
      { value: "D30", content: { localeCode: "en-US", stringValue: "30 Days" }, displayOrder: 2 },
      { value: "D45", content: { localeCode: "en-US", stringValue: "45 Days" }, displayOrder: 3 },
      { value: "D60", content: { localeCode: "en-US", stringValue: "60 Days" }, displayOrder: 4 },
      { value: "D90", content: { localeCode: "en-US", stringValue: "90 Days" }, displayOrder: 5 },
      { value: "D100", content: { localeCode: "en-US", stringValue: "100 Days" }, displayOrder: 6 },
      { value: "W1", content: { localeCode: "en-US", stringValue: "1 week" }, displayOrder: 7 },
      { value: "W2", content: { localeCode: "en-US", stringValue: "2 weeks" }, displayOrder: 8 },
      { value: "W3", content: { localeCode: "en-US", stringValue: "3 weeks" }, displayOrder: 9 },
      { value: "W4", content: { localeCode: "en-US", stringValue: "4 weeks" }, displayOrder: 10 },
      { value: "M1", content: { localeCode: "en-US", stringValue: "1 month" }, displayOrder: 11 },
      { value: "M2", content: { localeCode: "en-US", stringValue: "2 months" }, displayOrder: 12 },
      { value: "M3", content: { localeCode: "en-US", stringValue: "3 months" }, displayOrder: 13 },
      { value: "M4", content: { localeCode: "en-US", stringValue: "4 months" }, displayOrder: 14 },
      { value: "M5", content: { localeCode: "en-US", stringValue: "5 months" }, displayOrder: 15 },
      { value: "M6", content: { localeCode: "en-US", stringValue: "6 months" }, displayOrder: 16 },
      { value: "M7", content: { localeCode: "en-US", stringValue: "7 months" }, displayOrder: 17 },
      { value: "M8", content: { localeCode: "en-US", stringValue: "8 months" }, displayOrder: 18 },
      { value: "M9", content: { localeCode: "en-US", stringValue: "9 months" }, displayOrder: 19 },
      { value: "M10", content: { localeCode: "en-US", stringValue: "10 months" }, displayOrder: 20 },
      { value: "M11", content: { localeCode: "en-US", stringValue: "11 months" }, displayOrder: 21 },
      { value: "M12", content: { localeCode: "en-US", stringValue: "12 months" }, displayOrder: 22 },
    ],
    searchSettings: {
      searchableInStorefront: false,
      searchableInAdmin: true,
      searchDisplayValue: true,
      allowFilteringAndSortingInStorefront: true,
    },
  },
  {
    adminName: "Trial Days",
    namespace: "system",
    attributeCode: "subscription-trial-days",
    attributeFQN: "system~subscription-trial-days",
    inputType: "TextBox",
    valueType: "AdminEntered",
    dataType: "Number",
    isOption: false,
    isExtra: false,
    isProperty: true,
    availableForOrderRouting: false,
    content: {
      localeCode: "en-US",
      name: "Trial Days",
      description: "Number of trial days for subscription.",
    },
    validation: {
      minNumericValue: 1.0,
      maxNumericValue: 365.0,
    },
    searchSettings: {
      searchableInStorefront: false,
      searchableInAdmin: true,
      searchDisplayValue: false,
      allowFilteringAndSortingInStorefront: false,
    },
  },
  {
    adminName: "Trial Product Code",
    namespace: "system",
    attributeCode: "subscription-trial-productCode",
    attributeFQN: "system~subscription-trial-productCode",
    inputType: "TextBox",
    valueType: "AdminEntered",
    dataType: "String",
    isOption: false,
    isExtra: false,
    isProperty: true,
    availableForOrderRouting: false,
    content: {
      localeCode: "en-US",
      name: "Trial Product Code",
      description: "Trial product code.",
    },
    searchSettings: {
      searchableInStorefront: false,
      searchableInAdmin: true,
      searchDisplayValue: true,
      allowFilteringAndSortingInStorefront: true,
    },
  },
  {
    adminName: "Trial Product Variation Code",
    namespace: "system",
    attributeCode: "subscription-trial-variantCode",
    attributeFQN: "system~subscription-trial-variantCode",
    inputType: "TextBox",
    valueType: "AdminEntered",
    dataType: "String",
    isOption: false,
    isExtra: false,
    isProperty: true,
    availableForOrderRouting: false,
    content: {
      localeCode: "en-US",
      name: "Trial Product Variation Code",
      description: "Trial Product Variation Code.",
    },
    searchSettings: {
      searchableInStorefront: false,
      searchableInAdmin: true,
      searchDisplayValue: true,
      allowFilteringAndSortingInStorefront: true,
    },
  },
  {
    adminName: "Split Extras In Subscriptions",
    namespace: "system",
    attributeCode: "split-extras-in-subscriptions",
    attributeFQN: "system~split-extras-in-subscriptions",
    inputType: "YesNo",
    valueType: "AdminEntered",
    dataType: "Bool",
    isOption: false,
    isExtra: false,
    isProperty: true,
    availableForOrderRouting: false,
    content: {
      localeCode: "en-US",
      name: "Split Extras In Subscriptions",
      description: "Split Extras In Subscriptions system attribute",
    },
    searchSettings: {
      searchableInStorefront: false,
      searchableInAdmin: true,
      searchDisplayValue: false,
      allowFilteringAndSortingInStorefront: false,
    },
  },
];

async function addSubscriptionAttributes() {
  const productAttributeClient = new ProductAttributesApi(configuration);

  logger.info(`Starting subscription attributes creation for tenant ID: ${process.env.TENANT_ID}`);

  for (const attributeData of subscriptionAttributes) {
    await limiter.schedule(async () => {
      try {
        const created = await productAttributeClient.addAttribute({
          catalogAdminsAttribute: attributeData,
        });
        logger.info(
          { attributeCode: created.attributeCode },
          "Created subscription attribute"
        );
      } catch (error: any) {
        // 409 = attribute already exists
        if (error?.response?.status === 409) {
          logger.warn(
            { attributeCode: attributeData.attributeCode },
            "Attribute already exists, skipping"
          );
        } else {
          logger.error(
            {
              attributeCode: attributeData.attributeCode,
              error: error instanceof Error ? error.message : String(error),
            },
            "Error creating attribute"
          );
        }
      }
    });
  }

  logger.info("Subscription attributes creation complete!");
}

addSubscriptionAttributes();
