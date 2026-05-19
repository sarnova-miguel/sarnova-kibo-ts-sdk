import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import * as path from "path";

// Side-effect mocks for fs
const writeFileSyncMock = jest.fn();
const mkdirSyncMock = jest.fn();
const existsSyncMock = jest.fn().mockReturnValue(false);

jest.mock("fs", () => ({
  __esModule: true,
  existsSync: (...args: any[]) => existsSyncMock(...args),
  mkdirSync: (...args: any[]) => mkdirSyncMock(...args),
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

// Pass-through stringify so we can assert the CSV content shape
jest.mock("csv/sync", () => ({
  __esModule: true,
  stringify: jest.fn(
    (rows: Record<string, string>[], opts: { columns: string[] }) =>
      `${opts.columns.join(",")}\n${rows
        .map((r) => opts.columns.map((c) => r[c] ?? "").join(","))
        .join("\n")}\n`,
  ),
}));

jest.mock("@kibocommerce/rest-sdk", () => ({
  __esModule: true,
  Configuration: jest.fn().mockImplementation((opts: any) => ({ ...opts })),
}));

// API client mocks
type AnyAsyncFn = (...args: any[]) => Promise<any>;
const getProductsMock = jest.fn<AnyAsyncFn>();
const getProductVariationsMock = jest.fn<AnyAsyncFn>();

jest.mock(
  "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductsApi",
  () => ({
    __esModule: true,
    ProductsApi: jest
      .fn()
      .mockImplementation(() => ({ getProducts: getProductsMock })),
  }),
);

jest.mock(
  "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductVariationsApi",
  () => ({
    __esModule: true,
    ProductVariationsApi: jest.fn().mockImplementation(() => ({
      getProductVariations: getProductVariationsMock,
    })),
  }),
);

describe("exportTenantProductVariations", () => {
  const expectedExportDir = path.join(__dirname, "..", "exports");
  const expectedFilePath = path.join(
    expectedExportDir,
    "productVariations.csv",
  );

  beforeAll(async () => {
    process.env.TENANT_ID = "12345";

    // Single page of parent configurable products (< pageSize triggers stop)
    getProductsMock.mockResolvedValue({
      items: [{ productCode: "PARENT-1" }, { productCode: "PARENT-2" }],
      totalCount: 2,
    });

    // Variations per parent product
    getProductVariationsMock.mockImplementation(
      async ({ productCode }: { productCode: string }) => {
        if (productCode === "PARENT-1") {
          return {
            items: [
              {
                variationProductCode: "PARENT-1-A",
                options: [
                  {
                    attributeFQN: "tenant~color",
                    value: 1,
                    content: { stringValue: "Red" },
                  },
                  {
                    attributeFQN: "tenant~size",
                    value: "L",
                    content: { stringValue: null },
                  },
                ],
              },
              // Skipped: missing variationProductCode
              { options: [{ attributeFQN: "tenant~color", value: 2 }] },
              // Skipped: empty options
              { variationProductCode: "PARENT-1-B", options: [] },
            ],
            totalCount: 3,
          };
        }
        if (productCode === "PARENT-2") {
          return {
            items: [
              {
                variationProductCode: "PARENT-2-A",
                options: [
                  {
                    attributeFQN: "tenant~material",
                    value: { code: "wool" },
                    content: { stringValue: "" },
                  },
                ],
              },
            ],
            totalCount: 1,
          };
        }
        return { items: [], totalCount: 0 };
      },
    );

    // Require module under test after mocks are wired; main() runs on import
    require("../lib/exportTenantProductVariations");

    // Allow the chained awaits inside main() to settle
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setImmediate(r));
    }
  });

  it("creates the exports directory when missing", () => {
    expect(existsSyncMock).toHaveBeenCalledWith(expectedExportDir);
    expect(mkdirSyncMock).toHaveBeenCalledWith(expectedExportDir, {
      recursive: true,
    });
  });

  it("queries products filtered by hasConfigurableOptions eq true", () => {
    expect(getProductsMock).toHaveBeenCalledWith({
      pageSize: 200,
      startIndex: 0,
      filter: "hasConfigurableOptions eq true",
    });
  });

  it("fetches variations once per configurable parent product", () => {
    expect(getProductVariationsMock).toHaveBeenCalledTimes(2);
    expect(getProductVariationsMock).toHaveBeenCalledWith({
      productCode: "PARENT-1",
      pageSize: 200,
      startIndex: 0,
    });
    expect(getProductVariationsMock).toHaveBeenCalledWith({
      productCode: "PARENT-2",
      pageSize: 200,
      startIndex: 0,
    });
  });

  it("writes the productVariations.csv file to the exports directory", () => {
    const writtenPaths = writeFileSyncMock.mock.calls.map((c: any[]) => c[0]);
    expect(writtenPaths).toContain(expectedFilePath);
  });

  it("emits one row per option, skipping variations without a code or options", () => {
    const call = writeFileSyncMock.mock.calls.find(
      (c: any[]) => c[0] === expectedFilePath,
    );
    expect(call).toBeDefined();
    const content = String(call![1]);
    const lines = content.trim().split("\n");

    // header + 3 rows (2 from PARENT-1-A, 1 from PARENT-2-A)
    expect(lines[0]).toBe(
      "productCode,variationProductCode,attributeFQN,value",
    );
    expect(lines).toHaveLength(4);
  });

  it("prefers stringValue, falls back to raw value, and JSON-encodes objects", () => {
    const call = writeFileSyncMock.mock.calls.find(
      (c: any[]) => c[0] === expectedFilePath,
    );
    const content = String(call![1]);

    // stringValue preferred over raw value=1
    expect(content).toContain("PARENT-1,PARENT-1-A,tenant~color,Red");
    // null stringValue falls back to raw string value
    expect(content).toContain("PARENT-1,PARENT-1-A,tenant~size,L");
    // empty stringValue falls back to JSON-stringified object value
    expect(content).toContain(
      `PARENT-2,PARENT-2-A,tenant~material,${JSON.stringify({ code: "wool" })}`,
    );
  });
});
