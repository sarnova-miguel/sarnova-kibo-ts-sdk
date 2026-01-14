import { Configuration } from "@kibocommerce/rest-sdk";
// import {ProductsApi} from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductsApi.js";
import {ProductAttributesApi} from "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductAttributesApi.js";
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
    apiEnv: process.env.API_ENV || ""
});

async function main(){
    const productAttributtesClient = new ProductAttributesApi(configuration);

    try {
        const attributes = await productAttributtesClient.getAttributes();
        console.log('attributes: ', attributes);
    } catch (error) {
        console.error(error);
    }

}

main()
