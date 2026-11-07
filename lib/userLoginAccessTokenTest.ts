import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import {
  StorefrontAuthTicketApi,
  CustomerUserAuthInfo,
} from "@kibocommerce/rest-sdk/clients/Customer";

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

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/user-login-access-token-test.log",
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

const user = {
  email: "miguel.ramos@sarnova.com",
  password: "password123",
};

async function main() {
  const StorefrontAuthClient = new StorefrontAuthTicketApi(configuration);

  const customerUserAuthInfo: CustomerUserAuthInfo = {
    username: user.email,
    password: user.password,
  };

  try {
    logger.info("---------STEP 1---------");
    const userAuthTicket1 = await StorefrontAuthClient.createUserAuthTicket({
      customerUserAuthInfo,
    });

    logger.info(
      {
        accessToken: userAuthTicket1.jwtAccessToken,
        accessTokenExpiration: userAuthTicket1.accessTokenExpiration,
        refreshToken: userAuthTicket1.refreshToken,
        refreshTokenExpiration: userAuthTicket1.refreshTokenExpiration,
      },
      "User logged in successfully (ticket 1)",
    );

    logger.info("Waiting 15 seconds before step 2...");
    await new Promise((resolve) => setTimeout(resolve, 15_000));

    // Log in again to get a second auth ticket
    logger.info("---------STEP 2---------");
    const userAuthTicket2 = await StorefrontAuthClient.createUserAuthTicket({
      customerUserAuthInfo,
    });

    logger.info(
      {
        accessToken: userAuthTicket2.jwtAccessToken,
        accessTokenExpiration: userAuthTicket2.accessTokenExpiration,
        refreshToken: userAuthTicket2.refreshToken,
        refreshTokenExpiration: userAuthTicket2.refreshTokenExpiration,
      },
      "User logged in successfully (ticket 2)",
    );

    logger.info("Waiting 15 seconds before step 3...");
    await new Promise((resolve) => setTimeout(resolve, 15_000));

    logger.info("---------STEP 3---------");
    // Refresh using the refresh token from step 1
    const refreshedTicket = await StorefrontAuthClient.refreshUserAuthTicket({
      refreshToken: userAuthTicket1.refreshToken ?? undefined,
    });

    logger.info(
      {
        accessToken: refreshedTicket.jwtAccessToken,
        accessTokenExpiration: refreshedTicket.accessTokenExpiration,
        refreshToken: refreshedTicket.refreshToken,
        refreshTokenExpiration: refreshedTicket.refreshTokenExpiration,
      },
      "User authenticated via refresh token (ticket 3)",
    );
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : error },
      "Login failed",
    );
  }
}

main();
