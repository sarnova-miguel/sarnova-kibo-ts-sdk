import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import * as path from "path";

// fs mocks: writeFileSync captures the summary CSV; readFileSync returns the
// basename as a marker so the csv/sync parse mock can look up rows by file
const existsSyncMock = jest.fn().mockReturnValue(true);
const readFileSyncMock = jest.fn();
const writeFileSyncMock = jest.fn();

jest.mock("fs", () => ({
  __esModule: true,
  existsSync: (...args: any[]) => existsSyncMock(...args),
  readFileSync: (...args: any[]) => readFileSyncMock(...args),
  writeFileSync: (...args: any[]) => writeFileSyncMock(...args),
}));

jest.mock("dotenv", () => ({ __esModule: true, config: jest.fn() }));

// Silence pino logging and avoid worker threads/transports during tests
jest.mock("pino", () => {
  const noopLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    level: "silent",
  };
  const pinoFn: any = jest.fn(() => noopLogger);
  pinoFn.transport = jest.fn(() => ({}));
  return { __esModule: true, default: pinoFn };
});

// Bottleneck mock - run scheduled tasks immediately
jest.mock("bottleneck", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    schedule: (fn: () => Promise<any>) => fn(),
  })),
}));

// csv/sync mocks - parse looks up rows by filename marker; stringify renders
// a tab-delimited string (a delimiter the source data cannot contain) so the
// tests can parse it back into rows even when fields hold JSON with commas
const csvRowsByFile: Record<string, Record<string, string>[]> = {};
jest.mock("csv/sync", () => ({
  __esModule: true,
  parse: jest.fn((content: string) => csvRowsByFile[content] ?? []),
  stringify: jest.fn(
    (rows: Record<string, string>[], opts: { columns: string[] }) =>
      `${opts.columns.join("\t")}\n${rows
        .map((r) => opts.columns.map((c) => r[c] ?? "").join("\t"))
        .join("\n")}\n`,
  ),
}));

jest.mock("@kibocommerce/rest-sdk", () => ({
  __esModule: true,
  Configuration: jest.fn().mockImplementation((opts: any) => ({ ...opts })),
}));

type AnyAsyncFn = (...args: any[]) => Promise<any>;
const getProductVariationsMock = jest.fn<AnyAsyncFn>();
const updateProductVariationsMock = jest.fn<AnyAsyncFn>();

jest.mock(
  "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductVariationsApi",
  () => ({
    __esModule: true,
    ProductVariationsApi: jest.fn().mockImplementation(() => ({
      getProductVariations: getProductVariationsMock,
      updateProductVariations: updateProductVariationsMock,
    })),
  }),
);

function setCsv(name: string, rows: Record<string, string>[]) {
  csvRowsByFile[name] = rows;
}
function clearCsv() {
  for (const k of Object.keys(csvRowsByFile)) delete csvRowsByFile[k];
}

// readFileSync returns the basename so parse can look up the rows
readFileSyncMock.mockImplementation((...args: unknown[]) =>
  path.basename(args[0] as string),
);

async function flushAsync() {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

function resetMocks() {
  getProductVariationsMock.mockReset();
  updateProductVariationsMock.mockReset();
  writeFileSyncMock.mockReset();
  existsSyncMock.mockReset();
  existsSyncMock.mockReturnValue(true);
}

const expectedExportDir = path.join(__dirname, "..", "exports");
const expectedSummaryPath = path.join(
  expectedExportDir,
  "variationCodeMigration.csv",
);

// Helper - locate the summary CSV write call and parse it back into rows
function readSummaryRows(): Record<string, string>[] {
  const call = writeFileSyncMock.mock.calls.find(
    (c: any[]) => c[0] === expectedSummaryPath,
  );
  expect(call).toBeDefined();
  const content = String(call![1]);
  const lines = content.trim().split("\n");
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

// Source CSV rows shared across happy-path and PUT-failure scenarios. Includes
// one row with a missing attributeFQN that the loader must drop, plus five
// distinct variations that exercise every migration status.
const sourceRows: Record<string, string>[] = [
  {
    productCode: "P1",
    variationProductCode: "P1-A",
    attributeFQN: "tenant~color",
    value: "Red",
  },
  {
    productCode: "P1",
    variationProductCode: "P1-A",
    attributeFQN: "tenant~size",
    value: "L",
  },
  {
    productCode: "P1",
    variationProductCode: "P1-B",
    attributeFQN: "tenant~color",
    value: "Blue",
  },
  {
    productCode: "P1",
    variationProductCode: "P1-B",
    attributeFQN: "tenant~size",
    value: "M",
  },
  {
    productCode: "P1",
    variationProductCode: "P1-C",
    attributeFQN: "tenant~color",
    value: "Green",
  },
  {
    productCode: "P1",
    variationProductCode: "P1-C",
    attributeFQN: "tenant~size",
    value: "S",
  },
  {
    productCode: "P1",
    variationProductCode: "P1-D",
    attributeFQN: "tenant~color",
    value: "Yellow",
  },
  {
    productCode: "P1",
    variationProductCode: "P1-D",
    attributeFQN: "tenant~size",
    value: "XL",
  },
  {
    productCode: "P1",
    variationProductCode: "P1-E",
    attributeFQN: "tenant~color",
    value: "Pink",
  },
  {
    productCode: "P1",
    variationProductCode: "P1-E",
    attributeFQN: "tenant~size",
    value: "XS",
  },
  {
    productCode: "P1",
    variationProductCode: "P1-X",
    attributeFQN: "",
    value: "ignored",
  },
];

// Destination variations covering every status path. Note that semanticValue
// prefers content.stringValue; size rows fall back to raw value because
// stringValue is null.
function destinationVariationsForP1() {
  const sizeOption = (v: string) => ({
    attributeFQN: "tenant~size",
    value: v,
    content: { stringValue: null },
  });
  const colorOption = (label: string, code: number) => ({
    attributeFQN: "tenant~color",
    value: code,
    content: { stringValue: label },
  });
  return [
    // Red+L: never assigned, inactive - should be migrated and activated
    {
      variationkey: null,
      variationProductCode: null,
      isActive: false,
      options: [colorOption("Red", 1), sizeOption("L")],
    },
    // Blue+M: already set to the source code AND active - already_set
    {
      variationkey: "K2",
      variationProductCode: "P1-B",
      isActive: true,
      options: [colorOption("Blue", 2), sizeOption("M")],
    },
    // Green+S: assigned to a different code - conflict_existing_code
    {
      variationkey: "K3",
      variationProductCode: "OTHER",
      isActive: true,
      options: [colorOption("Green", 3), sizeOption("S")],
    },
    // (Yellow+XL intentionally missing - not_found_in_destination)
    // Pink+XS: code already matches source but inactive - migrated to activate
    {
      variationkey: "K5",
      variationProductCode: "P1-E",
      isActive: false,
      options: [colorOption("Pink", 5), sizeOption("XS")],
    },
  ];
}

describe("importTenantProductVariations - happy path", () => {
  beforeAll(async () => {
    process.env.TENANT_ID = "12345";
    clearCsv();
    resetMocks();
    setCsv("productVariations.csv", sourceRows);

    getProductVariationsMock.mockResolvedValue({
      items: destinationVariationsForP1(),
      totalCount: 4,
    });
    updateProductVariationsMock.mockResolvedValue({});

    jest.isolateModules(() => {
      require("../lib/importTenantProductVariations");
    });
    await flushAsync();
  });

  it("fetches destination variations once per source product", () => {
    expect(getProductVariationsMock).toHaveBeenCalledTimes(1);
    expect(getProductVariationsMock).toHaveBeenCalledWith({
      productCode: "P1",
      pageSize: 200,
      startIndex: 0,
    });
  });

  it("sends a single bulk PUT containing only the variations that need writes", () => {
    expect(updateProductVariationsMock).toHaveBeenCalledTimes(1);
    const arg: any = (updateProductVariationsMock.mock.calls[0] as any)[0];
    expect(arg.productCode).toBe("P1");
    const items = arg.productVariationCollection.items;
    expect(items).toHaveLength(2);

    const byCode = new Map<string, any>(
      items.map((it: any) => [it.variationProductCode, it]),
    );

    // P1-A: dest variationkey was null, so the item must omit variationkey
    // and rely on the options tuple to match server-side.
    const redItem = byCode.get("P1-A");
    expect(redItem).toBeDefined();
    expect(redItem.isActive).toBe(true);
    expect(redItem.variationkey).toBeUndefined();
    expect(redItem.options).toHaveLength(2);

    // P1-E: dest variationkey present, must be forwarded and isActive flipped
    const pinkItem = byCode.get("P1-E");
    expect(pinkItem).toBeDefined();
    expect(pinkItem.isActive).toBe(true);
    expect(pinkItem.variationkey).toBe("K5");
    expect(pinkItem.options).toHaveLength(2);
  });

  it("writes the migration summary CSV to the exports directory", () => {
    const writtenPaths = writeFileSyncMock.mock.calls.map((c: any[]) => c[0]);
    expect(writtenPaths).toContain(expectedSummaryPath);
  });

  it("records one summary row per source variation with the correct status", () => {
    const rows = readSummaryRows();
    expect(rows).toHaveLength(5);
    const statusByCode = new Map(
      rows.map((r) => [r.variationProductCode, r.status]),
    );
    expect(statusByCode.get("P1-A")).toBe("migrated");
    expect(statusByCode.get("P1-B")).toBe("already_set");
    expect(statusByCode.get("P1-C")).toBe("conflict_existing_code");
    expect(statusByCode.get("P1-D")).toBe("not_found_in_destination");
    expect(statusByCode.get("P1-E")).toBe("migrated");
  });
});

describe("importTenantProductVariations - missing source CSV", () => {
  beforeAll(async () => {
    process.env.TENANT_ID = "12345";
    clearCsv();
    resetMocks();
    existsSyncMock.mockReturnValue(false);

    jest.isolateModules(() => {
      require("../lib/importTenantProductVariations");
    });
    await flushAsync();
  });

  it("does not call the variations API when the source CSV is missing", () => {
    expect(getProductVariationsMock).not.toHaveBeenCalled();
    expect(updateProductVariationsMock).not.toHaveBeenCalled();
  });

  it("does not write a migration summary when the source CSV is missing", () => {
    const writtenPaths = writeFileSyncMock.mock.calls.map((c: any[]) => c[0]);
    expect(writtenPaths).not.toContain(expectedSummaryPath);
  });
});

describe("importTenantProductVariations - destination fetch fails", () => {
  beforeAll(async () => {
    process.env.TENANT_ID = "12345";
    clearCsv();
    resetMocks();
    setCsv("productVariations.csv", sourceRows);

    getProductVariationsMock.mockRejectedValue(new Error("boom"));

    jest.isolateModules(() => {
      require("../lib/importTenantProductVariations");
    });
    await flushAsync();
  });

  it("skips the bulk PUT when destination variations cannot be fetched", () => {
    expect(getProductVariationsMock).toHaveBeenCalledTimes(1);
    expect(updateProductVariationsMock).not.toHaveBeenCalled();
  });

  it("marks every source variation as error in the summary", () => {
    const rows = readSummaryRows();
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.status).toBe("error");
    }
  });
});

describe("importTenantProductVariations - PUT update fails", () => {
  beforeAll(async () => {
    process.env.TENANT_ID = "12345";
    clearCsv();
    resetMocks();
    setCsv("productVariations.csv", sourceRows);

    getProductVariationsMock.mockResolvedValue({
      items: destinationVariationsForP1(),
      totalCount: 4,
    });
    updateProductVariationsMock.mockRejectedValue(new Error("put failed"));

    jest.isolateModules(() => {
      require("../lib/importTenantProductVariations");
    });
    await flushAsync();
  });

  it("still writes a summary that downgrades migrated rows to error", () => {
    const rows = readSummaryRows();
    const statusByCode = new Map(
      rows.map((r) => [r.variationProductCode, r.status]),
    );
    // Previously-migrated rows are downgraded; non-migrated statuses are kept
    expect(statusByCode.get("P1-A")).toBe("error");
    expect(statusByCode.get("P1-E")).toBe("error");
    expect(statusByCode.get("P1-B")).toBe("already_set");
    expect(statusByCode.get("P1-C")).toBe("conflict_existing_code");
    expect(statusByCode.get("P1-D")).toBe("not_found_in_destination");
  });
});
