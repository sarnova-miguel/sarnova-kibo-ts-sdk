/**
 * This script creates a new user, adds a password and logins the user in.
 * If the user exists, then it simply logs the user in.
 */
import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import {
  CustomerAccountApi,
  StorefrontAuthTicketApi,
  CustomerAccount,
  CustomerLoginInfo,
  CustomerUserAuthInfo,
} from "@kibocommerce/rest-sdk/clients/Customer";

dotenv.config();

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/user-login.log",
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

const newUser = {
  firstName: "Miguel",
  lastNameOrSurname: "Ramos",
  email: "miguel.ramos@sarnova.com",
  password: "password123",
};

async function main() {
  logger.info("userLogin running...");

  const CustomerAccountClient = new CustomerAccountApi(configuration);
  const StorefrontAuthClient = new StorefrontAuthTicketApi(configuration);

  try {
    // Check if a customer account already exists for this email
    const existingAccounts = await CustomerAccountClient.getAccounts({
      filter: `emailAddress eq '${newUser.email}'`,
      pageSize: 1,
    });

    const existingAccount = existingAccounts.items?.[0];

    if (existingAccount) {
      logger.info(
        { customerAccountId: existingAccount.id },
        "Customer account already exists — skipping to login",
      );
    } else {
      // Step 1: Create the customer account
      const customerAccount: CustomerAccount = {
        emailAddress: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastNameOrSurname,
        userName: newUser.email,
      };

      const createdCustomerAccount = await CustomerAccountClient.addAccount({
        customerAccount,
      });
      const customerAccountId = createdCustomerAccount.id;
      logger.info({ customerAccountId }, "Created customer account");

      // Step 2: Add login credentials (password) to the account
      if (customerAccountId) {
        const customerLoginInfo: CustomerLoginInfo = {
          emailAddress: newUser.email,
          username: newUser.email,
          password: newUser.password,
        };

        await CustomerAccountClient.addLoginToExistingCustomer({
          accountId: customerAccountId,
          customerLoginInfo,
        });
        logger.info(
          { customerAccountId },
          "Added login credentials — account is now a registered shopper",
        );
      }
    }

    // Step 3: Log in the user via POST /commerce/customer/authtickets
    const customerUserAuthInfo: CustomerUserAuthInfo = {
      username: newUser.email,
      password: newUser.password,
    };

    const userAuthTicket = await StorefrontAuthClient.createUserAuthTicket({
      customerUserAuthInfo,
    });

    const userToken = userAuthTicket?.jwtAccessToken;
    const userId = userAuthTicket?.customerAccount?.userId;
    logger.info(
      {
        customerAccountId: userAuthTicket?.customerAccount?.id,
        userId,
        tokenPreview: userToken?.substring(0, 30) + "...",
      },
      "User logged in successfully",
    );
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error in userLogin",
    );
  }
}

main();
