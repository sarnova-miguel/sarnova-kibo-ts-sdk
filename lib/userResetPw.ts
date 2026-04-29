import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import {
  CustomerAccountApi,
  CustomerResetPasswordInfo,
  ConfirmationInfo,
} from "@kibocommerce/rest-sdk/clients/Customer";

dotenv.config();

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/user-reset-pw.log",
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

/**
 * Resets the password for an existing user.
 * Compares the newPassword and confirmPassword strings; if they do not match, returns an error.
 * If they match, calls the Kibo Commerce Reset Password API to trigger a password reset,
 * then calls Update Forgotten Password to set the new password.
 *
 * @param email - The user's email address
 * @param newPassword - The new password
 * @param confirmPassword - Confirmation of the new password
 */
async function resetPassword(
  email: string,
  newPassword: string,
  confirmPassword: string,
) {
  logger.info("resetPassword running...");

  // Validate that passwords match
  if (newPassword !== confirmPassword) {
    const errorMsg = "Passwords do not match.";
    logger.error({ email }, errorMsg);
    throw new Error(errorMsg);
  }

  const CustomerAccountClient = new CustomerAccountApi(configuration);

  try {
    // Step 1: Trigger a password reset email for the user
    const customerResetPasswordInfo: CustomerResetPasswordInfo = {
      emailAddress: email,
    };

    await CustomerAccountClient.resetPassword({
      customerResetPasswordInfo,
    });

    logger.info({ email }, "Password reset request sent successfully");

    // Step 2: Update the forgotten password with the new password
    // Note: In a real flow, the confirmationCode comes from the reset email.
    // For this script, supply the confirmation code from the email to complete the reset.
    const confirmationInfo: ConfirmationInfo = {
      userName: email,
      confirmationCode: "", // Populate with the code from the reset email
      newPassword: newPassword,
    };

    await CustomerAccountClient.updateForgottenPassword({
      confirmationInfo,
    });

    logger.info({ email }, "Password updated successfully");
  } catch (error) {
    logger.error({ error, email }, "Failed to reset password");
    throw error;
  }
}

// Run with hardcoded test values
const testEmail = "janedoe@testing.com";
const testPassword = "newPassword123";
resetPassword(testEmail, testPassword, testPassword).catch((err) => {
  logger.error({ err }, "resetPassword failed");
});
