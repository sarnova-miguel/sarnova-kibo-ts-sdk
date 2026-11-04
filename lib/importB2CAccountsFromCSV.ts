/**
 * This script imports B2C shopper accounts from a legacy-system CSV into Kibo.
 * For each row it creates the account (Add-Account-And-Login) with the legacy
 * fnoAccountNumber in the tenant~accountnumber account attribute and the is-verified flag
 * in the tenant~is-verified account attribute, then adds the billing and shipping
 * contacts. Rows whose email already exists in Kibo are skipped.
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

const PHONE_TYPES = ["home", "mobile", "work"] as const;
type PhoneType = (typeof PHONE_TYPES)[number];
const DEFAULT_PHONE_TYPE: PhoneType = "mobile";

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

// Fixed account columns. Address columns are read by prefix ("billing", "shipping",
// "shipping2", ...) so extra shipping groups need no code change.
type AccountCsvRow = {
  fnoAccountNumber?: string;
  "is-verified"?: string;
  emailAddress?: string;
  firstName?: string;
  lastName?: string;
  companyOrOrganization?: string;
  acceptsMarketing?: string;
  phone?: string;
  phoneType?: string;
  [column: string]: string | undefined;
};

type CsvAddress = {
  prefix: string;
  address1: string;
  address2: string;
  cityOrTown: string;
  stateOrProvince: string;
  postalOrZipCode: string;
  countryCode: string;
  isValidated: boolean;
};

const ADDRESS_FIELDS = [
  "Address1",
  "Address2",
  "CityOrTown",
  "StateOrProvince",
  "PostalOrZipCode",
  "CountryCode",
] as const;
const REQUIRED_ADDRESS_FIELDS = [
  "Address1",
  "CityOrTown",
  "PostalOrZipCode",
  "CountryCode",
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBoolean(value: string | undefined): boolean {
  return ["true", "1", "yes"].includes((value || "").trim().toLowerCase());
}

// Read the CSV and return one object per row, keyed by header
function readAccountsCsv(csvFilePath: string): AccountCsvRow[] {
  const resolvedPath = path.resolve(csvFilePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`CSV file not found: ${resolvedPath}`);
  }

  logger.info({ path: resolvedPath }, "Reading CSV file");
  const rows: AccountCsvRow[] = parse(fs.readFileSync(resolvedPath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  logger.info(
    { totalRows: rows.length, columns: rows.length ? Object.keys(rows[0]) : [] },
    "CSV file parsed successfully",
  );
  return rows;
}

// Shipping prefixes found in the headers, in order: "shipping", "shipping2", "shipping3", ...
function getShippingPrefixes(row: AccountCsvRow): string[] {
  return Object.keys(row)
    .map((column) => column.match(/^shipping(\d*)Address1$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .sort((a, b) => Number(a[1] || 1) - Number(b[1] || 1))
    .map((match) => `shipping${match[1]}`);
}

function hasAnyAddressField(row: AccountCsvRow, prefix: string): boolean {
  return ADDRESS_FIELDS.some((field) => row[`${prefix}${field}`]);
}

function missingAddressFields(row: AccountCsvRow, prefix: string): string[] {
  return REQUIRED_ADDRESS_FIELDS.filter((field) => !row[`${prefix}${field}`]).map(
    (field) => `${prefix}${field}`,
  );
}

function readAddress(row: AccountCsvRow, prefix: string): CsvAddress {
  return {
    prefix,
    address1: row[`${prefix}Address1`] || "",
    address2: row[`${prefix}Address2`] || "",
    cityOrTown: row[`${prefix}CityOrTown`] || "",
    stateOrProvince: row[`${prefix}StateOrProvince`] || "",
    postalOrZipCode: row[`${prefix}PostalOrZipCode`] || "",
    countryCode: row[`${prefix}CountryCode`] || "",
    isValidated: parseBoolean(row[`${prefix}IsValidated`]),
  };
}

// Every non-blank shipping group on the row, in prefix order
function getShippingAddresses(row: AccountCsvRow): CsvAddress[] {
  return getShippingPrefixes(row)
    .filter((prefix) => hasAnyAddressField(row, prefix))
    .map((prefix) => readAddress(row, prefix));
}

// Returns a reason the row can't be imported, or undefined if it's valid
function validateRow(row: AccountCsvRow): string | undefined {
  const email = row.emailAddress || "";
  if (!email || !email.includes("@")) {
    return "Missing or invalid emailAddress";
  }

  const missingBilling = missingAddressFields(row, "billing");
  if (missingBilling.length > 0) {
    return `Missing billing address fields: ${missingBilling.join(", ")}`;
  }

  for (const prefix of getShippingPrefixes(row)) {
    if (!hasAnyAddressField(row, prefix)) continue;
    const missingShipping = missingAddressFields(row, prefix);
    if (missingShipping.length > 0) {
      return `Incomplete ${prefix} address, missing: ${missingShipping.join(", ")}`;
    }
  }

  return undefined;
}

function buildPhoneNumbers(
  row: AccountCsvRow,
  rowNumber: number,
): CustomerContact["phoneNumbers"] {
  if (!row.phone) return undefined;

  const requestedType = (row.phoneType || "").trim().toLowerCase();
  let phoneType: PhoneType = DEFAULT_PHONE_TYPE;
  if (PHONE_TYPES.includes(requestedType as PhoneType)) {
    phoneType = requestedType as PhoneType;
  } else if (requestedType) {
    logger.warn(
      { row: rowNumber, email: row.emailAddress, phoneType: row.phoneType },
      `Unrecognized phoneType - defaulting to ${DEFAULT_PHONE_TYPE}`,
    );
  }

  return { [phoneType]: row.phone };
}

// Compare address lines only; isValidated is not part of the match
function addressKey(address: CsvAddress): string {
  return [
    address.address1,
    address.address2,
    address.cityOrTown,
    address.stateOrProvince,
    address.postalOrZipCode,
    address.countryCode,
  ]
    .map((value) => value.trim().toLowerCase())
    .join("|");
}

// Build the contacts for a row. Always returns at least 1 Billing and 1 Shipping type:
// a shipping address that matches billing is merged into the billing contact, and with
// no shipping addresses the billing contact is also the primary shipping address.
function buildContacts(
  row: AccountCsvRow,
  rowNumber: number,
): CustomerContact[] {
  const phoneNumbers = buildPhoneNumbers(row, rowNumber);

  const toContact = (
    address: CsvAddress,
    types: CustomerContact["types"],
  ): CustomerContact => ({
    firstName: row.firstName || undefined,
    lastNameOrSurname: row.lastName || undefined,
    email: row.emailAddress,
    companyOrOrganization: row.companyOrOrganization || undefined,
    phoneNumbers,
    types,
    address: {
      address1: address.address1,
      address2: address.address2 || undefined,
      cityOrTown: address.cityOrTown,
      stateOrProvince: address.stateOrProvince || undefined,
      postalOrZipCode: address.postalOrZipCode,
      countryCode: address.countryCode,
      addressType: "Residential",
      isValidated: address.isValidated,
    },
  });

  const billing = readAddress(row, "billing");
  const billingContact = toContact(billing, [
    { name: "Billing", isPrimary: true },
  ]);
  const contacts: CustomerContact[] = [billingContact];

  const shippingAddresses = getShippingAddresses(row);
  if (shippingAddresses.length === 0) {
    billingContact.types!.push({ name: "Shipping", isPrimary: true });
    return contacts;
  }

  const billingKey = addressKey(billing);
  const seenShippingKeys = new Set<string>();
  shippingAddresses.forEach((shipping, index) => {
    const isPrimary = index === 0;
    const key = addressKey(shipping);

    if (key === billingKey) {
      billingContact.types!.push({ name: "Shipping", isPrimary });
      billingContact.address!.isValidated =
        billing.isValidated || shipping.isValidated;
      seenShippingKeys.add(key);
      return;
    }
    if (seenShippingKeys.has(key)) {
      logger.warn(
        { row: rowNumber, email: row.emailAddress, prefix: shipping.prefix },
        "Duplicate shipping address - skipping",
      );
      return;
    }

    seenShippingKeys.add(key);
    contacts.push(toContact(shipping, [{ name: "Shipping", isPrimary }]));
  });

  return contacts;
}

// Custom attributes persist through Add-Account-And-Login, so tenant~accountnumber and
// tenant~is-verified are sent here. Contacts don't persist, so they're added afterwards
// with addAccountContact.
function buildAccountPayload(row: AccountCsvRow): CustomerAccountAndAuthInfo {
  const email = row.emailAddress!;
  const attributes: CustomerAttribute[] = [];
  if (row.fnoAccountNumber) {
    attributes.push({
      fullyQualifiedName: ACCOUNT_NUMBER_ATTRIBUTE_FQN,
      values: [row.fnoAccountNumber],
    });
  }
  // Blank, "null", or any unrecognized value is sent as false
  attributes.push({
    fullyQualifiedName: IS_VERIFIED_ATTRIBUTE_FQN,
    values: [parseBoolean(row["is-verified"])],
  });
  return {
    account: {
      emailAddress: email,
      userName: email,
      externalId: email,
      firstName: row.firstName || undefined,
      lastName: row.lastName || undefined,
      companyOrOrganization: row.companyOrOrganization || undefined,
      acceptsMarketing: parseBoolean(row.acceptsMarketing),
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
 * Creates a Kibo B2C account for each row of the CSV, with its tenant~accountnumber and
 * tenant~is-verified attributes, then adds its billing and shipping contacts. All API calls are throttled
 * through the shared limiter.
 *
 * @param csvFilePath - Path to the accounts CSV
 */
export async function importB2CAccountsFromCSV(csvFilePath: string) {
  const rows = readAccountsCsv(csvFilePath);

  const summary = {
    total: rows.length,
    created: 0,
    skipped: 0,
    failed: 0,
    contactFailed: 0,
  };
  const failedRows: Array<{ row: number; email?: string; error: string }> = [];
  const contactFailures: Array<{
    row: number;
    email?: string;
    accountId: number;
    failedContacts: FailedContact[];
  }> = [];

  for (const [index, row] of rows.entries()) {
    // +2: 1-based, plus the header line, so it matches the line number in the CSV
    const rowNumber = index + 2;
    const email = row.emailAddress;

    const invalidReason = validateRow(row);
    if (invalidReason) {
      logger.warn(
        { row: rowNumber, email, reason: invalidReason },
        "Skipping invalid row",
      );
      summary.skipped++;
      continue;
    }

    try {
      const existingAccountId = await findExistingAccountId(email!);
      if (existingAccountId) {
        logger.info(
          { row: rowNumber, email, customerAccountId: existingAccountId },
          "Account already exists - skipping",
        );
        summary.skipped++;
        continue;
      }

      // Built before the account is created so an address problem is caught before anything is written
      const contacts = buildContacts(row, rowNumber);

      const fnoAccountNumber = row.fnoAccountNumber;
      if (!fnoAccountNumber) {
        logger.warn(
          { row: rowNumber, email },
          `No fnoAccountNumber - ${ACCOUNT_NUMBER_ATTRIBUTE_FQN} will not be set`,
        );
      }

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
          fnoAccountNumber,
          isVerified: parseBoolean(row["is-verified"]),
        },
        "Created customer account",
      );
      summary.created++;

      // Sanity check on the response we already have; no extra API call
      const savedFqns = new Set(
        (authTicket.customerAccount?.attributes || []).map(
          (attribute) => attribute.fullyQualifiedName,
        ),
      );
      for (const sent of payload.account?.attributes || []) {
        if (!savedFqns.has(sent.fullyQualifiedName)) {
          logger.warn(
            { row: rowNumber, email, accountId, values: sent.values },
            `${sent.fullyQualifiedName} missing from Add-Account-And-Login response`,
          );
        }
      }

      const failedContacts = await addContacts(accountId, contacts, rowNumber);
      if (failedContacts.length > 0) {
        summary.contactFailed++;
        contactFailures.push({ row: rowNumber, email, accountId, failedContacts });
      }
    } catch (error) {
      const msg = errorMessage(error);
      logger.error({ row: rowNumber, email, error: msg }, "Error importing row");
      summary.failed++;
      failedRows.push({ row: rowNumber, email, error: msg });
    }
  }

  logger.info(summary, "B2C account import summary");
  if (failedRows.length > 0) {
    logger.error({ failedRows }, "Rows that failed to import");
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
