import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import * as path from "path";

// fs is wired so existsSync returns true and readFileSync returns the filename
// as a marker so the csv/sync parse mock can look up rows by file
const existsSyncMock = jest.fn().mockReturnValue(true);
const readFileSyncMock = jest.fn();

jest.mock("fs", () => ({
  __esModule: true,
  existsSync: (...args: any[]) => existsSyncMock(...args),
  readFileSync: (...args: any[]) => readFileSyncMock(...args),
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

// csv/sync parse mock - return rows keyed by filename marker
const csvRowsByFile: Record<string, Record<string, string>[]> = {};
jest.mock("csv/sync", () => ({
  __esModule: true,
  parse: jest.fn((content: string) => csvRowsByFile[content] ?? []),
}));

jest.mock("@kibocommerce/rest-sdk", () => ({
  __esModule: true,
  Configuration: jest.fn().mockImplementation((opts: any) => ({ ...opts })),
}));

// API client mocks
type AnyAsyncFn = (...args: any[]) => Promise<any>;
const addAttributeMock = jest.fn<AnyAsyncFn>();
const addProductTypeMock = jest.fn<AnyAsyncFn>();
const getProductTypesMock = jest.fn<AnyAsyncFn>();
const addCategoryMock = jest.fn<AnyAsyncFn>();
const addProductMock = jest.fn<AnyAsyncFn>();
const getTenantMock = jest.fn<AnyAsyncFn>();

jest.mock(
  "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductAttributesApi",
  () => ({
    __esModule: true,
    ProductAttributesApi: jest
      .fn()
      .mockImplementation(() => ({ addAttribute: addAttributeMock })),
  }),
);

jest.mock(
  "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductTypesApi",
  () => ({
    __esModule: true,
    ProductTypesApi: jest.fn().mockImplementation(() => ({
      addProductType: addProductTypeMock,
      getProductTypes: getProductTypesMock,
    })),
  }),
);

jest.mock(
  "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/CategoriesApi",
  () => ({
    __esModule: true,
    CategoriesApi: jest
      .fn()
      .mockImplementation(() => ({ addCategory: addCategoryMock })),
  }),
);

jest.mock(
  "@kibocommerce/rest-sdk/clients/CatalogAdministration/apis/ProductsApi",
  () => ({
    __esModule: true,
    ProductsApi: jest
      .fn()
      .mockImplementation(() => ({ addProduct: addProductMock })),
  }),
);

jest.mock("@kibocommerce/rest-sdk/clients/Tenant/apis/TenantsApi", () => ({
  __esModule: true,
  TenantsApi: jest
    .fn()
    .mockImplementation(() => ({ getTenant: getTenantMock })),
}));

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

function resetApiMocks() {
  addAttributeMock.mockReset();
  addProductTypeMock.mockReset();
  getProductTypesMock.mockReset();
  addCategoryMock.mockReset();
  addProductMock.mockReset();
  getTenantMock.mockReset();
}

describe("importTenantProducts - happy path", () => {
  beforeAll(async () => {
    process.env.TENANT_ID = "12345";
    process.env.SITE_ID = "1";
    process.env.CATALOG = "1";
    process.env.MASTER_CATALOG = "1";

    clearCsv();
    resetApiMocks();

    setCsv("productAttributes.csv", [
      { attributeCode: "color", "content.name": "Color" },
    ]);
    // Base type should be skipped (case-insensitive); Apparel should be created
    setCsv("productTypes.csv", [
      { id: "10", name: "Base" },
      { id: "11", name: "Apparel" },
    ]);
    setCsv("categories.csv", [
      {
        id: "100",
        categoryCode: "parent-code",
        catalogId: "1",
        "content.name": "Parent",
        parentCategoryName: "",
      },
      {
        id: "101",
        categoryCode: "child-code",
        catalogId: "1",
        "content.name": "Child",
        parentCategoryName: "Parent",
      },
    ]);
    setCsv("products.csv", [
      {
        productCode: "SKU-1",
        productTypeId: "11",
        "content.productName": "Shirt",
        productInCatalogs: JSON.stringify([
          {
            catalogId: 1,
            primaryProductCategory: { categoryId: 100 },
            productCategories: [{ categoryId: 101 }],
          },
        ]),
      },
    ]);

    addAttributeMock.mockResolvedValue({ attributeCode: "color" });
    addProductTypeMock.mockResolvedValue({ name: "Apparel", id: 999 });
    addCategoryMock
      .mockResolvedValueOnce({
        id: 5001,
        categoryCode: "parent-code",
        content: { name: "Parent" },
      })
      .mockResolvedValueOnce({
        id: 5002,
        categoryCode: "child-code",
        content: { name: "Child" },
      });
    addProductMock.mockResolvedValue({
      productCode: "SKU-1",
      content: { productName: "Shirt" },
    });
    getProductTypesMock.mockResolvedValue({
      items: [{ id: 7777, name: "Apparel" }],
    });
    getTenantMock.mockResolvedValue({
      sites: [
        { id: 1, catalogId: 1 },
        { id: 2, catalogId: 1 }, // duplicate catalogId - first wins
      ],
    });

    // main() runs on import; isolateModules so the abort-path test can reload
    jest.isolateModules(() => {
      require("../lib/importTenantProducts");
    });
    await flushAsync();
  });

  it("creates each product attribute from the CSV", () => {
    expect(addAttributeMock).toHaveBeenCalledTimes(1);
    expect(addAttributeMock).toHaveBeenCalledWith({
      catalogAdminsAttribute: expect.objectContaining({
        attributeCode: "color",
        content: { name: "Color" },
      }),
    });
  });

  it("skips the base product type and creates the rest", () => {
    expect(addProductTypeMock).toHaveBeenCalledTimes(1);
    expect(addProductTypeMock).toHaveBeenCalledWith({
      productType: expect.objectContaining({ name: "Apparel" }),
    });
  });

  it("builds the catalog-to-site map from the tenant", () => {
    expect(getTenantMock).toHaveBeenCalledWith({ tenantId: 12345 });
  });

  it("creates categories top-level first then children with resolved parentCategoryId", () => {
    expect(addCategoryMock).toHaveBeenCalledTimes(2);
    const firstArg: any = (addCategoryMock.mock.calls[0] as any)[0]
      .catalogAdminsCategory;
    const secondArg: any = (addCategoryMock.mock.calls[1] as any)[0]
      .catalogAdminsCategory;
    expect(firstArg).not.toHaveProperty("parentCategoryId");
    expect(firstArg).not.toHaveProperty("id"); // source id stripped
    expect(firstArg.content).toEqual({ name: "Parent" });
    expect(secondArg.parentCategoryId).toBe(5001);
    expect(secondArg.content).toEqual({ name: "Child" });
  });

  it("remaps productTypeId via name and categoryIds via code before addProduct", () => {
    expect(addProductMock).toHaveBeenCalledTimes(1);
    const productArg: any = (addProductMock.mock.calls[0] as any)[0]
      .catalogAdminsProduct;
    expect(productArg.productCode).toBe("SKU-1");
    expect(productArg.productTypeId).toBe(7777);
    expect(
      productArg.productInCatalogs[0].primaryProductCategory.categoryId,
    ).toBe(5001);
    expect(
      productArg.productInCatalogs[0].productCategories[0].categoryId,
    ).toBe(5002);
  });
});

describe("importTenantProducts - abort on duplicate category", () => {
  beforeAll(async () => {
    process.env.TENANT_ID = "12345";
    process.env.SITE_ID = "1";
    process.env.CATALOG = "1";
    process.env.MASTER_CATALOG = "1";

    clearCsv();
    resetApiMocks();

    setCsv("productAttributes.csv", []);
    setCsv("productTypes.csv", []);
    setCsv("categories.csv", [
      {
        id: "100",
        categoryCode: "dupe-code",
        catalogId: "1",
        "content.name": "Dupe",
        parentCategoryName: "",
      },
    ]);
    setCsv("products.csv", [{ productCode: "SKU-X", productTypeId: "11" }]);

    addCategoryMock.mockRejectedValue(
      new Error('Category code "dupe-code" already exists'),
    );
    getProductTypesMock.mockResolvedValue({ items: [] });
    getTenantMock.mockResolvedValue({ sites: [{ id: 1, catalogId: 1 }] });

    jest.isolateModules(() => {
      require("../lib/importTenantProducts");
    });
    await flushAsync();
  });

  it("attempts the duplicate category and stops before importing products", () => {
    expect(addCategoryMock).toHaveBeenCalledTimes(1);
    expect(addProductMock).not.toHaveBeenCalled();
  });
});
