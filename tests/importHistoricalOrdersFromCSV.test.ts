import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// fs: existsSync always true; readFileSync returns whatever CSV text the test sets
let csvText = "";
jest.mock("fs", () => ({
  __esModule: true,
  existsSync: jest.fn(() => true),
  readFileSync: jest.fn(() => csvText),
}));

jest.mock("dotenv", () => ({ __esModule: true, config: jest.fn() }));

// Silence pino logging and avoid worker threads/transports during tests
jest.mock("pino", () => {
  const noopLogger: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    level: "silent",
  };
  noopLogger.child = jest.fn(() => noopLogger);
  const pinoFn: any = jest.fn(() => noopLogger);
  pinoFn.transport = jest.fn(() => ({}));
  return { __esModule: true, default: pinoFn };
});

// Bottleneck mock - run scheduled tasks immediately
jest.mock("bottleneck", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    schedule: (fn: () => Promise<any>) => fn(),
    on: jest.fn(),
  })),
}));

jest.mock("@kibocommerce/rest-sdk", () => ({
  __esModule: true,
  Configuration: jest.fn().mockImplementation((opts: any) => ({ ...opts })),
}));

type AnyAsyncFn = (...args: any[]) => Promise<any>;
const getOrdersMock = jest.fn<AnyAsyncFn>();
const createOrderMock = jest.fn<AnyAsyncFn>();
const getAccountsMock = jest.fn<AnyAsyncFn>();

jest.mock("@kibocommerce/rest-sdk/clients/Commerce", () => ({
  __esModule: true,
  OrderApi: jest.fn().mockImplementation(() => ({
    getOrders: getOrdersMock,
    createOrder: createOrderMock,
  })),
}));

jest.mock("@kibocommerce/rest-sdk/clients/Customer", () => ({
  __esModule: true,
  CustomerAccountApi: jest.fn().mockImplementation(() => ({
    getAccounts: getAccountsMock,
  })),
}));

import {
  OrderCsvRow,
  OrderGroup,
  buildOrder,
  coerceValue,
  compareCreatedOrder,
  groupRowsByOrder,
  importHistoricalOrdersFromCSV,
  isRetryableError,
  parseArgs,
  validateOrder,
} from "../lib/importHistoricalOrdersFromCSV";

function row(overrides: OrderCsvRow = {}): OrderCsvRow {
  return {
    orderNumber: "SS-1",
    isImport: "true",
    isHistoricalImport: "true",
    customerAccountId: "C0001",
    email: "a@example.com",
    isTaxExempt: "false",
    "billingInfo.paymentType": "CreditCard",
    "billingInfo.billingContact.address.cityOrTown": "Moberly",
    "payments.paymentType": "CreditCard",
    "payments.amountRequested": "110.00",
    "payments.interactions.interactionType": "Capture",
    "payments.interactions.amount": "110.00",
    "payments.interactions.isManual": "true",
    subtotal: "100.00",
    shippingTotal: "10.00",
    handlingTotal: "0.00",
    total: "110.00",
    "extendedProperties.invoiceNumber": "600226598",
    "extendedProperties.shippingAccount": undefined,
    "notes.text": "Credit Card PMT",
    "items.lineId": "1",
    "items.product.productCode": "SKU-1",
    "items.quantity": "2",
    "items.unitPrice.listAmount": "50.00",
    "items.total": "100.00",
    _sourceRow: "12",
    ...overrides,
  };
}

function group(rows: OrderCsvRow[], orderNumber = "SS-1"): OrderGroup {
  return { orderNumber, rows, csvLines: rows.map((_, i) => i + 2) };
}

function csvFrom(rows: OrderCsvRow[]): string {
  const columns = Object.keys(rows[0]);
  const quote = (value: string | undefined) => `"${(value ?? "").replace(/"/g, '""')}"`;
  return [
    columns.map(quote).join(","),
    ...rows.map((r) => columns.map((c) => quote(r[c])).join(",")),
  ].join("\n");
}

describe("groupRowsByOrder", () => {
  it("groups rows by orderNumber in file order with CSV line numbers", () => {
    const groups = groupRowsByOrder([
      row({ orderNumber: "A" }),
      row({ orderNumber: "B" }),
      row({ orderNumber: "A", "items.lineId": "2" }),
    ]);
    expect(groups.map((g) => [g.orderNumber, g.csvLines])).toEqual([
      ["A", [2, 4]],
      ["B", [3]],
    ]);
  });

  it("puts each row without an orderNumber in its own group", () => {
    const groups = groupRowsByOrder([row({ orderNumber: undefined }), row({ orderNumber: undefined })]);
    expect(groups).toHaveLength(2);
    expect(groups[0].orderNumber).toBe("");
  });
});

describe("coerceValue", () => {
  it("converts booleans, integers, and amounts; leaves other columns as strings", () => {
    expect(coerceValue("isTaxExempt", "TRUE")).toBe(true);
    expect(coerceValue("payments.interactions.isManual", "false")).toBe(false);
    expect(coerceValue("items.quantity", "10")).toBe(10);
    expect(coerceValue("total", "$1,775.91")).toBe(1775.91);
    expect(coerceValue("items.unitPrice.listAmount", "75.00")).toBe(75);
    expect(coerceValue("payments.amountRequested", "780.33")).toBe(780.33);
    expect(coerceValue("shippingSubTotal", "30.33")).toBe(30.33);
    expect(coerceValue("fulfillmentInfo.fulfillmentContact.address.postalOrZipCode", "06510")).toBe("06510");
    expect(coerceValue("items.product.productCode", "8900-0402")).toBe("8900-0402");
  });

  it("throws on values that don't fit the column type", () => {
    expect(() => coerceValue("isTaxExempt", "maybe")).toThrow("not a boolean");
    expect(() => coerceValue("items.quantity", "1.5")).toThrow("not a whole number");
    expect(() => coerceValue("total", "abc")).toThrow("not a number");
  });
});

describe("validateOrder", () => {
  it("accepts a valid order", () => {
    expect(validateOrder(group([row(), row({ "items.lineId": "2" })]))).toEqual([]);
  });

  it("reports missing required fields", () => {
    const errors = validateOrder(
      group([row({ email: undefined, customerAccountId: undefined, "items.quantity": undefined })]),
    );
    expect(errors).toEqual([
      "Missing email",
      "Missing customerAccountId",
      "Line 2: missing items.quantity",
    ]);
  });

  it("reports order-level values that differ between rows, ignoring items and helper columns", () => {
    const errors = validateOrder(
      group([row(), row({ total: "999.00", "items.lineId": "2", _sourceRow: "13" })]),
    );
    expect(errors).toEqual(['total differs between rows of the same order: "110.00", "999.00"']);
  });
});

describe("buildOrder", () => {
  it("unflattens the rows into a Kibo Order", () => {
    const { order, warnings } = buildOrder(
      group([
        row({ "items.total": "60.00" }),
        row({ "items.lineId": "2", "items.product.productCode": "SKU-2", "items.total": "40.00" }),
      ]),
    );

    expect(warnings).toEqual([]);
    expect(order).toMatchObject({
      externalId: "SS-1",
      email: "a@example.com",
      isTaxExempt: false,
      total: 110,
      billingInfo: { paymentType: "CreditCard", billingContact: { address: { cityOrTown: "Moberly" } } },
      payments: [
        {
          paymentType: "CreditCard",
          amountRequested: 110,
          interactions: [{ interactionType: "Capture", amount: 110, isManual: true }],
        },
      ],
      notes: [{ text: "Credit Card PMT" }],
      extendedProperties: [{ key: "invoiceNumber", value: "600226598" }],
      items: [
        { lineId: 1, product: { productCode: "SKU-1" }, quantity: 2, unitPrice: { listAmount: 50 }, total: 60 },
        { lineId: 2, product: { productCode: "SKU-2" }, total: 40 },
      ],
    });
  });

  it("sends the legacy account number as the tenant~accountNumber order attribute", () => {
    const { order } = buildOrder(group([row()]));
    expect(order.attributes).toEqual([
      { fullyQualifiedName: "tenant~accountNumber", values: ["C0001"] },
    ]);
  });

  it("doesn't send orderNumber, customerAccountId, or helper columns", () => {
    const { order, helperColumns } = buildOrder(group([row()]));
    expect(order).not.toHaveProperty("orderNumber");
    expect(order).not.toHaveProperty("customerAccountId");
    expect(order).not.toHaveProperty("_sourceRow");
    expect(helperColumns).toEqual([{ _sourceRow: "12" }]);
  });

  it("always sets isImport and isHistoricalImport to true", () => {
    const fromFalse = buildOrder(group([row({ isImport: "false", isHistoricalImport: "no" })]));
    expect(fromFalse.order.isImport).toBe(true);
    expect(fromFalse.order.isHistoricalImport).toBe(true);
    expect(fromFalse.warnings).toEqual([
      'isImport is "false" in the CSV; ignored and sent as true',
      'isHistoricalImport is "no" in the CSV; ignored and sent as true',
    ]);

    const fromBlank = buildOrder(group([row({ isImport: undefined, isHistoricalImport: undefined })]));
    expect(fromBlank.order.isImport).toBe(true);
    expect(fromBlank.order.isHistoricalImport).toBe(true);
    expect(fromBlank.warnings).toEqual([]);
  });

  it("always sets status Completed, paymentStatus Paid, and fulfillmentStatus Fulfilled", () => {
    expect(buildOrder(group([row()])).order).toMatchObject({
      status: "Completed",
      paymentStatus: "Paid",
      fulfillmentStatus: "Fulfilled",
    });

    const fromCsv = buildOrder(group([row({ status: "Open", paymentStatus: "Pending" })]));
    expect(fromCsv.order).toMatchObject({ status: "Completed", paymentStatus: "Paid" });
    expect(fromCsv.warnings).toEqual([
      'status is "Open" in the CSV; ignored and sent as Completed',
      'paymentStatus is "Pending" in the CSV; ignored and sent as Paid',
    ]);

    expect(
      buildOrder(group([row({ status: "completed", fulfillmentStatus: "FULFILLED" })])).warnings,
    ).toEqual([]);
  });

  it("omits blank sections", () => {
    const { order } = buildOrder(
      group([row({ "notes.text": undefined, "extendedProperties.invoiceNumber": undefined })]),
    );
    expect(order).not.toHaveProperty("notes");
    expect(order).not.toHaveProperty("extendedProperties");
  });

  it("truncates long notes with a warning", () => {
    const { order, warnings } = buildOrder(group([row({ "notes.text": "x".repeat(300) })]));
    expect(order.notes?.[0].text).toHaveLength(250);
    expect(warnings).toEqual(["notes.text is 300 characters; truncated to 250"]);
  });

  it("warns when line items don't add up to the order total", () => {
    const { warnings } = buildOrder(group([row({ "items.total": "90.00" })]));
    expect(warnings).toEqual([
      "Sum of items.total (90.00) doesn't match total - shippingTotal - handlingTotal (100.00)",
    ]);
  });

  it("throws on unconvertible values", () => {
    expect(() => buildOrder(group([row({ total: "lots" })]))).toThrow('total: "lots" is not a number');
  });
});

describe("compareCreatedOrder", () => {
  const sent = {
    total: 110,
    customerAccountId: 5,
    isImport: true,
    isHistoricalImport: true,
    status: "Completed",
    paymentStatus: "Paid",
    fulfillmentStatus: "Fulfilled",
    attributes: [{ fullyQualifiedName: "tenant~accountNumber", values: ["C0001"] }],
  };

  it("returns no warnings when Kibo kept the values, ignoring attribute name casing", () => {
    expect(
      compareCreatedOrder(sent, {
        ...sent,
        total: 110.004,
        attributes: [{ fullyQualifiedName: "Tenant~AccountNumber", values: ["C0001"] }],
      }),
    ).toEqual([]);
  });

  it("reports values Kibo changed", () => {
    expect(
      compareCreatedOrder(sent, {
        ...sent,
        total: 120,
        isHistoricalImport: false,
        status: "Pending",
        fulfillmentStatus: "NotFulfilled",
      }),
    ).toEqual([
      "Kibo total 120 differs from CSV total 110",
      "isHistoricalImport is false in Kibo's response",
      "status is Pending in Kibo's response; sent Completed",
      "fulfillmentStatus is NotFulfilled in Kibo's response; sent Fulfilled",
    ]);
  });

  it("reports a missing or changed account number attribute", () => {
    expect(compareCreatedOrder(sent, { ...sent, attributes: [] })).toEqual([
      "tenant~accountNumber missing from Kibo's response - is it defined as an Order attribute?",
    ]);
    expect(
      compareCreatedOrder(sent, {
        ...sent,
        attributes: [{ fullyQualifiedName: "tenant~accountNumber", values: ["other"] }],
      }),
    ).toEqual(['tenant~accountNumber is ["other"] in Kibo\'s response; sent ["C0001"]']);
  });
});

describe("isRetryableError", () => {
  it("retries 429, 5xx, and network errors only", () => {
    expect(isRetryableError({ response: { status: 429 } })).toBe(true);
    expect(isRetryableError({ response: { status: 503 } })).toBe(true);
    expect(isRetryableError({ response: { status: 400 } })).toBe(false);
    expect(isRetryableError({ name: "FetchError" })).toBe(true);
    expect(isRetryableError(new Error("boom"))).toBe(false);
  });
});

describe("parseArgs", () => {
  it("parses the path and flags", () => {
    expect(parseArgs(["orders.csv", "--dry-run", "--limit", "3"])).toEqual({
      csvFilePath: "orders.csv",
      options: { dryRun: true, limit: 3 },
    });
  });

  it("rejects a missing path, a bad limit, and unknown flags", () => {
    expect(parseArgs([]).error).toBe("No CSV file path provided");
    expect(parseArgs(["a.csv", "--limit", "0"]).error).toBe("--limit needs a positive whole number");
    expect(parseArgs(["a.csv", "--force"]).error).toBe("Unknown option --force");
  });
});

describe("importHistoricalOrdersFromCSV", () => {
  beforeEach(() => {
    getOrdersMock.mockReset();
    createOrderMock.mockReset();
    getAccountsMock.mockReset();
    getOrdersMock.mockResolvedValue({ items: [] });
    createOrderMock.mockImplementation(async ({ order }: any) => ({ id: "k1", orderNumber: 1001, ...order }));
  });

  it("creates new orders with the Kibo account ID and skips existing, missing-account, and invalid ones", async () => {
    csvText = csvFrom([
      row({ orderNumber: "NEW-1", customerAccountId: "C-OK" }),
      row({ orderNumber: "NEW-1", customerAccountId: "C-OK", "items.lineId": "2", "items.total": "0.00" }),
      row({ orderNumber: "EXISTS", customerAccountId: "C-OK" }),
      row({ orderNumber: "NO-ACCT", customerAccountId: "C-MISSING" }),
      row({ orderNumber: "BAD", customerAccountId: "C-OK", email: "" }),
      row({ orderNumber: "NEW-2", customerAccountId: "C-OK" }),
    ]);
    getOrdersMock.mockImplementation(async ({ filter }: any) =>
      filter === "externalId eq 'EXISTS'" ? { items: [{ id: "old" }] } : { items: [] },
    );
    getAccountsMock.mockImplementation(async ({ filter }: any) =>
      filter === "externalId eq 'C-OK'" ? { items: [{ id: 42 }] } : { items: [] },
    );

    const summary = await importHistoricalOrdersFromCSV("orders.csv");

    expect(summary).toMatchObject({
      totalOrders: 5,
      created: 2,
      skippedExisting: 1,
      missingAccount: 1,
      skippedInvalid: 1,
      failed: 0,
    });
    expect(createOrderMock).toHaveBeenCalledTimes(2);
    const firstOrder = (createOrderMock.mock.calls[0][0] as any).order;
    expect(firstOrder).toMatchObject({
      externalId: "NEW-1",
      customerAccountId: 42,
      isImport: true,
      isHistoricalImport: true,
      status: "Completed",
      paymentStatus: "Paid",
      fulfillmentStatus: "Fulfilled",
      attributes: [{ fullyQualifiedName: "tenant~accountNumber", values: ["C-OK"] }],
    });
    expect(firstOrder.items).toHaveLength(2);
    // Account lookups are cached per legacy account number
    expect(getAccountsMock).toHaveBeenCalledTimes(2);
  });

  it("counts API errors as failed and keeps going", async () => {
    csvText = csvFrom([
      row({ orderNumber: "ERR", customerAccountId: "C-ERR" }),
      row({ orderNumber: "OK", customerAccountId: "C-ERR" }),
    ]);
    getAccountsMock.mockResolvedValue({ items: [{ id: 7 }] });
    createOrderMock.mockRejectedValueOnce(
      Object.assign(new Error("Validation error"), { response: { status: 400 } }),
    );

    const summary = await importHistoricalOrdersFromCSV("orders.csv");

    expect(summary).toMatchObject({ created: 1, failed: 1 });
  });

  it("doesn't create orders in a dry run, and honors --limit", async () => {
    csvText = csvFrom([
      row({ orderNumber: "D1", customerAccountId: "C-DRY" }),
      row({ orderNumber: "D2", customerAccountId: "C-DRY" }),
    ]);
    getAccountsMock.mockResolvedValue({ items: [{ id: 9 }] });

    const summary = await importHistoricalOrdersFromCSV("orders.csv", { dryRun: true, limit: 1 });

    expect(summary).toMatchObject({ totalOrders: 1, wouldCreate: 1, created: 0 });
    expect(createOrderMock).not.toHaveBeenCalled();
  });
});
