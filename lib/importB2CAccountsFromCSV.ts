/**
 * This script imports B2C shopper accounts from a customer CSV into Kibo.
 *
 * Expected headers (row 1), one customer per row:
 *   Tax Exempt, Customer Account, Customer Name, Billing Address, Primary Contact,
 *   Customer email
 * Optional: Phone, Phone Type
 *
 * For each row it creates the account (Add-Account-And-Login) with the Customer Account
 * in the tenant~accountnumber attribute and externalId, tenant~is-verified = true, and
 * taxExempt from the Tax Exempt column. It then parses the single-cell Billing Address
 * ("street, city, state zip") and adds it as the primary Billing + Shipping contact.
 * Cells containing "N/A" are treated as blank. Rows whose email already exists in Kibo
 * are skipped.
 *
 * Usage: npx ts-node .\lib\importB2CAccountsFromCSV.ts <path-to-csv>
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import pino from "pino";
import Bottleneck from "bottleneck";
import { parse } from "csv/sync";
import { Configuration } from "@kibocommerce/rest-sdk";
import {
  CustomerAccountApi,
  CustomerAccountAndAuthInfo,
  CustomerAttribute,
  CustomerContact,
} from "@kibocommerce/rest-sdk/clients/Customer";

dotenv.config();

const ACCOUNT_NUMBER_ATTRIBUTE_FQN = "tenant~accountnumber";
const IS_VERIFIED_ATTRIBUTE_FQN = "tenant~is-verified";
// Every imported shopper gets this temporary password and sets their own via the
// reset-password flow (see userResetPw.ts). Plain string literal so "$$" stays literal.
const TEMP_PASSWORD = "TempPa$$word123!";
const DEFAULT_COUNTRY_CODE = "US";

// CSV header names (after normalization: BOM stripped, whitespace trimmed)
const COL_TAX_EXEMPT = "Tax Exempt";
const COL_CUSTOMER_ACCOUNT = "Customer Account";
const COL_CUSTOMER_NAME = "Customer Name";
const COL_BILLING_ADDRESS = "Billing Address";
const COL_PRIMARY_CONTACT = "Primary Contact";
const COL_EMAIL = "Customer email";
// Not in the current export yet; used when present
const COL_PHONE = "Phone";
const COL_PHONE_TYPE = "Phone Type";

const PHONE_TYPES = ["home", "mobile", "work"] as const;
type PhoneType = (typeof PHONE_TYPES)[number];
const DEFAULT_PHONE_TYPE: PhoneType = "mobile";

// Full state / territory name (lowercase) -> 2-letter code
const US_STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "puerto rico": "PR",
  guam: "GU",
  "u.s. virgin islands": "VI",
  "us virgin islands": "VI",
  "virgin islands": "VI",
  "american samoa": "AS",
  "northern mariana islands": "MP",
};
const US_STATE_CODES = new Set(Object.values(US_STATES));

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/import-b2c-accounts.log",
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

const customerAccountClient = new CustomerAccountApi(configuration);

type CustomerCsvRow = {
  [COL_TAX_EXEMPT]?: string;
  [COL_CUSTOMER_ACCOUNT]?: string;
  [COL_CUSTOMER_NAME]?: string;
  [COL_BILLING_ADDRESS]?: string;
  [COL_PRIMARY_CONTACT]?: string;
  [COL_EMAIL]?: string;
  [COL_PHONE]?: string;
  [COL_PHONE_TYPE]?: string;
  [column: string]: string | undefined;
};

export type ParsedAddress = {
  address1: string;
  cityOrTown: string;
  stateOrProvince: string;
  postalOrZipCode: string;
  countryCode: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBoolean(value: string | undefined): boolean {
  return ["true", "1", "yes", "y"].includes((value || "").trim().toLowerCase());
}

/**
 * Clean a raw cell: Unicode dashes become "-", any whitespace run (including
 * non-breaking / narrow no-break spaces) becomes one space, then trim.
 * Blank and "N/A" (any case) cells return undefined.
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

// Read the CSV and return one normalized object per row, keyed by header
function readAccountsCsv(csvFilePath: string): CustomerCsvRow[] {
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

  const rows: CustomerCsvRow[] = rawRows.map((raw) => {
    const row: CustomerCsvRow = {};
    for (const [column, value] of Object.entries(raw)) {
      row[column] = normalizeCell(value);
    }
    return row;
  });

  logger.info(
    { totalRows: rows.length, columns: rawRows.length ? Object.keys(rawRows[0]) : [] },
    "CSV file parsed successfully",
  );
  return rows;
}

// 2-letter code or full name (any case) -> 2-letter code; undefined if unknown
export function normalizeState(value: string): string | undefined {
  const trimmed = value.trim().replace(/\.$/, "");
  const upper = trimmed.toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper;
  return US_STATES[trimmed.toLowerCase()];
}

const ZIP_PATTERN = "\\d{5}(?:-\\d{4})?";

/**
 * Parse a single-cell US address of the form "street, city, state zip".
 * Street may itself contain commas; everything before the city is kept as address1.
 * Also accepts "street, city, state, zip". Returns undefined if it can't be parsed.
 */
export function parseAddress(raw: string | undefined): ParsedAddress | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  let stateText: string;
  let postalOrZipCode: string;
  const last = parts[parts.length - 1] || "";
  const zipOnly = last.match(new RegExp(`^(${ZIP_PATTERN})$`));
  if (zipOnly) {
    // "..., city, state, zip"
    parts.pop();
    stateText = parts.pop() || "";
    postalOrZipCode = zipOnly[1];
  } else {
    // "..., city, state zip"
    const stateZip = last.match(new RegExp(`^(.+?)\\s+(${ZIP_PATTERN})$`));
    if (!stateZip) return undefined;
    parts.pop();
    stateText = stateZip[1];
    postalOrZipCode = stateZip[2];
  }

  const stateOrProvince = normalizeState(stateText);
  if (!stateOrProvince || parts.length < 2) return undefined;

  const cityOrTown = parts.pop()!;
  const address1 = parts.join(", ");

  return {
    address1,
    cityOrTown,
    stateOrProvince,
    postalOrZipCode,
    countryCode: DEFAULT_COUNTRY_CODE,
  };
}

// First token is the first name, the rest is the last name
export function splitFullName(fullName: string | undefined): {
  firstName?: string;
  lastName?: string;
} {
  const tokens = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return {};
  return {
    firstName: tokens[0],
    lastName: tokens.slice(1).join(" ") || undefined,
  };
}

// Returns a reason the row can't be imported, or undefined if it's valid
function validateRow(row: CustomerCsvRow): string | undefined {
  const email = row[COL_EMAIL] || "";
  if (!email || !email.includes("@")) {
    return `Missing or invalid ${COL_EMAIL}`;
  }
  if (!row[COL_CUSTOMER_ACCOUNT]) {
    return `Missing ${COL_CUSTOMER_ACCOUNT}`;
  }
  return undefined;
}

function buildPhoneNumbers(
  row: CustomerCsvRow,
  rowNumber: number,
): CustomerContact["phoneNumbers"] {
  const phone = row[COL_PHONE];
  if (!phone) return undefined;

  const requestedType = (row[COL_PHONE_TYPE] || "").trim().toLowerCase();
  let phoneType: PhoneType = DEFAULT_PHONE_TYPE;
  if (PHONE_TYPES.includes(requestedType as PhoneType)) {
    phoneType = requestedType as PhoneType;
  } else if (requestedType) {
    logger.warn(
      { row: rowNumber, email: row[COL_EMAIL], phoneType: row[COL_PHONE_TYPE] },
      `Unrecognized ${COL_PHONE_TYPE} - defaulting to ${DEFAULT_PHONE_TYPE}`,
    );
  }

  return { [phoneType]: phone };
}

/**
 * Build the single contact for a row from its Billing Address. It is both the primary
 * Billing and primary Shipping contact. Returns undefined (with a warning) when the
 * address is missing or can't be parsed; the account is still created without it.
 */
function buildBillingContact(
  row: CustomerCsvRow,
  rowNumber: number,
): CustomerContact | undefined {
  const rawAddress = row[COL_BILLING_ADDRESS];
  const address = parseAddress(rawAddress);
  if (!address) {
    logger.warn(
      { row: rowNumber, email: row[COL_EMAIL], billingAddress: rawAddress },
      rawAddress
        ? "Could not parse Billing Address - account will be created without a contact"
        : "No Billing Address - account will be created without a contact",
    );
    return undefined;
  }

  const companyOrOrganization = row[COL_CUSTOMER_NAME];
  const { firstName, lastName } = splitFullName(row[COL_PRIMARY_CONTACT]);

  return {
    firstName,
    lastNameOrSurname: lastName,
    email: row[COL_EMAIL],
    companyOrOrganization,
    phoneNumbers: buildPhoneNumbers(row, rowNumber),
    types: [
      { name: "Billing", isPrimary: true },
      { name: "Shipping", isPrimary: true },
    ],
    address: {
      ...address,
      addressType: companyOrOrganization ? "Commercial" : "Residential",
      isValidated: true,
    },
  };
}

// Custom attributes persist through Add-Account-And-Login, so tenant~accountnumber and
// tenant~is-verified are sent here. Contacts don't persist, so they're added afterwards
// with addAccountContact.
function buildAccountPayload(row: CustomerCsvRow): CustomerAccountAndAuthInfo {
  const email = row[COL_EMAIL]!;
  const customerAccount = row[COL_CUSTOMER_ACCOUNT]!;
  const { firstName, lastName } = splitFullName(row[COL_PRIMARY_CONTACT]);
  const attributes: CustomerAttribute[] = [
    {
      fullyQualifiedName: ACCOUNT_NUMBER_ATTRIBUTE_FQN,
      values: [customerAccount],
    },
    {
      fullyQualifiedName: IS_VERIFIED_ATTRIBUTE_FQN,
      values: [true],
    },
  ];
  return {
    account: {
      emailAddress: email,
      userName: email,
      externalId: customerAccount,
      firstName,
      lastName,
      companyOrOrganization: row[COL_CUSTOMER_NAME],
      taxExempt: parseBoolean(row[COL_TAX_EXEMPT]),
      acceptsMarketing: false,
      isActive: true,
      attributes,
    },
    password: TEMP_PASSWORD,
  };
}

// Kibo filter values escape special characters with "^"
function escapeFilterValue(value: string): string {
  return value.replace(/[\^\/"',{}()]/g, (char) => `^${char}`);
}

async function findExistingAccountId(
  email: string,
): Promise<number | undefined> {
  const existingAccounts = await limiter.schedule(() =>
    customerAccountClient.getAccounts({
      filter: `emailAddress eq '${escapeFilterValue(email)}'`,
      pageSize: 1,
    }),
  );
  return existingAccounts.items?.[0]?.id ?? undefined;
}

type FailedContact = { types: string; error: string };

function describeContactTypes(contact: CustomerContact): string {
  return (contact.types || [])
    .map((type) => `${type.name}${type.isPrimary ? " (primary)" : ""}`)
    .join("+");
}

// Add each contact to the account. Failures are collected so the remaining contacts
// are still attempted.
async function addContacts(
  accountId: number,
  contacts: CustomerContact[],
  rowNumber: number,
): Promise<FailedContact[]> {
  const failedContacts: FailedContact[] = [];

  for (const contact of contacts) {
    const types = describeContactTypes(contact);
    try {
      const created = await limiter.schedule(() =>
        customerAccountClient.addAccountContact({
          accountId,
          customerContact: { ...contact, accountId },
        }),
      );
      logger.info(
        { row: rowNumber, accountId, contactId: created.id, types },
        "Added account contact",
      );
    } catch (error) {
      const msg = errorMessage(error);
      logger.error(
        { row: rowNumber, accountId, types, error: msg },
        "Error adding account contact",
      );
      failedContacts.push({ types, error: msg });
    }
  }

  return failedContacts;
}

/**
 * Creates a Kibo B2C account for each row of the CSV, with its tenant~accountnumber,
 * tenant~is-verified and taxExempt values, then adds its billing/shipping contact. All
 * API calls are throttled through the shared limiter.
 *
 * @param csvFilePath - Path to the customers CSV
 */
export async function importB2CAccountsFromCSV(csvFilePath: string) {
  const rows = readAccountsCsv(csvFilePath);

  const summary = {
    total: rows.length,
    created: 0,
    skipped: 0,
    failed: 0,
    noAddress: 0,
    contactFailed: 0,
  };
  const failedRows: Array<{ row: number; email?: string; error: string }> = [];
  const noAddressRows: Array<{
    row: number;
    email?: string;
    accountId: number;
    billingAddress?: string;
  }> = [];
  const contactFailures: Array<{
    row: number;
    email?: string;
    accountId: number;
    failedContacts: FailedContact[];
  }> = [];

  for (const [index, row] of rows.entries()) {
    // +2: 1-based, plus the header line, so it matches the line number in the CSV
    const rowNumber = index + 2;
    const email = row[COL_EMAIL];
    const customerAccount = row[COL_CUSTOMER_ACCOUNT];

    const invalidReason = validateRow(row);
    if (invalidReason) {
      logger.warn(
        { row: rowNumber, email, customerAccount, reason: invalidReason },
        "Skipping invalid row",
      );
      summary.skipped++;
      continue;
    }

    try {
      const existingAccountId = await findExistingAccountId(email!);
      if (existingAccountId) {
        logger.info(
          { row: rowNumber, email, customerAccount, customerAccountId: existingAccountId },
          "Account already exists - skipping",
        );
        summary.skipped++;
        continue;
      }

      // Built before the account is created so address problems are logged up front
      const contact = buildBillingContact(row, rowNumber);

      const payload = buildAccountPayload(row);
      const authTicket = await limiter.schedule(() =>
        customerAccountClient.addAccountAndLogin({
          customerAccountAndAuthInfo: payload,
        }),
      );
      const accountId = authTicket.customerAccount?.id;
      if (!accountId) {
        throw new Error("Add-Account-And-Login returned no customerAccount.id");
      }
      logger.info(
        {
          row: rowNumber,
          email,
          customerAccountId: accountId,
          customerAccount,
          taxExempt: payload.account?.taxExempt,
        },
        "Created customer account",
      );
      summary.created++;

      // Sanity check on the response we already have; no extra API call.
      // Kibo matches FQNs case-insensitively and echoes its own casing
      // (e.g. "Tenant~is-verified"), so compare lower-cased.
      const savedFqns = new Set(
        (authTicket.customerAccount?.attributes || []).map((attribute) =>
          attribute.fullyQualifiedName?.toLowerCase(),
        ),
      );
      for (const sent of payload.account?.attributes || []) {
        if (!savedFqns.has(sent.fullyQualifiedName?.toLowerCase())) {
          logger.warn(
            { row: rowNumber, email, accountId, values: sent.values },
            `${sent.fullyQualifiedName} missing from Add-Account-And-Login response`,
          );
        }
      }

      if (!contact) {
        summary.noAddress++;
        noAddressRows.push({
          row: rowNumber,
          email,
          accountId,
          billingAddress: row[COL_BILLING_ADDRESS],
        });
        continue;
      }

      const failedContacts = await addContacts(accountId, [contact], rowNumber);
      if (failedContacts.length > 0) {
        summary.contactFailed++;
        contactFailures.push({ row: rowNumber, email, accountId, failedContacts });
      }
    } catch (error) {
      const msg = errorMessage(error);
      logger.error(
        { row: rowNumber, email, customerAccount, error: msg },
        "Error importing row",
      );
      summary.failed++;
      failedRows.push({ row: rowNumber, email, error: msg });
    }
  }

  logger.info(summary, "B2C account import summary");
  if (failedRows.length > 0) {
    logger.error({ failedRows }, "Rows that failed to import");
  }
  if (noAddressRows.length > 0) {
    logger.warn({ noAddressRows }, "Accounts created without an address contact");
  }
  if (contactFailures.length > 0) {
    logger.error({ contactFailures }, "Accounts with contacts that failed");
  }

  return summary;
}

async function main() {
  const csvFilePath = process.argv[2];

  if (!csvFilePath) {
    logger.error(
      "No CSV file path provided. Usage: npx ts-node lib/importB2CAccountsFromCSV.ts <path-to-csv>",
    );
    process.exit(1);
  }

  logger.info(`Importing B2C accounts to Tenant: ${process.env.TENANT_ID}`);
  await importB2CAccountsFromCSV(csvFilePath);
  logger.info("*** B2C account import complete! ***");
}

// Only run when executed directly, so importB2CAccountsFromCSV can be imported elsewhere
if (require.main === module) {
  main().catch((error) => {
    logger.error({ error: errorMessage(error) }, "Unhandled error");
    process.exit(1);
  });
}
