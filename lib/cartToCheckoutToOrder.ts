import Bottleneck from "bottleneck";
import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import {
  StorefrontAuthTicketApi,
  CustomerUserAuthInfo,
} from "@kibocommerce/rest-sdk/clients/Customer";
import {
  CartApi,
  CheckoutApi,
  BillingInfo,
} from "@kibocommerce/rest-sdk/clients/Commerce";

dotenv.config();

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/cart-to-checkout-to-order.log",
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
const existingUser = {
  firstName: "Michael",
  lastNameOrSurname: "Jordan",
  email: "mj@testing.com",
  phone: "215-555-1234",
  password: "password123",
};
const sandboxProduct = "DSP_001";

async function main() {
  logger.info("cartToCheckoutToOrder running...");

  const StorefrontAuthClient = new StorefrontAuthTicketApi(configuration);
  const CartClient = new CartApi(configuration);
  const CheckoutClient = new CheckoutApi(configuration);

  try {
    // Step 1: Login an existing user
    const customerUserAuthInfo: CustomerUserAuthInfo = {
      username: existingUser.email,
      password: existingUser.password,
    };

    const userAuthTicket = await StorefrontAuthClient.createUserAuthTicket({
      customerUserAuthInfo,
    });
    const userToken = userAuthTicket?.jwtAccessToken;
    const userId = String(userAuthTicket?.customerAccount?.userId);
    logger.info({ customerAccountId: userAuthTicket?.customerAccount?.id, userId }, "Logged in user");

    const headers: any = [
      ["Authorization", `Bearer ${userToken}`],
      ["Content-Type", "application/json"],
      ["x-vol-site", process.env.SITE_ID],
      ["x-vol-tenant", process.env.TENANT_ID],
    ];

    // Step 2: Get or create the user's cart, then add an item by cart ID
    const currentCart = await CartClient.getOrCreateUserCart({ userId });
    const cartId = currentCart.id;
    logger.info({ cartId }, "Current user cart");

    if (!cartId) {
      throw new Error("Cart ID not found");
    }

    const addedItemToCart = await CartClient.addItemToCartByCartId(
      { cartId, cartItem: { product: { productCode: sandboxProduct }, quantity: 10 } }
    );
    logger.info({ addedItemToCart }, "Added item to cart");

    // Step 3: Create a checkout from the cart
    const checkout = await CheckoutClient.createCheckoutFromCart(
      { cartId },
      { headers }
    );
    const checkoutId = checkout.id;
    logger.info({ checkoutId }, "Created checkout from cart");

    if (!checkoutId) {
      throw new Error("Checkout ID not found");
    }

    // Set the email on the checkout (required for submission)
    await CheckoutClient.updateCheckout(
      {
        checkoutId,
        checkout: {
          ...checkout,
          email: existingUser.email,
        },
      },
      { headers },
    );
    logger.info("Set email on checkout");

    // Step 4: Add a destination to the checkout and assign items to it
    const destination = await CheckoutClient.addDestination(
      {
        checkoutId,
        commerceRuntimeDestination: {
        destinationContact: {
          firstName: existingUser.firstName,
          lastNameOrSurname: existingUser.lastNameOrSurname,
          email: existingUser.email,
          phoneNumbers: {
            home: existingUser.phone,
            mobile: "",
            work: "",
          },
          address: {
            address1: "4670 ROUTE 42",
            address2: "",
            cityOrTown: "TURNERSVILLE",
            stateOrProvince: "NJ",
            postalOrZipCode: "08012-1764",
            countryCode: "US",
            addressType: "Residential",
            isValidated: true,
          },
        },
        },
      },
      { headers },
    );
    const destinationId = destination.id;
    logger.info({ destinationId }, "Added destination to checkout");

    // Assign all checkout items to the destination
    const itemIds = checkout.items?.map((item) => item.id!).filter(Boolean) || [];
    await CheckoutClient.bulkUpdateItemDestinations(
      {
        checkoutId,
        itemsForDestination: [
          {
            destinationId,
            itemIds,
          },
        ],
      },
      { headers },
    );
    logger.info({ itemIds, destinationId }, "Assigned items to destination");

    // Step 5: Get available shipping methods and set shipping method
    const availableShippingMethods =
      await CheckoutClient.getAvailableShippingMethods(
        { checkoutId },
        { headers },
      );
    logger.info({ availableShippingMethods }, "Available shipping methods");

    // Use the first available shipping method group/rate
    if (availableShippingMethods.length > 0) {
      const firstGroup = availableShippingMethods[0];
      const firstRate = firstGroup.shippingRates?.[0];

      if (firstRate && firstGroup.groupingId) {
        await CheckoutClient.setShippingMethods(
          {
            checkoutId,
            checkoutGroupShippingMethod: [
              {
                groupingId: firstGroup.groupingId,
                shippingRate: firstRate,
              },
            ],
          },
          { headers },
        );
        logger.info(
          { shippingMethodCode: firstRate.shippingMethodCode },
          "Set shipping method on checkout",
        );
      }
    }

    // Step 6: POST to payments endpoint to get a paymentServiceCardId
    const paymentCardResponse = await fetch(paymentsUrl!, {
      method: "POST",
      headers,
      body: JSON.stringify({
        cardNumber: "4111111111111111",
        cardholderName: `${existingUser.firstName} ${existingUser.lastNameOrSurname}`,
        cardNumberPartOrMask: "************1111",
        cvv: "1234",
        cardType: "AMEX",
        isTokenized: true,
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

    // Step 7: Create a payment action on the checkout (using Checkout API)
    const billingInfo: BillingInfo = {
      paymentType: "CreditCard",
      paymentWorkflow: "Mozu",
      billingContact: {
        firstName: existingUser.firstName,
        middleNameOrInitial: "",
        lastNameOrSurname: existingUser.lastNameOrSurname,
        email: existingUser.email,
        phoneNumbers: {
          home: existingUser.phone,
          mobile: "",
          work: "",
        },
        address: {
          address1: "4670 ROUTE 42",
          address2: "",
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
        nameOnCard: `${existingUser.firstName} ${existingUser.lastNameOrSurname}`,
        isCardInfoSaved: false,
        isTokenized: false,
        paymentOrCardType: "AMEX",
        cardNumberPartOrMask: "************1111",
        expireMonth: 12,
        expireYear: 2035,
      },
    };

    // Get the checkout total for the payment amount
    const currentCheckout = await CheckoutClient.getCheckout(
      { checkoutId },
      { headers },
    );
    const checkoutTotal = currentCheckout.total || 0;

    const checkoutWithPayment = await CheckoutClient.createPaymentAction(
      {
        checkoutId,
        paymentAction: {
          actionName: "AuthorizePayment",
          currencyCode: "USD",
          amount: checkoutTotal,
          newBillingInfo: billingInfo,
        },
      },
      { headers },
    );
    logger.info("Created payment action on checkout");

    // Step 8: Complete the order by performing checkout action
    const availableActions = await CheckoutClient.getAvailableActions(
      { checkoutId },
      { headers },
    );
    logger.info({ availableActions }, "Available checkout actions");

    if (availableActions.includes("SubmitCheckout")) {
      const completedCheckout = await CheckoutClient.performCheckoutAction(
        {
          checkoutId,
          checkoutAction: { actionName: "SubmitCheckout" },
        },
        { headers },
      );
      logger.info(
        { orderId: completedCheckout.id },
        "Order submitted successfully!",
      );
    } else {
      logger.warn(
        { availableActions },
        "SubmitCheckout action not available on checkout",
      );
    }
  } catch (error) {
    logger.error({ error }, "Error with cartToCheckoutToOrder");
  }
}

main();
