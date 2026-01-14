import { Configuration } from "@kibocommerce/rest-sdk";
import { ChannelApi } from "@kibocommerce/rest-sdk/clients/Commerce/apis/ChannelApi";
import * as dotenv from "dotenv";

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

// create new channels
async function getChannels() {
  const channelClient = new ChannelApi(configuration);
  try {
    const channels = await channelClient.getChannels();
    console.log(channels);
  } catch (error) {
    console.error(error);
  }
}

async function createChannel() {
  const channelClient = new ChannelApi(configuration);
  const channels = [
    {
      tenantId: process.env.TENANT_ID,
      code: "online",
      name: "online",
      countryCode: "US",
      siteIds: [],
    },
    {
      tenantId: process.env.TENANT_ID,
      code: "phone",
      name: "phone",
      countryCode: "US",
      siteIds: [],
    },
    {
      tenantId: process.env.TENANT_ID,
      code: "crm",
      name: "crm",
      countryCode: "US",
      siteIds: [],
    },
  ];
  try {
    const channel = await channelClient.createChannel({
      channel: {
        name: "My Channel",
        code: "my-channel",
      },
    });
    console.log(channel);
  } catch (error) {
    console.error(error);
  }
}

// create catalogs

// create sites

// update general settings

// update payment gateway / NoOp

// update payment types;  select Amex & Visa CCs with NoOp, check by mail = false, purchase order = true, purchase order options

getChannels();
