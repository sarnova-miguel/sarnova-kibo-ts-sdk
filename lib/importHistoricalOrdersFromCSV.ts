/**
 * This script imports historical (already completed) orders from a CSV into Kibo.
 *
 * CSV format: headers are Kibo Order field paths in dot notation (e.g. "billingInfo.paymentType",
 * "fulfillmentInfo.fulfillmentContact.address.address1"). There is one row per line item;
 * order-level columns are repeated on every row of the order and rows are grouped by
 * orderNumber. Column groups with special handling:
 *   items.*                  one order item per row
 *   payments.*               a single payment. Its billingInfo is copied from the
 *                            order-level billingInfo.* columns; payments.billingInfo.*
 *                            columns, if present, take precedence field by field
 *   payments.interactions.*  a single interaction on that payment
 *   notes.<field>            a single order note (notes.text max 250 characters)
 *   extendedProperties.<key> one extended property per column, { key, value }
 *   _*                       helper columns (e.g. _sourceRow); not sent to Kibo
 * Blank cells and "N/A" are omitted from the payload.
 *
 * Mapping to Kibo:
 *   - isImport and isHistoricalImport are always sent as true; the CSV columns are ignored.
 *   - status, paymentStatus and fulfillmentStatus are always sent as Completed / Paid /
 *     Fulfilled; matching CSV columns are ignored.
 *   - orderNumber (legacy, e.g. "SS-803219") is sent as externalId. Kibo assigns its own
 *     numeric orderNumber.
 *   - customerAccountId (legacy account number, e.g. "C0905557") is looked up against the
 *     Kibo customer account externalId set by importB2CAccountsFromCSV.ts. Several Kibo
 *     accounts can share a legacy number, so the order's email picks the account:
 *       - one account with that number: used even if its email differs (logged as a warning)
 *       - several accounts: the one whose emailAddress matches the order email
 *         (case-insensitive) is used; if none or more than one match, the order is skipped
 *       - no accounts: the order is skipped
 *     The legacy number is also sent as the order attribute tenant~accountNumber (must be
 *     defined as an Order attribute in Kibo Admin).
 *   - The order attribute tenant~fnoOrderStatus is always sent as "Shipped" (must be
 *     defined as an Order attribute in Kibo Admin).
 *   - Orders whose externalId already exists in Kibo are skipped, so reruns are safe.
 *
 * All API calls are throttled through one Bottleneck limiter, and 429 / 5xx / network
 * errors are retried with backoff.
 *
 * Usage: npx ts-node .\lib\importHistoricalOrdersFromCSV.ts <path-to-csv> [--dry-run] [--limit N]
 *   --dry-run  Parse, validate, look up customers and existing orders, but don't create orders
 *   --limit N  Only process the first N orders in the file
 *
 * Optional env: MIN_TIME_MS (default 500), MAX_CONCURRENT (default 1), LOG_LEVEL
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import pino from "pino";
import Bottleneck from "bottleneck";
import { parse } from "csv/sync";
import { Configuration } from "@kibocommerce/rest-sdk";
import { CustomerAccountApi } from "@kibocommerce/rest-sdk/clients/Customer";
import { Order, OrderApi } from "@kibocommerce/rest-sdk/clients/Commerce";

dotenv.config();

// Custom order attribute that holds the legacy customer account number
const ACCOUNT_NUMBER_ATTRIBUTE_FQN = "tenant~accountNumber";

// Custom order attribute set to the same value on every imported order
const FNO_ORDER_STATUS_ATTRIBUTE_FQN = "tenant~fnoOrderStatus";
const IMPORTED_FNO_ORDER_STATUS = "Shipped";

// Historical orders are already done, so every imported order gets these values
const IMPORTED_ORDER_STATUSES = {
  status: "Completed",
  paymentStatus: "Paid",
  fulfillmentStatus: "Fulfilled",
} as const;

// CSV columns that get special handling
const COL_ORDER_NUMBER = "orderNumber";
const COL_CUSTOMER_ACCOUNT_ID = "customerAccountId";
const COL_EMAIL = "email";
const COL_IS_IMPORT = "isImport";
const COL_IS_HISTORICAL_IMPORT = "isHistoricalImport";
const COL_TOTAL = "total";
const COL_SHIPPING_TOTAL = "shippingTotal";
const COL_HANDLING_TOTAL = "handlingTotal";
const COL_ITEM_PRODUCT_CODE = "items.product.productCode";
const COL_ITEM_QUANTITY = "items.quantity";
const COL_ITEM_TOTAL = "items.total";

const ITEM_PREFIX = "items.";
const PAYMENT_PREFIX = "payments.";
const PAYMENT_INTERACTION_PREFIX = "payments.interactions.";
const NOTE_PREFIX = "notes.";
const EXTENDED_PROPERTY_PREFIX = "extendedProperties.";
const HELPER_COLUMN_PREFIX = "_";

// Handled by buildOrder itself rather than copied from the CSV
const SPECIAL_ORDER_COLUMNS = new Set([
  COL_ORDER_NUMBER,
  COL_CUSTOMER_ACCOUNT_ID,
  COL_IS_IMPORT,
  COL_IS_HISTORICAL_IMPORT,
  ...Object.keys(IMPORTED_ORDER_STATUSES),
]);

const BOOLEAN_COLUMNS = new Set(["isTaxExempt", "payments.interactions.isManual"]);
const INTEGER_COLUMNS = new Set([COL_ITEM_QUANTITY, "items.lineId"]);

const NOTE_MAX_LENGTH = 250;
// Allowed difference between CSV totals and Kibo's / the line item sum
const AMOUNT_TOLERANCE = 0.01;

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/import-historical-orders.log",
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
  maxConcurrent: Number(process.env.MAX_CONCURRENT) || 1,
  minTime: Number(process.env.MIN_TIME_MS) || 500,
});

// Retry throttling (429), server errors (5xx) and network errors with exponential
// backoff. Anything else (e.g. a 400 validation error) fails immediately.
limiter.on("failed", (error, jobInfo) => {
  if (!isRetryableError(error) || jobInfo.retryCount >= MAX_RETRIES) return;
  const delay = RETRY_BASE_DELAY_MS * 2 ** jobInfo.retryCount;
  logger.warn(
    {
      attempt: jobInfo.retryCount + 1,
      maxRetries: MAX_RETRIES,
      delayMs: delay,
      status: httpStatus(error),
      error: errorMessage(error),
    },
    "Retrying Kibo API call",
  );
  return delay;
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

const orderClient = new OrderApi(configuration);
const customerAccountClient = new CustomerAccountApi(configuration);

export type OrderCsvRow = { [column: string]: string | undefined };

export type OrderGroup = {
  orderNumber: string;
  rows: OrderCsvRow[];
  // Line numbers in the CSV file (header is line 1)
  csvLines: number[];
};

type JsonObject = { [key: string]: unknown };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function httpStatus(error: unknown): number | undefined {
  const status = (error as { response?: { status?: unknown } })?.response?.status;
  return typeof status === "number" ? status : undefined;
}

export function isRetryableError(error: unknown): boolean {
  const status = httpStatus(error);
  if (status !== undefined) return status === 429 || status >= 500;
  // FetchError: the request never got a response (network / DNS / reset)
  return (error as { name?: string })?.name === "FetchError";
}

/**
 * Error details for logging. For Kibo ResponseErrors this adds the HTTP status,
 * correlation ID and the useful parts of the API error body.
 */
function describeError(error: unknown): JsonObject {
  const details: JsonObject = { error: errorMessage(error) };
  const err = error as {
    response?: { status?: unknown; correlationId?: unknown };
    apiError?: JsonObject;
  };
  if (err?.response) {
    details.status = err.response.status;
    details.correlationId = err.response.correlationId;
  }
  if (err?.apiError) {
    const { errorCode, additionalErrorData, items } = err.apiError;
    if (errorCode) details.errorCode = errorCode;
    if (additionalErrorData) details.additionalErrorData = additionalErrorData;
    if (Array.isArray(items) && items.length > 0) details.errorItems = items;
  }
  return details;
}

/**
 * Clean a raw cell: Unicode dashes become "-", any whitespace run (including
 * non-breaking / narrow no-break spaces) becomes one space, then trim.
 * Blank and "N/A" (any case) cells return undefined.
 * (Same rules as importB2CAccountsFromCSV.ts.)
 */
export function normalizeCell(value: string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const cleaned = String(value)
    .replace(/[‐-―−]/g, "-")
    .replace(/[\s﻿]+/g, " ")
    .trim();
  if (!cleaned || /^n\/a$/i.test(cleaned)) return undefined;
  return cleaned;
}

// Kibo filter values escape special characters with "^"
function escapeFilterValue(value: string): string {
  return value.replace(/[\^\/"',{}()]/g, (char) => `^${char}`);
}

// Read the CSV and return one normalized object per row, keyed by header
function readOrdersCsv(csvFilePath: string): OrderCsvRow[] {
  const resolvedPath = path.resolve(csvFilePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`CSV file not found: ${resolvedPath}`);
  }

  logger.info({ path: resolvedPath }, "Reading CSV file");
  const rawRows: Record<string, string>[] = parse(
    fs.readFileSync(resolvedPath, "utf-8"),
    {
      bom: true,
      columns: (header: string[]) =>
        header.map((column) => normalizeCell(column) ?? ""),
      skip_empty_lines: true,
      trim: true,
    },
  );

  const rows: OrderCsvRow[] = rawRows.map((raw) => {
    const row: OrderCsvRow = {};
    for (const [column, value] of Object.entries(raw)) {
      row[column] = normalizeCell(value);
    }
    return row;
  });

  logger.info(
    { totalRows: rows.length, columns: rawRows.length ? Object.keys(rawRows[0]).length : 0 },
    "CSV file parsed successfully",
  );
  return rows;
}

/**
 * Group line-item rows into orders by orderNumber, keeping the order they first appear
 * in the file. Rows with no orderNumber each become their own group so validation
 * reports them.
 */
export function groupRowsByOrder(rows: OrderCsvRow[]): OrderGroup[] {
  const groups: OrderGroup[] = [];
  const byOrderNumber = new Map<string, OrderGroup>();

  rows.forEach((row, index) => {
    // +2: 1-based, plus the header line, so it matches the line number in the CSV
    const csvLine = index + 2;
    const orderNumber = row[COL_ORDER_NUMBER];
    if (!orderNumber) {
      groups.push({ orderNumber: "", rows: [row], csvLines: [csvLine] });
      return;
    }
    let group = byOrderNumber.get(orderNumber);
    if (!group) {
      group = { orderNumber, rows: [], csvLines: [] };
      byOrderNumber.set(orderNumber, group);
      groups.push(group);
    }
    group.rows.push(row);
    group.csvLines.push(csvLine);
  });

  return groups;
}

function isNumericColumn(column: string): boolean {
  const leaf = column.slice(column.lastIndexOf(".") + 1).toLowerCase();
  return leaf.endsWith("total") || leaf.endsWith("amount") || leaf.startsWith("amount");
}

/**
 * Convert a cell to the type Kibo expects for its column: booleans and integers from
 * explicit column lists, numbers for totals / amounts, strings for everything else.
 * Throws when a boolean or number column has a value that can't be converted.
 */
export function coerceValue(column: string, value: string): string | number | boolean {
  if (BOOLEAN_COLUMNS.has(column)) {
    const lower = value.toLowerCase();
    if (["true", "1", "yes", "y"].includes(lower)) return true;
    if (["false", "0", "no", "n"].includes(lower)) return false;
    throw new Error(`${column}: "${value}" is not a boolean`);
  }
  if (INTEGER_COLUMNS.has(column)) {
    const number = Number(value.replace(/,/g, ""));
    if (!Number.isInteger(number)) {
      throw new Error(`${column}: "${value}" is not a whole number`);
    }
    return number;
  }
  if (isNumericColumn(column)) {
    const number = Number(value.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(number)) {
      throw new Error(`${column}: "${value}" is not a number`);
    }
    return number;
  }
  return value;
}

// Set a dot-separated path on an object, creating nested objects as needed
function setPath(target: JsonObject, dotPath: string, value: unknown): void {
  const keys = dotPath.split(".");
  let current = target;
  for (const key of keys.slice(0, -1)) {
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as JsonObject;
  }
  current[keys[keys.length - 1]] = value;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-copy `defaults` into `target`, filling only keys `target` doesn't already have.
 * Nested objects are merged the same way; values already in `target` win.
 */
function mergeDefaults(target: JsonObject, defaults: JsonObject): JsonObject {
  for (const [key, value] of Object.entries(defaults)) {
    if (isPlainObject(value)) {
      const existing = isPlainObject(target[key]) ? (target[key] as JsonObject) : undefined;
      if (target[key] === undefined || existing) {
        target[key] = mergeDefaults(existing ?? {}, value);
      }
    } else if (target[key] === undefined) {
      target[key] = value;
    }
  }
  return target;
}

function orderLevelColumns(rows: OrderCsvRow[]): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!column.startsWith(ITEM_PREFIX) && !column.startsWith(HELPER_COLUMN_PREFIX)) {
        columns.add(column);
      }
    }
  }
  return [...columns];
}

/**
 * Reasons the order can't be imported (empty if it's valid). Checked before any API call.
 * Value types are checked by buildOrder.
 */
export function validateOrder(group: OrderGroup): string[] {
  const errors: string[] = [];
  const first = group.rows[0] || {};

  if (!group.orderNumber) errors.push(`Missing ${COL_ORDER_NUMBER}`);
  if (!first[COL_EMAIL]) errors.push(`Missing ${COL_EMAIL}`);
  if (!first[COL_CUSTOMER_ACCOUNT_ID]) errors.push(`Missing ${COL_CUSTOMER_ACCOUNT_ID}`);
  if (group.rows.length === 0) errors.push("No line items");

  group.rows.forEach((row, index) => {
    const line = group.csvLines[index];
    if (!row[COL_ITEM_PRODUCT_CODE]) errors.push(`Line ${line}: missing ${COL_ITEM_PRODUCT_CODE}`);
    if (!row[COL_ITEM_QUANTITY]) errors.push(`Line ${line}: missing ${COL_ITEM_QUANTITY}`);
  });

  // Order-level values must be the same on every line item row
  for (const column of orderLevelColumns(group.rows)) {
    const values = new Set(group.rows.map((row) => row[column] ?? ""));
    if (values.size > 1) {
      errors.push(
        `${column} differs between rows of the same order: ${[...values]
          .map((value) => JSON.stringify(value))
          .join(", ")}`,
      );
    }
  }

  return errors;
}

export type BuildOrderResult = {
  order: Order;
  // Non-fatal issues to log; the order is still imported
  warnings: string[];
  // Helper (_*) column values per line, for debug logging only
  helperColumns: Array<Record<string, string>>;
};

/**
 * Build the Kibo Order payload from an order's rows. customerAccountId is left out;
 * the caller sets it once the Kibo account has been looked up.
 * Throws if a value can't be converted to its column's type.
 */
export function buildOrder(group: OrderGroup): BuildOrderResult {
  const warnings: string[] = [];
  const first = group.rows[0] || {};
  const order: JsonObject = {};
  const payment: JsonObject = {};
  const interaction: JsonObject = {};
  const note: JsonObject = {};
  const extendedProperties: Array<{ key: string; value: string }> = [];

  for (const [column, value] of Object.entries(first)) {
    if (
      value === undefined ||
      column === "" ||
      column.startsWith(ITEM_PREFIX) ||
      column.startsWith(HELPER_COLUMN_PREFIX) ||
      SPECIAL_ORDER_COLUMNS.has(column)
    ) {
      continue;
    }

    if (column.startsWith(EXTENDED_PROPERTY_PREFIX)) {
      // Extended property values are always strings
      extendedProperties.push({ key: column.slice(EXTENDED_PROPERTY_PREFIX.length), value });
    } else if (column.startsWith(PAYMENT_INTERACTION_PREFIX)) {
      setPath(interaction, column.slice(PAYMENT_INTERACTION_PREFIX.length), coerceValue(column, value));
    } else if (column.startsWith(PAYMENT_PREFIX)) {
      setPath(payment, column.slice(PAYMENT_PREFIX.length), coerceValue(column, value));
    } else if (column.startsWith(NOTE_PREFIX)) {
      setPath(note, column.slice(NOTE_PREFIX.length), coerceValue(column, value));
    } else {
      setPath(order, column, coerceValue(column, value));
    }
  }

  const items: JsonObject[] = group.rows.map((row) => {
    const item: JsonObject = {};
    for (const [column, value] of Object.entries(row)) {
      if (value === undefined || !column.startsWith(ITEM_PREFIX)) continue;
      setPath(item, column.slice(ITEM_PREFIX.length), coerceValue(column, value));
    }
    return item;
  });
  order.items = items;

  if (Object.keys(interaction).length > 0) payment.interactions = [interaction];
  if (Object.keys(payment).length > 0) {
    // The payment carries its own billing contact / address; fill it from the order-level
    // billingInfo, keeping any payments.billingInfo.* values from the CSV
    if (isPlainObject(order.billingInfo)) {
      const paymentBillingInfo = isPlainObject(payment.billingInfo) ? payment.billingInfo : {};
      payment.billingInfo = mergeDefaults(paymentBillingInfo, order.billingInfo);
    }
    order.payments = [payment];
  }

  if (typeof note.text === "string" && note.text.length > NOTE_MAX_LENGTH) {
    warnings.push(
      `notes.text is ${note.text.length} characters; truncated to ${NOTE_MAX_LENGTH}`,
    );
    note.text = note.text.slice(0, NOTE_MAX_LENGTH);
  }
  if (Object.keys(note).length > 0) order.notes = [note];

  if (extendedProperties.length > 0) order.extendedProperties = extendedProperties;

  // Kibo's orderNumber is a number it assigns; keep the legacy number as externalId
  if (group.orderNumber) order.externalId = group.orderNumber;

  // Always imported as historical orders, whatever the CSV says
  for (const column of [COL_IS_IMPORT, COL_IS_HISTORICAL_IMPORT]) {
    const csvValue = first[column];
    if (csvValue !== undefined && csvValue.toLowerCase() !== "true") {
      warnings.push(`${column} is "${csvValue}" in the CSV; ignored and sent as true`);
    }
  }
  order.isImport = true;
  order.isHistoricalImport = true;

  for (const [field, value] of Object.entries(IMPORTED_ORDER_STATUSES)) {
    const csvValue = first[field];
    if (csvValue !== undefined && csvValue.toLowerCase() !== value.toLowerCase()) {
      warnings.push(`${field} is "${csvValue}" in the CSV; ignored and sent as ${value}`);
    }
    order[field] = value;
  }

  const attributes: Array<{ fullyQualifiedName: string; values: string[] }> = [
    { fullyQualifiedName: FNO_ORDER_STATUS_ATTRIBUTE_FQN, values: [IMPORTED_FNO_ORDER_STATUS] },
  ];
  // Keep the legacy account number on the order; customerAccountId becomes the Kibo ID
  const legacyAccountNumber = first[COL_CUSTOMER_ACCOUNT_ID];
  if (legacyAccountNumber) {
    attributes.push({ fullyQualifiedName: ACCOUNT_NUMBER_ATTRIBUTE_FQN, values: [legacyAccountNumber] });
  }
  order.attributes = attributes;

  // Line items should add up to the order total minus shipping and handling
  if (typeof order[COL_TOTAL] === "number") {
    const itemSum = items.reduce(
      (sum, item) => sum + (typeof item.total === "number" ? item.total : 0),
      0,
    );
    const expected =
      (order[COL_TOTAL] as number) -
      ((order[COL_SHIPPING_TOTAL] as number) || 0) -
      ((order[COL_HANDLING_TOTAL] as number) || 0);
    if (Math.abs(itemSum - expected) > AMOUNT_TOLERANCE) {
      warnings.push(
        `Sum of ${COL_ITEM_TOTAL} (${itemSum.toFixed(2)}) doesn't match ` +
          `${COL_TOTAL} - ${COL_SHIPPING_TOTAL} - ${COL_HANDLING_TOTAL} (${expected.toFixed(2)})`,
      );
    }
  }

  const helperColumns = group.rows.map((row) => {
    const helpers: Record<string, string> = {};
    for (const [column, value] of Object.entries(row)) {
      if (column.startsWith(HELPER_COLUMN_PREFIX) && value !== undefined) {
        helpers[column] = value;
      }
    }
    return helpers;
  });

  return { order: order as Order, warnings, helperColumns };
}

/**
 * Compare Kibo's response with what was sent. The docs don't say what Kibo recalculates
 * for imported orders, so differences are logged as warnings.
 */
export function compareCreatedOrder(sent: Order, created: Order): string[] {
  const warnings: string[] = [];
  if (
    typeof sent.total === "number" &&
    typeof created.total === "number" &&
    Math.abs(sent.total - created.total) > AMOUNT_TOLERANCE
  ) {
    warnings.push(`Kibo total ${created.total} differs from CSV total ${sent.total}`);
  }
  if (created.isImport !== true) warnings.push(`isImport is ${created.isImport} in Kibo's response`);
  if (created.isHistoricalImport !== true) {
    warnings.push(`isHistoricalImport is ${created.isHistoricalImport} in Kibo's response`);
  }
  for (const field of Object.keys(IMPORTED_ORDER_STATUSES) as Array<
    keyof typeof IMPORTED_ORDER_STATUSES
  >) {
    if (created[field] !== sent[field]) {
      warnings.push(`${field} is ${created[field]} in Kibo's response; sent ${sent[field]}`);
    }
  }
  if (created.customerAccountId !== sent.customerAccountId) {
    warnings.push(
      `customerAccountId is ${created.customerAccountId} in Kibo's response; sent ${sent.customerAccountId}`,
    );
  }

  // Kibo matches FQNs case-insensitively and echoes its own casing, so compare lower-cased
  for (const sentAttribute of sent.attributes ?? []) {
    const fqn = sentAttribute.fullyQualifiedName;
    if (!fqn) continue;
    const createdAttribute = created.attributes?.find(
      (attribute) => attribute.fullyQualifiedName?.toLowerCase() === fqn.toLowerCase(),
    );
    if (!createdAttribute) {
      warnings.push(`${fqn} missing from Kibo's response - is it defined as an Order attribute?`);
    } else if (
      JSON.stringify(createdAttribute.values ?? []) !== JSON.stringify(sentAttribute.values ?? [])
    ) {
      warnings.push(
        `${fqn} is ${JSON.stringify(createdAttribute.values)} in Kibo's response; ` +
          `sent ${JSON.stringify(sentAttribute.values)}`,
      );
    }
  }
  return warnings;
}

async function findExistingOrderId(externalId: string): Promise<string | undefined> {
  const existing = await limiter.schedule(() =>
    orderClient.getOrders({
      filter: `externalId eq '${escapeFilterValue(externalId)}'`,
      pageSize: 1,
    }),
  );
  return existing.items?.[0]?.id ?? undefined;
}

export type KiboAccountSummary = { id: number; emailAddress?: string };

// Several Kibo accounts can share one legacy account number; more than this is unexpected
const ACCOUNT_LOOKUP_PAGE_SIZE = 200;

// Legacy account number -> every Kibo account with that externalId. Many orders share a customer.
const accountsByExternalId = new Map<string, KiboAccountSummary[]>();

async function findAccountsByExternalId(externalId: string): Promise<KiboAccountSummary[]> {
  let accounts = accountsByExternalId.get(externalId);
  if (!accounts) {
    const response = await limiter.schedule(() =>
      customerAccountClient.getAccounts({
        filter: `externalId eq '${escapeFilterValue(externalId)}'`,
        pageSize: ACCOUNT_LOOKUP_PAGE_SIZE,
      }),
    );
    accounts = (response.items ?? [])
      .filter((account) => typeof account.id === "number")
      .map((account) => ({ id: account.id as number, emailAddress: account.emailAddress ?? undefined }));
    accountsByExternalId.set(externalId, accounts);
  }
  return accounts;
}

export type AccountSelection = {
  accountId?: number;
  matchedBy?: "single account" | "email match";
  // Set when no account could be chosen; the order is skipped
  error?: string;
  // Set when an account was chosen but its email differs from the order's
  warning?: string;
};

const normalizeEmail = (email: string | undefined) => (email ?? "").trim().toLowerCase();

/**
 * Choose the Kibo account for an order from the accounts sharing its legacy account number.
 * One account: use it (warn if the email differs). Several: the email must match exactly one.
 */
export function selectAccount(
  accounts: KiboAccountSummary[],
  legacyAccountNumber: string,
  orderEmail: string,
): AccountSelection {
  if (accounts.length === 0) {
    return { error: `No Kibo customer account with externalId '${legacyAccountNumber}'` };
  }

  const emailMatches = accounts.filter(
    (account) => normalizeEmail(account.emailAddress) === normalizeEmail(orderEmail),
  );

  if (accounts.length === 1) {
    const [account] = accounts;
    const selection: AccountSelection = { accountId: account.id, matchedBy: "single account" };
    if (emailMatches.length === 0) {
      selection.warning =
        `Only Kibo account for '${legacyAccountNumber}' (id ${account.id}) has email ` +
        `'${account.emailAddress ?? ""}', not order email '${orderEmail}' - attaching anyway`;
    }
    return selection;
  }

  if (emailMatches.length === 1) {
    return { accountId: emailMatches[0].id, matchedBy: "email match" };
  }

  const ids = (list: KiboAccountSummary[]) => list.map((account) => account.id).join(", ");
  if (emailMatches.length === 0) {
    return {
      error:
        `${accounts.length} Kibo accounts have externalId '${legacyAccountNumber}' but none has ` +
        `email '${orderEmail}' (account IDs: ${ids(accounts)})`,
    };
  }
  return {
    error:
      `${emailMatches.length} Kibo accounts have externalId '${legacyAccountNumber}' and ` +
      `email '${orderEmail}' (account IDs: ${ids(emailMatches)})`,
  };
}

export type ImportOptions = {
  dryRun?: boolean;
  limit?: number;
};

type OrderProblem = {
  orderNumber: string;
  csvLines: number[];
  customerAccount?: string;
  errors: string[];
};

/**
 * Creates a Kibo order for each order in the CSV (see the header comment for the format).
 * All API calls are throttled through the shared limiter.
 *
 * @param csvFilePath - Path to the order history CSV
 * @param options - dryRun: don't create orders; limit: only process the first N orders
 */
export async function importHistoricalOrdersFromCSV(
  csvFilePath: string,
  options: ImportOptions = {},
) {
  const { dryRun = false, limit } = options;
  const allGroups = groupRowsByOrder(readOrdersCsv(csvFilePath));
  const groups = limit !== undefined ? allGroups.slice(0, limit) : allGroups;
  logger.info(
    { ordersInFile: allGroups.length, ordersToProcess: groups.length, dryRun },
    "Grouped CSV rows into orders",
  );

  const summary = {
    dryRun,
    totalOrders: groups.length,
    created: 0,
    wouldCreate: 0,
    skippedExisting: 0,
    skippedInvalid: 0,
    missingAccount: 0,
    failed: 0,
    ordersWithWarnings: 0,
  };
  const invalidOrders: OrderProblem[] = [];
  const missingAccountOrders: OrderProblem[] = [];
  const failedOrders: OrderProblem[] = [];

  for (const group of groups) {
    const customerAccount = group.rows[0]?.[COL_CUSTOMER_ACCOUNT_ID];
    const context = { orderNumber: group.orderNumber, csvLines: group.csvLines, customerAccount };
    const orderLogger = logger.child(context);

    const validationErrors = validateOrder(group);
    let built: BuildOrderResult | undefined;
    if (validationErrors.length === 0) {
      try {
        built = buildOrder(group);
      } catch (error) {
        validationErrors.push(errorMessage(error));
      }
    }
    if (!built || validationErrors.length > 0) {
      orderLogger.warn({ errors: validationErrors }, "Skipping invalid order");
      summary.skippedInvalid++;
      invalidOrders.push({ ...context, errors: validationErrors });
      continue;
    }

    const { order, warnings, helperColumns } = built;
    orderLogger.debug({ helperColumns }, "Helper columns (not sent to Kibo)");
    if (warnings.length > 0) {
      orderLogger.warn({ warnings }, "Order has warnings - importing anyway");
    }

    try {
      const existingOrderId = await findExistingOrderId(group.orderNumber);
      if (existingOrderId) {
        orderLogger.info({ kiboOrderId: existingOrderId }, "Order already exists - skipping");
        summary.skippedExisting++;
        continue;
      }

      // validateOrder guarantees customerAccountId and email are present
      const orderEmail = group.rows[0][COL_EMAIL]!;
      const accounts = await findAccountsByExternalId(customerAccount!);
      const selection = selectAccount(accounts, customerAccount!, orderEmail);
      if (selection.error || selection.accountId === undefined) {
        const error = selection.error ?? "No Kibo customer account selected";
        orderLogger.warn(error + " - skipping");
        summary.missingAccount++;
        missingAccountOrders.push({ ...context, errors: [error] });
        continue;
      }
      const customerAccountId = selection.accountId;
      orderLogger.debug(
        { customerAccountId, matchedBy: selection.matchedBy, accountsWithLegacyNumber: accounts.length },
        "Matched Kibo customer account",
      );
      if (selection.warning) {
        warnings.push(selection.warning);
        orderLogger.warn(selection.warning);
      }
      order.customerAccountId = customerAccountId;

      if (warnings.length > 0) summary.ordersWithWarnings++;

      if (dryRun) {
        orderLogger.info(
          { customerAccountId, total: order.total, items: order.items?.length },
          "Dry run - order would be created",
        );
        orderLogger.debug({ order }, "Dry run payload");
        summary.wouldCreate++;
        continue;
      }

      const created = await limiter.schedule(() => orderClient.createOrder({ order }));
      orderLogger.info(
        {
          kiboOrderId: created.id,
          kiboOrderNumber: created.orderNumber,
          externalId: created.externalId,
          customerAccountId,
          status: created.status,
          paymentStatus: created.paymentStatus,
          fulfillmentStatus: created.fulfillmentStatus,
          total: created.total,
          items: created.items?.length,
        },
        "Created order",
      );
      summary.created++;

      const responseWarnings = compareCreatedOrder(order, created);
      if (responseWarnings.length > 0) {
        orderLogger.warn(
          { kiboOrderId: created.id, warnings: responseWarnings },
          "Created order differs from the CSV",
        );
      }
    } catch (error) {
      const details = describeError(error);
      orderLogger.error(details, "Error importing order");
      summary.failed++;
      failedOrders.push({ ...context, errors: [String(details.error)] });
    }
  }

  logger.info(summary, "Historical order import summary");
  if (invalidOrders.length > 0) {
    logger.warn({ invalidOrders }, "Orders skipped because of invalid data");
  }
  if (missingAccountOrders.length > 0) {
    logger.warn(
      { missingAccountOrders },
      "Orders skipped because they couldn't be matched to a Kibo customer account - fix the accounts and rerun",
    );
  }
  if (failedOrders.length > 0) {
    logger.error({ failedOrders }, "Orders that failed to import");
  }

  return summary;
}

export function parseArgs(argv: string[]): {
  csvFilePath?: string;
  options: ImportOptions;
  error?: string;
} {
  const options: ImportOptions = {};
  let csvFilePath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--limit") {
      const limit = Number(argv[++i]);
      if (!Number.isInteger(limit) || limit < 1) {
        return { options, error: "--limit needs a positive whole number" };
      }
      options.limit = limit;
    } else if (arg.startsWith("--")) {
      return { options, error: `Unknown option ${arg}` };
    } else {
      csvFilePath = arg;
    }
  }

  if (!csvFilePath) return { options, error: "No CSV file path provided" };
  return { csvFilePath, options };
}

async function main() {
  const { csvFilePath, options, error } = parseArgs(process.argv.slice(2));

  if (error || !csvFilePath) {
    logger.error(
      `${error}. Usage: npx ts-node lib/importHistoricalOrdersFromCSV.ts <path-to-csv> [--dry-run] [--limit N]`,
    );
    process.exit(1);
  }

  logger.info(
    { ...options },
    `Importing historical orders to Tenant: ${process.env.TENANT_ID}, Site: ${process.env.SITE_ID}`,
  );
  await importHistoricalOrdersFromCSV(csvFilePath, options);
  logger.info("*** Historical order import complete! ***");
}

// Only run when executed directly, so importHistoricalOrdersFromCSV can be imported elsewhere
if (require.main === module) {
  main().catch((error) => {
    logger.error(describeError(error), "Unhandled error");
    process.exit(1);
  });
}
