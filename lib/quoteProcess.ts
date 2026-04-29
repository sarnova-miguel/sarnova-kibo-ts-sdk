import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import {
  StorefrontAuthTicketApi,
  CustomerUserAuthInfo,
} from "@kibocommerce/rest-sdk/clients/Customer";
import { QuoteApi } from "@kibocommerce/rest-sdk/clients/Commerce";

dotenv.config();

// ── Pino logger (console + file) ──────────────────────────────────────────────
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/quote-process.log",
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
  { level: process.env.LOG_LEVEL || "info" },
  transport,
);

// ── SDK configuration ─────────────────────────────────────────────────────────
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

// ── Constants ─────────────────────────────────────────────────────────────────
const PRODUCT_CODE_1 = "999-1";   
const PRODUCT_CODE_2 = "999-2";   
const QUANTITY_1 = 15;
const QUANTITY_2 = 7;
const QUOTE_NAME = "B2B TEST Quote2 - AEDs";
const BUYER_COMMENT = "Looking for best pricing on bulk order. Need delivery by end of month.";

const BUYER = {
  accountId: 1007,
  userId: "6f7fb8fd7ad741098e37da587929f7e8",
  firstName: "John",
  lastNameOrSurname: "Doe",
  email: "jd@abctesting.com",
  phone: "215-555-1234",
  password: "password123",
};

// ── Main flow ─────────────────────────────────────────────────────────────────
async function main() {
  logger.info("=== Quote-to-Order process starting ===");

  const StorefrontAuthClient = new StorefrontAuthTicketApi(configuration);
  const QuoteClient = new QuoteApi(configuration);

  try {
    // ── Step 1: Authenticate the buyer ──────────────────────────────────────
    logger.info("Step 1 — Authenticating buyer...");
    const customerUserAuthInfo: CustomerUserAuthInfo = {
      accountId: BUYER.accountId,
      username: BUYER.email,
      password: BUYER.password,
    };

    const userAuthTicket = await StorefrontAuthClient.createUserAuthTicket({
      customerUserAuthInfo,
    });
    const userToken = userAuthTicket?.jwtAccessToken;
    const customerAccountId = userAuthTicket?.customerAccount?.id;
    logger.info(
      { customerAccountId, userId: userAuthTicket?.customerAccount?.userId },
      "Buyer authenticated",
    );

    const headers: any = [
      ["Authorization", `Bearer ${userToken}`],
      ["Content-Type", "application/json"],
      ["x-vol-site", process.env.SITE_ID],
      ["x-vol-tenant", process.env.TENANT_ID],
    ];

    // ── Step 2: Create a new quote ──────────────────────────────────────────
    logger.info("Step 2 — Creating quote...");
    const createdQuote = await QuoteClient.createQuote(
      {
        quote: {
          customerAccountId,
          name: QUOTE_NAME,
        },
      },
      { headers },
    );
    const quoteId = createdQuote.id;
    logger.info(
      { quoteId, status: createdQuote.status, name: createdQuote.name },
      "Quote created",
    );

    if (!quoteId) {
      throw new Error("Quote ID not returned from createQuote");
    }

    // ── Step 3: Add items to the quote ──────────────────────────────────────
    logger.info("Step 3 — Adding items to quote...");

    const quoteAfterItem1 = await QuoteClient.addItemToQuote(
      {
        quoteId,
        updateMode: "ApplyAndCommit",
        commerceRuntimeOrderItem: {
          product: { productCode: PRODUCT_CODE_1 },
          quantity: QUANTITY_1,
          fulfillmentMethod: "Ship",
        },
      },
      { headers },
    );
    logger.info(
      {
        itemCount: quoteAfterItem1.items?.length,
        subTotal: quoteAfterItem1.subTotal,
      },
      `Added ${PRODUCT_CODE_1} x${QUANTITY_1}`,
    );

    const quoteAfterItem2 = await QuoteClient.addItemToQuote(
      {
        quoteId,
        updateMode: "ApplyAndCommit",
        commerceRuntimeOrderItem: {
          product: { productCode: PRODUCT_CODE_2 },
          quantity: QUANTITY_2,
          fulfillmentMethod: "Ship",
        },
      },
      { headers },
    );
    logger.info(
      {
        itemCount: quoteAfterItem2.items?.length,
        subTotal: quoteAfterItem2.subTotal,
      },
      `Added ${PRODUCT_CODE_2} x${QUANTITY_2}`,
    );

    // ── Step 4: Buyer adds a comment ────────────────────────────────────────
    logger.info("Step 4 — Buyer adding comment...");
    const comment = await QuoteClient.create(
      {
        quoteId,
        quoteComment: { text: BUYER_COMMENT },
      },
      { headers },
    );
    logger.info({ commentId: comment.id, text: comment.text }, "Comment added");

    // ── Step 4b: Fetch quote to view current state after comment ────────────
    logger.info("Step 4b — Fetching updated quote after comment...");
    const quoteAfterComment = await QuoteClient.getQuote({ quoteId }, { headers });
    logger.info(
      {
        quoteId: quoteAfterComment.id,
        status: quoteAfterComment.status,
        name: quoteAfterComment.name,
        items: quoteAfterComment.items?.map((i) => ({
          productCode: i.product?.productCode,
          qty: i.quantity,
          unitPrice: i.unitPrice?.listAmount,
          total: i.total,
        })),
        comments: quoteAfterComment.comments?.map((c) => ({
          id: c.id,
          text: c.text,
        })),
        subTotal: quoteAfterComment.subTotal,
        total: quoteAfterComment.total,
      },
      "Quote state after adding items and comment",
    );

    // ── Step 5: Submit quote for seller review (Pending → InReview) ─────────
    // logger.info("Step 5 — Submitting quote for seller review...");
    // const submittedQuote = await QuoteClient.updateQuote(
    //   {
    //     quoteId,
    //     quote: { ...quoteAfterItem2, status: "InReview" },
    //   },
    //   { headers },
    // );
    // logger.info(
    //   { quoteId, status: submittedQuote.status },
    //   "Quote submitted — now In Review",
    // );

    // ── Step 6: Seller approves (InReview → ReadyForCheckout) ───────────────
    // In a real app the seller would review in Kibo Admin.
    // Here we simulate the seller approving the quote via API.
    // logger.info("Step 6 — Seller approving quote...");
    // const approvedQuote = await QuoteClient.updateQuote(
    //   {
    //     quoteId,
    //     quote: { ...submittedQuote, status: "ReadyForCheckout" },
    //   },
    //   { headers },
    // );
    // logger.info(
    //   { quoteId, status: approvedQuote.status, total: approvedQuote.total },
    //   "Quote approved — Ready for Checkout",
    // );

    // ── Step 7: Fetch the approved quote for review ─────────────────────────
    // logger.info("Step 7 — Fetching approved quote details...");
    // const finalQuote = await QuoteClient.getQuote({ quoteId }, { headers });
    // logger.info(
    //   {
    //     quoteId: finalQuote.id,
    //     status: finalQuote.status,
    //     items: finalQuote.items?.map((i) => ({
    //       productCode: i.product?.productCode,
    //       qty: i.quantity,
    //       unitPrice: i.unitPrice?.listAmount,
    //       total: i.total,
    //     })),
    //     subTotal: finalQuote.subTotal,
    //     shippingTotal: finalQuote.shippingTotal,
    //     taxTotal: finalQuote.itemTaxTotal,
    //     total: finalQuote.total,
    //   },
    //   "Approved quote details",
    // );

    // ── Step 8: Convert quote to checkout ───────────────────────────────────
    // The quote must transition to Completed, which creates an order.
    // The SDK does not have a direct "convertQuoteToOrder" — the standard
    // approach is to update the quote status to Completed, which triggers
    // Kibo to create an order from the quote internally.
    // logger.info("Step 8 — Converting quote to order (Completed)...");
    // const completedQuote = await QuoteClient.updateQuote(
    //   {
    //     quoteId,
    //     quote: { ...finalQuote, status: "Completed" },
    //   },
    //   { headers },
    // );
    // logger.info(
    //   {
    //     quoteId: completedQuote.id,
    //     status: completedQuote.status,
    //     total: completedQuote.total,
    //   },
    //   "Quote completed — order created from quote",
    // );

    logger.info("=== Quote-to-Order process finished successfully ===");
  } catch (error) {
    logger.error({ error }, "Error in quote-to-order process");
  }
}

main();
