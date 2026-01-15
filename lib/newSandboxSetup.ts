import { Configuration } from "@kibocommerce/rest-sdk";
import { ChannelApi } from "@kibocommerce/rest-sdk/clients/Commerce/apis/ChannelApi";
import { GeneralSettingsApi } from "@kibocommerce/rest-sdk/clients/Settings/apis/GeneralSettingsApi";
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

async function createChannels() {
  const channelClient = new ChannelApi(configuration);
  const channels = [
    {
      code: "online",
      name: "online",
      countryCode: "US",
    },
    {
      code: "phone",
      name: "phone",
      countryCode: "US",
    },
    {
      code: "crm",
      name: "crm",
      countryCode: "US",
    },
  ];

  try {
    for (const channelData of channels) {
      const createdChannel = await channelClient.createChannel({
        channel: channelData,
      });
      console.log(`Created channel: ${createdChannel.code}`, createdChannel);
    }
  } catch (error) {
    console.error("Error creating channels:", error);
  }
}

// create catalogs - manual only?

// create sites - manual only?

// update general settings
const generalSettings = {
    "websiteName": process.env.WEBSITE_NAME || "Dev",
    "siteTimeZone": "Central Standard Time",
    "siteTimeFormat": "hh:mm:ss tt",
    "senderEmailAddress": process.env.EMAIL_ADDRESS || "websupport@sarnova.com",
    "replyToEmailAddress": process.env.EMAIL_ADDRESS || "websupport@sarnova.com",
    "isGoogleAnalyticsEnabled": true,
    "isWishlistCreationEnabled": true,
    "isMultishipEnabled": false,
    "isAddressValidationEnabled": true,
    "allowInvalidAddresses": false,
}

async function updateGeneralSettings() {
    const settingsClient = new GeneralSettingsApi(configuration);
    try {
        const updatedSettings = await settingsClient.updateGeneralSettings({
            generalSettings,
        });
        console.log(updatedSettings);
    } catch (error) {
        console.error(error);
    }
}

// update payment gateway / NoOp - manual only?

// update payment types;  select Amex & Visa CCs with NoOp, check by mail = false, purchase order = true, purchase order options - manual only?




// ***** ready functions *****
// createChannels();
// updateGeneralSettings();
