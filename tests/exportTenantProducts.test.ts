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

jest.mock("dotenv", () => ({
  __esModule: true,
  config: jest.fn(),
}));

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
const getAttributesMock = jest.fn<AnyAsyncFn>();
const getProductTypesMock = jest.fn<AnyAsyncFn>();
const getCategoriesMock = jest.fn<AnyAsyncFn>();
const getProductsMock = jest.fn<AnyAsyncFn>();
const getTenantMock = jest.fn<AnyAsyncFn>();

jest.mock(
  "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductAttributesApi",
  () => ({
    __esModule: true,
    ProductAttributesApi: jest
      .fn()
      .mockImplementation(() => ({ getAttributes: getAttributesMock })),
  }),
);

jest.mock(
  "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductTypesApi",
  () => ({
    __esModule: true,
    ProductTypesApi: jest
      .fn()
      .mockImplementation(() => ({ getProductTypes: getProductTypesMock })),
  }),
);

jest.mock(
  "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/CategoriesApi",
  () => ({
    __esModule: true,
    CategoriesApi: jest
      .fn()
      .mockImplementation(() => ({ getCategories: getCategoriesMock })),
  }),
);

jest.mock(
  "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductsApi",
  () => ({
    __esModule: true,
    ProductsApi: jest
      .fn()
      .mockImplementation(() => ({ getProducts: getProductsMock })),
  }),
);

jest.mock("@kibocommerce/rest-sdk/clients/Tenant/apis/TenantsApi", () => ({
  __esModule: true,
  TenantsApi: jest
    .fn()
    .mockImplementation(() => ({ getTenant: getTenantMock })),
}));

describe("exportTenantProducts", () => {
  const expectedExportDir = path.join(__dirname, "..", "exports");

  beforeAll(async () => {
    process.env.TENANT_ID = "12345";
    process.env.SITE_ID = "1";
    process.env.CATALOG = "1";
    process.env.MASTER_CATALOG = "1";

    // Single page of results for every paginated endpoint (< pageSize triggers stop)
    getAttributesMock.mockResolvedValue({
      items: [{ id: 1, attributeCode: "color", nested: { foo: "bar" } }],
      totalCount: 1,
    });
    getProductTypesMock.mockResolvedValue({
      items: [{ id: 10, name: "Type A" }],
      totalCount: 1,
    });
    getCategoriesMock.mockResolvedValue({
      items: [{ categoryId: 100, content: { name: "Cat A" } }],
      totalCount: 1,
    });
    getProductsMock.mockResolvedValue({
      items: [{ productCode: "SKU-1", tags: ["x", "y"] }],
      totalCount: 1,
    });
    getTenantMock.mockResolvedValue({
      sites: [
        { id: 1, catalogId: 1 },
        { id: 2, catalogId: 2 },
        { id: 3, catalogId: 1 }, // duplicate catalogId should be ignored
      ],
    });

    // Require module under test after mocks are wired; main() runs on import
    require("../lib/exportTenantProducts");

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

  it("writes a CSV file for each export step", () => {
    const writtenPaths = writeFileSyncMock.mock.calls.map((c: any[]) => c[0]);
    expect(writtenPaths).toEqual(
      expect.arrayContaining([
        path.join(expectedExportDir, "productAttributes.csv"),
        path.join(expectedExportDir, "productTypes.csv"),
        path.join(expectedExportDir, "categories.csv"),
        path.join(expectedExportDir, "products.csv"),
      ]),
    );
  });

  it("calls each catalog admin API with the configured pageSize", () => {
    expect(getAttributesMock).toHaveBeenCalledWith({
      pageSize: 200,
      startIndex: 0,
    });
    expect(getProductTypesMock).toHaveBeenCalledWith({
      pageSize: 200,
      startIndex: 0,
    });
    expect(getProductsMock).toHaveBeenCalledWith({
      pageSize: 200,
      startIndex: 0,
    });
  });

  it("fetches categories once per unique catalog in the tenant", () => {
    expect(getTenantMock).toHaveBeenCalledWith({ tenantId: 12345 });
    expect(getCategoriesMock).toHaveBeenCalledTimes(2);
  });

  it("flattens nested objects and serializes arrays in CSV output", () => {
    const attrsCall = writeFileSyncMock.mock.calls.find((c: any[]) =>
      String(c[0]).endsWith("productAttributes.csv"),
    );
    const productsCall = writeFileSyncMock.mock.calls.find((c: any[]) =>
      String(c[0]).endsWith("products.csv"),
    );

    expect(attrsCall).toBeDefined();
    expect(productsCall).toBeDefined();
    expect(String(attrsCall![1])).toContain("nested.foo");
    expect(String(productsCall![1])).toContain('["x","y"]');
  });
});
