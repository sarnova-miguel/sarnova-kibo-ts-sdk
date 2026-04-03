import Bottleneck from "bottleneck";
import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import {
  CustomerAccountApi,
  StorefrontAuthTicketApi,
  CustomerAccount,
  CustomerLoginInfo,
} from "@kibocommerce/rest-sdk/clients/Customer";
import {
  CartApi,
  OrderApi,
  FulfillmentInfo,
  BillingInfo,
} from "@kibocommerce/rest-sdk/clients/Commerce";

dotenv.config();

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/cart-to-completed-order.log",
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

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 500,
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

const paymentsUrl = process.env.SANDBOX_PAYMENTS_ENDPOINT;
const newUser = {
  firstName: "Dave",
  lastNameOrSurname: "Chapelle",
  email: "dc@testing.com",
  phone: "215-555-4321",
};
const sandboxProduct = "DSP_001";

async function main() {
  logger.info("cartToCompletedOrder running...");

  const StorefrontAuthClient = new StorefrontAuthTicketApi(configuration);
  const CartClient = new CartApi(configuration);
  const OrderClient = new OrderApi(configuration);
  const CustomerAccountClient = new CustomerAccountApi(configuration);

  try {
    const tokenData =
      await StorefrontAuthClient.createAnonymousShopperAuthTicket();
    const anonToken = tokenData?.jwtAccessToken;
    logger.info({ tokenData }, `tokenData`);

    const headers: any = [
      ["Authorization", `Bearer ${anonToken}`],
      ["Content-Type", "application/json"],
      ["x-vol-site", process.env.SITE_ID],
      ["x-vol-tenant", process.env.TENANT_ID],
    ];

    // if anonymous user token, cart will not be assigned an id until an item is added

    const addedItemToCart = await CartClient.addItemToCart(
      { cartItem: { product: { productCode: sandboxProduct }, quantity: 1 } },
      { headers },
    );
    logger.info({ addedItemToCart }, `addedItemToCart`);

    // Get cart id, if anon cart
    const cartItemId = addedItemToCart.id;
    logger.info(`cartItemId: ${cartItemId}`);

    const currentCart = await CartClient.getOrCreateCart({}, { headers });

    const cartId = currentCart.id;

    if (cartId && cartItemId) {
      // convert cart to order
      const createOrder = await OrderClient.createOrder(
        { cartId },
        { headers },
      );
      const orderId = createOrder.id;

      if (orderId) {
        logger.info(`orderId: ${orderId}`);
        const fulfillmentInfo: FulfillmentInfo = {
          fulfillmentContact: {
            firstName: newUser.firstName,
            lastNameOrSurname: newUser.lastNameOrSurname,
            email: newUser.email,
            phoneNumbers: {
              home: newUser.phone,
              mobile: "",
              work: "",
            },
            address: {
              address1: "4670 ROUTE 42",
              address2: "",
              address3: "",
              address4: "",
              cityOrTown: "TURNERSVILLE",
              stateOrProvince: "NJ",
              postalOrZipCode: "08012-1764",
              countryCode: "US",
              addressType: "Residential",
              isValidated: true,
            },
          },
        };

        await OrderClient.setFulFillmentInfo(
          { orderId, fulfillmentInfo },
          { headers },
        );
        const availableShippingMethods =
          await OrderClient.getAvailableShipmentMethods(
            { orderId },
            { headers },
          );
        logger.info({ availableShippingMethods }, "availableShippingMethods");

        fulfillmentInfo.shippingMethodCode = "408233d0c1494ab8908fb3d100ea8224";
        fulfillmentInfo.shippingMethodName = "Flat Rate";

        await OrderClient.setFulFillmentInfo(
          { orderId, fulfillmentInfo },
          { headers },
        );

        // POST to payments endpoint to get a paymentServiceCardId
        const paymentCardResponse = await fetch(paymentsUrl!, {
          method: "POST",
          headers,
          body: JSON.stringify({
            cardNumber: "4111111111111111",
            cardholderName: "Jessica Alba",
            cardNumberPartOrMask: "************1111",
            cvv: "1234",
            cardType: "AMEX",
            isTokenized: true
          }),
        });

        if (!paymentCardResponse.ok) {
          throw new Error(
            `Payment service responded with status ${paymentCardResponse.status}`,
          );
        }

        const paymentCardData = (await paymentCardResponse.json()) as {
          id: string;
        };
        const paymentServiceCardId = paymentCardData.id;
        logger.info(
          { paymentServiceCardId },
          "Received paymentServiceCardId from payments service",
        );

        const billingInfo: BillingInfo = {
          paymentType: "CreditCard",
          paymentWorkflow: "Mozu",
          billingContact: {
            firstName: newUser.firstName,
            middleNameOrInitial: "",
            lastNameOrSurname: newUser.lastNameOrSurname,
            email: newUser.email,
            phoneNumbers: {
              home: newUser.phone,
              mobile: "",
              work: "",
            },
            address: {
              address1: "4670 ROUTE 42",
              address2: "",
              address3: "",
              address4: "",
              cityOrTown: "TURNERSVILLE",
              stateOrProvince: "NJ",
              postalOrZipCode: "08012-1764",
              countryCode: "US",
              addressType: "Residential",
              isValidated: true,
            },
          },
          isSameBillingShippingAddress: true,
          card: {
            paymentServiceCardId,
            isUsedRecurring: false,
            nameOnCard: `${newUser.firstName} ${newUser.lastNameOrSurname}`,
            isCardInfoSaved: false,
            isTokenized: false,
            paymentOrCardType: "AMEX",
            cardNumberPartOrMask: "************1111",
            expireMonth: 12,
            expireYear: 2035,
          },
        };

        await OrderClient.setBillingInfo({ orderId, billingInfo }, { headers });

        // not necessary if using a user auth token, the response for that token will include account id
        const customerAccount: CustomerAccount = {
          emailAddress: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastNameOrSurname,
          userName: newUser.email,
        };

        // Step 1: Create the account
        const createdCustomerAccount = await CustomerAccountClient.addAccount(
          { customerAccount },
          { headers },
        );
        const customerAccountId = createdCustomerAccount.id;
        logger.info({ customerAccountId }, "Created customer account");

        // Step 2: Add login credentials to convert guest to registered shopper account
        if (customerAccountId) {
          const customerLoginInfo: CustomerLoginInfo = {
            emailAddress: newUser.email,
            username: newUser.email,
            password: "password123",
          };

          await CustomerAccountClient.addLoginToExistingCustomer(
              { accountId: customerAccountId, customerLoginInfo },
            );
          logger.info(
            { customerAccountId },
            "Added login credentials — account is now a registered shopper",
          );
        }

        if (customerAccountId) {
          const currentOrder = await OrderClient.getOrder(
            { orderId }
          );
          currentOrder.customerAccountId = customerAccountId;

          await OrderClient.updateOrder(
            { orderId, order: currentOrder }
          );

          const availableActions = await OrderClient.getAvailableActions(
            { orderId }
          );
          logger.info({ availableActions }, "available actions");

          if (availableActions.includes("SubmitOrder")) {
            await OrderClient.performOrderAction(
              { orderId, orderAction: { actionName: "SubmitOrder" } }
            );
            logger.info("Submitted Order!");
          }
        }
      }
    }
  } catch (error) {
    logger.error({error}, "Error with cartToCompletedOrder");
  }
}

main();
