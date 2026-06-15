# Kibo TypeScript SDK - Sarnova Sandbox Tools

This repository contains utilities for setting up and managing Sarnova sandbox environments using the Kibo TypeScript SDK.

---

## 📋 Table of Contents

- [Quick Links](#-quick-links)
- [Getting Started](#-getting-started)
  - Configure Environment Variables
  - Install Dependencies
- [Logs](#-logs)
- [Scripts Overview](#️-scripts-overview)
  - [1. 🆕 `newSandboxSetup.ts`](#1--newsandboxsetupts)
  - [2. ➕ `newSandboxProducts.ts`](#2--newsandboxproductsts)
  - [3. ❌ `deleteProdsCatsTypesAttributes.ts`](#3--deleteprodscatstypesattributests)
  - [4. 📋 `createDocTypeListDocs.ts`](#4--createdoctypelistdocsts)
  - [5. 📄 `copyPasteDocs.ts`](#5--copypastedocsts)
  - [6. 🛒 `cartToCompletedOrder.ts`](#6--carttocompletedorderts)
  - [7. 🛒 `cartToCheckoutToOrder.ts`](#7--carttocheckouttoorderts)
  - [8. 🔄 `addSubscriptionAttributes.ts`](#8--addsubscriptionattributests)
  - [9. 🔑 `userLogin.ts`](#9--userlogints)
  - [10. 📦 `exportTenantProducts.ts`](#10--exporttenantproductsts)
  - [11. 📥 `importTenantProducts.ts`](#11--importtenantproductsts)
  - [12. 🎛️ `exportTenantProductVariations.ts`](#12-️-exporttenantproductvariationsts)
  - [13. 🔁 `importTenantProductVariations.ts`](#13--importtenantproductvariationsts)
  - [14. 🗂️ `listWebinyFiles.ts`](#14-️-listwebinyfilests)
  - [15. 📚 `listWebinyCmsEntries.ts`](#15--listwebinycmsentriests)
  - [16. 📄 `listWebinyCmsEntry.ts`](#16--listwebinycmsentryts)
  - [17. 📚 `listWebinyCmsEntryGraphQLManageAPI.ts`](#17--listwebinycmsentrygraphqlmanageapits)
  - [18. 🗂️ `getWebinyCmsFolder.ts`](#18-️-getwebinycmsfolderts)
  - [19. ➕ `createWebinyCmsFolder.ts`](#19--createwebinycmsfolderts)
  - [20. 🧨 `deleteAllWebinyContent.ts`](#20--deleteallwebinycontentts)

---

## 🌎 Quick Links

- [Kibo TypeScript SDK - Documentation](https://docs.kibocommerce.com/pages/typescript-sdk)
- [Kido TypeScript SDK - Github](https://github.com/KiboSoftware/typescript-rest-sdk)
- [Kibo API Documentation](https://docs.kibocommerce.com/api-overviews/getting-started)
- [ts-node](https://www.npmjs.com/package/ts-node)
- [Webiny Headless CMS - GraphQL API Overview](https://www.webiny.com/docs/headless-cms/graphql-api-overview)
- [Webiny Headless CMS - Using the Webiny SDK](https://www.webiny.com/docs/headless-cms/using-webiny-sdk)
- [Webiny File Manager SDK Reference](https://www.webiny.com/docs/reference/sdk/file-manager)

---

## 🚀 Getting Started

**IMPORTANT:** Before running any scripts, you must configure your environment variables in a `.env` file at the root of the project.

1. **Configure Environment Variables**
   - Create `.env` file at the root of the project
   - Fill in your Kibo tenant credentials and configuration

   ```env
   # Tenant Configuration
   TENANT_ID=your_tenant_id
   SITE_ID=your_site_id
   WEBSITE_NAME=your_website_name
   EMAIL_ADDRESS=your_email@example.com

   # API Credentials
   CLIENT_ID=your_client_id
   SHARED_SECRET=your_shared_secret

   # Catalog Configuration
   CATALOG=1
   MASTER_CATALOG=1

   # API Environment
   API_ENV=sandbox
   PCI_HOST=pmts.usc1.gcp.kibocommerce.com
   AUTH_HOST=home.usc1.gcp.kibocommerce.com
   ```

   ### Optional Configuration

   ```env
   # Logging
   LOG_LEVEL=info  # Options: trace, debug, info, warn, error
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Run a Script**

   Use `ts-node` to execute any script in the `lib/` directory. For example:

   ```bash
   ts-node .\lib\newSandboxSetup.ts
   ```

   See [Scripts Overview](#️-scripts-overview) for the full list of available scripts and their usage.

---

## 📜 Logs

[Pino](https://getpino.io/#/) utilized for logging. All scripts generate detailed logs in the terminal and in the `logs/` directory:

- `add-sandbox-products.log` - Product creation logs
- `delete-sandbox-products.log` - Deletion operation logs
- `document-type-list-creation.log` - Document type, list, and document creation logs
- `copy-paste-documents.log` - Document copy/paste operation logs
- `cart-to-completed-order.log` - Cart to completed order process logs
- `cart-to-checkout-to-order.log` - Cart to checkout to order process logs
- `add-subscription-attributes.log` - Subscription attribute creation logs
- `user-login.log` - User account creation and login logs
- `export-tenant-products.log` - Tenant product data export logs
- `import-tenant-products.log` - Tenant product data import logs
- `export-tenant-product-variations.log` - Tenant product variation export logs
- `import-tenant-product-variations.log` - Tenant product variation import logs
- `list-webiny-files.log` - Webiny File Manager file listing logs
- `list-webiny-cms-entries.log` - Webiny CMS entries listing logs
- `list-webiny-cms-entry.log` - Webiny CMS single entry retrieval logs
- `list-webiny-cms-entry-graphql-manage-api.log` - Webiny CMS entry listing via raw Manage API GraphQL logs
- `get-webiny-cms-folder.log` - Webiny ACO folder retrieval logs
- `create-webiny-cms-folder.log` - Webiny ACO folder creation logs
- `delete-all-webiny-content.log` - Webiny tenant-wide content wipe logs

Logs include timestamps, operation status, entity details, and error messages for troubleshooting.

---

## 🖥️ Scripts Overview

### 1. 🆕 `newSandboxSetup.ts`

**Purpose:** Initial sandbox environment configuration

**Location:** `lib/newSandboxSetup.ts`

**What it does:**

- Creates sales channels (online, phone, CRM)
- Updates general site settings (timezone, email addresses, analytics, wishlist, address validation)
- Configures website name and sender/reply-to email addresses

**Key Functions:**

- `createChannels()` - Creates three default sales channels
- `updateGeneralSettings()` - Configures site-wide settings

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\newSandboxSetup.ts
```

**Note:** Some configurations (catalogs, sites, payment gateways) must be done manually through the Kibo admin interface.

---

### 2. ➕ `newSandboxProducts.ts`

**Purpose:** Bulk product catalog creation from JSON data files

**Location:** `lib/newSandboxProducts.ts`

**What it does:**

- Creates product attributes from `data/productAttributes.json`
- Creates product types from `data/productTypes.json`
- Creates category hierarchy from `data/productCategories.json`
- Creates products from `data/products.json`

**Key Features:**

- Rate limiting (500ms between API calls) for API throttling
- Structured logging to both console and `logs/add-sandbox-products.log`
- Handles parent-child category relationships
- Dynamically maps product types to products

**Execution Order:**

1. Product Attributes
2. Product Types
3. Categories (top-level first, then children)
4. Products

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\newSandboxProducts.ts
```

**Logging:**
All operations are logged with detailed information including success/failure status, entity names, and error messages.

---

**⚠️ WARNING:** The script below permanently deletes catalog data. Use with caution! ⚠️

### 3. ❌ `deleteProdsCatsTypesAttributes.ts`

**Purpose:** Clean up sandbox environment by removing all catalog data

**Location:** `lib/deleteProdsCatsTypesAttributes.ts`

**What it does:**

- Deletes all products from the master catalog
- Deletes all categories from **every child catalog** discovered via the tenant's sites (with cascade delete for children)
- Deletes all product types (except "Base" type)
- Deletes all product attributes (except system and subscription attributes)

**Key Features:**

- Batch processing (200 items per batch)
- Rate limiting (500ms between API calls)
- Structured logging to both console and `logs/delete-sandbox-products.log`
- Protects system-critical attributes and the "Base" product type
- Cascade deletion for categories to handle parent-child relationships
- Product deletion runs against the master catalog using a dedicated `Configuration` with `siteId` and `catalog` set to `undefined`, so the call operates at the master catalog level rather than a single child catalog
- Category deletion iterates every child catalog: a `catalogId -> siteId` map is built from `TenantsApi.getTenant()` and a per-catalog `Configuration` is created so each `CategoriesApi` call is scoped to the correct catalog/site
- Categories within each catalog are deleted in reverse order (children first, then parents) with `cascadeDelete: true`

**Protected System Attributes:**

- `allow-auto-substitutions`
- `availability`
- `product-crosssell`
- `hide-product`
- `popularity`
- `price-list-entry-type`
- `rating`
- `product-related`
- `substitute-products`
- `substitute-variants`
- `sales-rank-*`
- `product-upsell`
- `future-inventory-enabled`
- `reserve-inventory-in-cart`
- Subscription attributes (`subscription-mode`, `subscription-frequency`, `subscription-trial-days`, `subscription-trial-productCode`, `subscription-trial-variantCode`, `split-extras-in-subscriptions`)

**Execution Order:**

1. Products (master catalog, must be deleted first)
2. Categories (per child catalog, via tenant sites lookup)
3. Product Types
4. Product Attributes

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\deleteProdsCatsTypesAttributes.ts
```

---

### 4. 📋 `createDocTypeListDocs.ts`

**Purpose:** Create a document type, document list, and documents for the sandbox environment. Use the template data files in the `data` folder to customize your data.

**Location:** `lib/createDocTypeListDocs.ts`

**What it does:**

- Creates a document type from `data/documentTypeTemplate.json`
- Creates a document list from `data/documentListTemplate.json`
- Creates documents from `data/documentTemplate.json` and publishes them

**Key Features:**

- Rate limiting (500ms between API calls) for API throttling
- Structured logging to both console and `logs/createDocTypeListDocs.log`
- Document List is scoped to the site specified in the .env file. Update the scopeId in the `data/documentListTemplate.json` file before running the script.

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\createDocTypeListDocs.ts
```

---

### 5. 📄 `copyPasteDocs.ts`

**Purpose:** Copy documents from one Kibo environment to another. This is useful for migrating documents between sandbox environments.

**Location:** `lib/copyPasteDocs.ts`

**Note:** This script requires additional configuration.

- Your current environment variables will be used as the source environment variables.
- Update the .env file to add the destination tenant ID, site ID, and document list name to your current environment variables.

```env
  # Destination Tenant Configuration
  DEST_TENANT_ID=your_destination_tenant_id
  DEST_SITE_ID=your_destination_site_id
  DOCUMENT_LIST_NAME=your_document_list_name  # e.g. shippingBanner@Tenant
```

**What it does:**

- Fetches all documents from a document list in the source environment (with pagination support)
- Creates each document in the destination environment
- Tracks success/failure counts for each document
- Continues processing even if individual documents fail

**Key Features:**

- Rate limiting (500ms between API calls) to avoid API throttling
- Structured logging to both console and `logs/copy-paste-documents.log`
- Pagination support for large document lists (200 documents per page)
- Error handling that allows the process to continue even if individual documents fail
- Detailed progress tracking with success/failure counts

**Prerequisites:**
⚠️ **IMPORTANT:** Before running this script, ensure the following:

1. The document type must already exist in the destination environment
2. The document list must already exist in the destination environment
3. The document type and document list in the destination environment must **exactly match** the source environment (same FQN, namespace, and schema)
4. You have configured destination environment variables in your `.env` file

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\copyPasteDocs.ts
```

**Logging:**
All operations are logged with detailed information including:

- Number of documents fetched from source
- Progress for each document being copied
- Success/failure status for each document
- Final summary with total documents, success count, and failure count

---

### 6. 🛒 `cartToCompletedOrder.ts`

**Purpose:** Create an anonymous shopper cart, add a product, and complete the full order lifecycle (fulfillment, billing, payment, and submission).

**Location:** `lib/cartToCompletedOrder.ts`

**Note:** This script requires additional configuration.

- Add the sandbox payments endpoint to your `.env` file:

```env
  # Payments Endpoint
  SANDBOX_PAYMENTS_ENDPOINT=https://payments-sb.usc1.gcp.kibocommerce.com/payments/commerce/payments/cards/
```

**What it does:**

- Creates an anonymous shopper auth ticket
- Adds a product to the anonymous cart
- Creates an order from the cart
- Sets fulfillment info (shipping address and method)
- Obtains a `paymentServiceCardId` by POSTing card details to the sandbox payments endpoint
- Sets billing info using the retrieved `paymentServiceCardId`
- Creates a customer account and associates it with the order
- Submits the order

**Key Features:**

- Rate limiting (500ms between API calls) for API throttling
- Structured logging to both console and `logs/cart-to-completed-order.log`
- Uses anonymous shopper authentication flow
- Dynamically retrieves `paymentServiceCardId` from the payments service
- Full order lifecycle from cart creation to order submission

**Execution Order:**

1. Create anonymous shopper auth ticket
2. Add item to cart
3. Create order from cart
4. Set fulfillment info (shipping address)
5. Get available shipping methods and set shipping method
6. POST to payments endpoint to obtain `paymentServiceCardId`
7. Set billing info (payment details with retrieved card ID)
8. Create customer account and assign to order
9. Submit the order

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\cartToCompletedOrder.ts
```

---

### 7. 🛒 `cartToCheckoutToOrder.ts`

**Purpose:** Log in an existing user, add a product to their cart, create a checkout, and complete the full order lifecycle using the Checkout API flow (destination, shipping, billing, payment, and submission).

**Location:** `lib/cartToCheckoutToOrder.ts`

**Note:** This script requires additional configuration.

- Add the sandbox payments endpoint to your `.env` file:

```env
  # Payments Endpoint
  SANDBOX_PAYMENTS_ENDPOINT=https://payments-sb.usc1.gcp.kibocommerce.com/payments/commerce/payments/cards/
```

**What it does:**

- Logs in an existing user with `StorefrontAuthTicketApi`
- Gets or creates the user's cart and adds a product by cart ID
- Creates a checkout from the cart using the Checkout API
- Adds a destination (shipping address) to the checkout
- Assigns checkout items to the destination
- Gets available shipping methods and sets the shipping method
- Obtains a `paymentServiceCardId` by POSTing card details to the sandbox payments endpoint
- Creates a payment action on the checkout with billing info
- Submits the checkout to create a completed order

**Key Features:**

- Rate limiting (500ms between API calls) for API throttling
- Structured logging to both console and `logs/cart-to-checkout-to-order.log`
- Uses authenticated user flow (as opposed to anonymous shopper in `cartToCompletedOrder.ts`)
- Uses Checkout API with destination-based fulfillment
- Dynamically retrieves `paymentServiceCardId` from the payments service

**Execution Order:**

1. Log in existing user and obtain auth token
2. Get or create user cart and add item by cart ID
3. Create checkout from cart
4. Add destination (shipping address) to checkout
5. Assign items to the destination
6. Get available shipping methods and set shipping method
7. POST to payments endpoint to obtain `paymentServiceCardId`
8. Create payment action with billing info
9. Submit the checkout

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\cartToCheckoutToOrder.ts
```

---

### 8. 🔄 `addSubscriptionAttributes.ts`

**Purpose:** Create subscription-related product attributes in the Kibo catalog

**Location:** `lib/addSubscriptionAttributes.ts`

**What it does:**

- Creates six subscription-related system product attributes:
  - **Subscription Mode** – Defines if a product is subscription-only or subscription + one-time purchase (values: `SO`, `SAOT`)
  - **Subscription Frequency** – Available subscription frequencies for customers (15 days through 12 months)
  - **Trial Days** – Number of trial days for a subscription (1–365)
  - **Trial Product Code** – Trial product code
  - **Trial Product Variation Code** – Trial product variation code
  - **Split Extras In Subscriptions** – Whether to split extras in subscriptions (Yes/No)

**Key Features:**

- Rate limiting (200ms between API calls) for API throttling
- Structured logging to both console and `logs/add-subscription-attributes.log`
- Skips attributes that already exist (handles 409 conflict responses)
- All attributes use the `system` namespace

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\addSubscriptionAttributes.ts
```

---

### 9. 🔑 `userLogin.ts`

**Purpose:** Create a new customer account, add login credentials, and authenticate the user via the Kibo storefront auth ticket API. If the account already exists, skip account creation and log in directly.

**Location:** `lib/userLogin.ts`

**What it does:**

- Checks if a customer account already exists for the given email using `CustomerAccountApi.getAccounts()` with an email filter
- If the account **does not exist**: creates a new account and adds login credentials (email/password), converting it to a registered shopper
- If the account **already exists**: skips account creation and proceeds directly to login
- Logs in the user via `StorefrontAuthTicketApi` and obtains a JWT auth token

**Key Features:**

- Structured logging to both console and `logs/user-login.log`
- Skips account creation if the customer already exists (idempotent)
- Uses `CustomerAccountApi.getAccounts()` to check for existing accounts by email
- Uses `CustomerAccountApi.addAccount()` to create the account (only if needed)
- Uses `CustomerAccountApi.addLoginToExistingCustomer()` to set login credentials (only if needed)
- Uses `StorefrontAuthTicketApi.createUserAuthTicket()` to authenticate and retrieve a JWT token

**Execution Order:**

1. Check if a customer account already exists for the email
2. If not found, create a new customer account and add login credentials (password)
3. Log in the user and obtain a JWT auth token

**Usage:**
To run the script, use the following command (be sure to update the `newUser` data before running):

```bash
ts-node .\lib\userLogin.ts
```

---

### 10. 📦 `exportTenantProducts.ts`

**Purpose:** Export all product catalog data (attributes, types, categories, and products) from a Kibo tenant to CSV files

**Location:** `lib/exportTenantProducts.ts`

**What it does:**

- Exports all product attributes to `exports/productAttributes.csv`
- Exports all product types to `exports/productTypes.csv`
- Exports all categories to `exports/categories.csv`
- Exports all products to `exports/products.csv`

**Key Features:**

- Pagination support for large datasets (200 items per page)
- Flattens nested objects into dot-notation CSV columns
- Serializes arrays as JSON strings in CSV cells
- Automatically creates the `exports/` directory if it doesn't exist
- Structured logging to both console and `logs/export-tenant-products.log`

**Execution Order:**

1. Product Attributes
2. Product Types
3. Categories
4. Products

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\exportTenantProducts.ts
```

**Output:** CSV files are written to the `exports/` directory at the project root.

---

### 11. 📥 `importTenantProducts.ts`

**Purpose:** Import product catalog data (attributes, types, categories, and products) from CSV files into a Kibo tenant

**Location:** `lib/importTenantProducts.ts`

**What it does:**

- Reads exported CSV files from the `exports/` directory
- Imports product attributes from `exports/productAttributes.csv`
- Imports product types from `exports/productTypes.csv` (skips the "Base" type)
- Builds a `catalogId -> siteId` map from `TenantsApi.getTenant()` so category creation can be scoped per child catalog
- Imports categories from `exports/categories.csv` **per catalog** (top-level first, then children) using a `Configuration` scoped to each catalog/site
- Imports products from `exports/products.csv` with automatic product type and per-catalog category ID remapping

**Key Features:**

- Rate limiting (500ms between API calls) via Bottleneck for API throttling
- Unflattens dot-notation CSV columns back into nested objects (`unflattenObject`)
- Parses JSON strings in CSV cells back into arrays/objects (`parseValue`)
- Normalizes numeric-keyed objects from `unflattenObject` back into real arrays via the `toArray` helper before iterating `productInCatalogs` / `productCategories`
- Per-catalog category creation: each catalog has its own `categoryCode` namespace, so `importCategories` returns a `Map<catalogId, Map<categoryCode, newCategoryId>>` and creates categories with a per-catalog `CategoriesApi` client 🔥
- Automatically remaps old product type IDs (via name lookup) and category IDs to newly created IDs in the destination tenant 🔥
- Remaps both `productCategories` entries and `primaryProductCategory` inside every `productInCatalogs` entry, using the category map for that entry's `catalogId` 🔥
- Emits a structured `RemapReport` per product/catalog pair listing every `remapped` and `skipped` category ID (with reason) for full traceability
- Aborts the entire import cleanly when the destination tenant already contains a category with the same `categoryCode`: `createCategoriesForCatalog` throws a `CategoryAlreadyExistsError`, which `main()` catches and logs with the offending `catalogId` and `categoryCode` so stale data can be cleaned up before retrying
- Handles parent-child category relationships across tenants (parent lookup by name within each catalog) 🔥
- Skips system-critical items (e.g., "Base" product type)
- Structured logging to both console and `logs/import-tenant-products.log`

**Prerequisites:**
⚠️ **IMPORTANT:** Before running the export/import workflow across tenants, ensure the following:

1. The **source and destination tenants must have matching site configurations** (same numbers of sites, same order of sites)
2. The **source and destination tenants must have matching catalog configurations** (same number of catalogs, catalog structure, and catalog IDs)
3. The destination tenant must have **no leftover categories** in any child catalog — categories are not inherited from the master catalog and each catalog has its own `categoryCode` namespace, so duplicate codes will abort the import. Run `deleteProdsCatsTypesAttributes.ts` on the destination tenant first if needed.
4. Run `exportTenantProducts.ts` on the source tenant **before** running `importTenantProducts.ts` on the destination tenant
5. Update your `.env` file to point to the **destination tenant** before running the import script

**Execution Order:**

1. Product Attributes
2. Product Types (skips "Base")
3. Build `catalogId -> siteId` map from the destination tenant
4. Categories — per catalog, top-level first, then children (aborts on duplicate `categoryCode`)
5. Products — with product type ID remapping and per-catalog category ID remapping for every `productInCatalogs` entry

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\importTenantProducts.ts
```

**Input:** Reads CSV files from the `exports/` directory (generated by `exportTenantProducts.ts`).

---

### 12. 🎛️ `exportTenantProductVariations.ts`

**Purpose:** Export the `variationProductCode` (and option tuples) for every variation of every configurable parent product in a Kibo tenant to a CSV file, so the codes can be replayed into another tenant.

**Location:** `lib/exportTenantProductVariations.ts`

**What it does:**

- Fetches all parent products that have configurable options (`hasConfigurableOptions eq true`)
- For each parent product, fetches all variations via `ProductVariationsApi.getProductVariations()`
- For each variation that has a `variationProductCode`, writes one CSV row per option, capturing the parent `productCode`, the `variationProductCode`, the option `attributeFQN`, and a tenant-stable semantic `value`
- Writes the result to `exports/productVariations.csv`

**Key Features:**

- Pagination support for large datasets (200 items per page)
- Rate limiting (250ms between API calls) via Bottleneck for API throttling
- Resolves a cross-tenant-stable option `value` via `semanticValue()` (prefers the localized `content.stringValue` label, falling back to the raw value) so variations can be matched in another tenant where `valueSequence` numbers are regenerated
- Skips variations that don't yet have a `variationProductCode` set (nothing to migrate)
- Automatically creates the `exports/` directory if it doesn't exist
- Structured logging to both console and `logs/export-tenant-product-variations.log`

**Execution Order:**

1. Fetch all configurable parent product codes
2. For each parent product, fetch all variations and emit one row per option to the in-memory buffer
3. Write `exports/productVariations.csv`

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\exportTenantProductVariations.ts
```

**Output:** `exports/productVariations.csv` with columns `productCode, variationProductCode, attributeFQN, value`.

---

### 13. 🔁 `importTenantProductVariations.ts`

**Purpose:** Replay the `variationProductCode` values exported by `exportTenantProductVariations.ts` into a destination Kibo tenant, matching variations by their option tuple rather than by `variationkey` (which is regenerated per tenant).

**Location:** `lib/importTenantProductVariations.ts`

**What it does:**

- Reads `exports/productVariations.csv` and groups rows into `{ productCode -> variations[] }`, where each variation aggregates one row per option
- For each parent `productCode`, fetches all destination variations via `ProductVariationsApi.getProductVariations()` and builds a lookup keyed by a canonical, order-independent option tuple
- Matches each source variation to a destination variation by option tuple and assembles a bulk update payload carrying `{ options, variationProductCode, isActive: true, variationkey? }` per item
- Sends a single `ProductVariationsApi.updateProductVariations()` call per parent product to set `variationProductCode` and activate the variation in one request
- Writes a per-row migration report to `exports/variationCodeMigration.csv`

**Key Features:**

- Rate limiting (500ms between API calls) via Bottleneck for API throttling
- Canonical, order-independent option-tuple key (`tupleKey`) built from lowercased `attributeFQN` and semantic value, sorted by FQN, so source and destination variations match regardless of option order
- Same `semanticValue()` resolution as the export script (prefers `content.stringValue`, falls back to raw value) so values match across tenants where `valueSequence` numbers are regenerated
- Includes the destination `options[]` in each update item so the server can still match the row when the destination `variationkey` is `null` (inactive variations) and sets `isActive: true` to activate them in the same call
- Skips variations that are already fully migrated (same code AND already active) → `already_set`
- Skips variations where the destination already has a different `variationProductCode` set (the field becomes read-only after the merchant supplies it) → `conflict_existing_code`
- Records source variations with no matching destination option tuple → `not_found_in_destination`
- Per-product error isolation: a failed bulk `updateProductVariations()` flips that product's pending `migrated` rows to `error` (with the error message) without aborting the rest of the import
- Structured logging to both console and `logs/import-tenant-product-variations.log`

**Prerequisites:**
⚠️ **IMPORTANT:** Before running this script, ensure the following:

1. Run `exportTenantProductVariations.ts` on the source tenant **before** running `importTenantProductVariations.ts` on the destination tenant
2. The destination tenant must already contain the same parent products and the same configurable option values as the source (typically achieved by running `importTenantProducts.ts` first)
3. Update your `.env` file to point to the **destination tenant** before running the import script

**Execution Order:**

1. Load and group source variations from `exports/productVariations.csv`
2. For each parent product: fetch destination variations, match by option tuple, build the bulk update payload, and PUT `updateProductVariations()`
3. Write the migration summary to `exports/variationCodeMigration.csv`

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\importTenantProductVariations.ts
```

**Input:** Reads `exports/productVariations.csv` (generated by `exportTenantProductVariations.ts`).

**Output:** `exports/variationCodeMigration.csv` with columns `productCode, variationProductCode, destVariationKey, optionTuple, status, error`, where `status` is one of `migrated`, `already_set`, `conflict_existing_code`, `not_found_in_destination`, `error`.

---

### 14. 🗂️ `listWebinyFiles.ts`

**Purpose:** List every file in a Webiny CMS File Manager via the Webiny SDK and log each file's metadata using Pino.

**Location:** `lib/listWebinyFiles.ts`

**Note:** This script uses a different SDK than the rest of the project (Webiny instead of Kibo). Before running, install the Webiny SDK and add the Webiny-specific variables to your `.env` file.

```bash
npm install @webiny/sdk
```

```env
  # Webiny File Manager Configuration
  WEBINY_API_URL=https://your-webiny-instance.example.com/graphql
  WEBINY_API_TOKEN=your_webiny_api_token
  WEBINY_TENANT=root  # Optional, defaults to "root"
```

**What it does:**

- Initializes the Webiny SDK with the `endpoint`, `token`, and `tenant` from environment variables
- Calls `sdk.fileManager.listFiles()` with the requested fields (`id`, `name`, `key`, `type`, `size`, `src`, `createdOn`, `tags`, `location.folderId`)
- Pages through every file using cursor-based pagination (`meta.cursor` + `meta.hasMoreItems`)
- Logs each file's metadata to the console and to `logs/list-webiny-files.log`

**Key Features:**

- Cursor pagination (100 items per page) until `meta.hasMoreItems` is `false`
- Result-pattern error handling via `result.isFail()` / `result.error.message`
- Structured logging of every file (id, name, key, type, size, src, createdOn, tags, folderId) to both console and `logs/list-webiny-files.log`

**API Notes:**

- The Webiny SDK initialization options (`endpoint`, `token`, `tenant`) are documented in the [Webiny SDK Overview](https://www.webiny.com/docs/reference/sdk/overview).
- `listFiles()` requires a `fields` array specifying which file fields to return — see the [File Manager SDK Reference](https://www.webiny.com/docs/reference/sdk/file-manager).
- The API token must be created in **Settings → Access Management → API Keys** in the Webiny Admin and granted at least read permission on the File Manager. See the [GraphQL API Overview](https://www.webiny.com/docs/headless-cms/graphql-api-overview) for details on tokens and tenant scoping.
- **Folder type:** the `location.folderId` on each file references an ACO folder whose `type` is **`FmFile`** (the literal string registered by `FoldersFeature.register(child, { type: "FmFile" })` in `@webiny/app-file-manager`). This is distinct from CMS entry folders, which use `cms:<modelId>` — see [`createWebinyCmsFolder.ts`](#19--createwebinycmsfolderts).
- **Supported file types:** the File Manager is MIME-type agnostic and accepts **any file type**. The MIME type stored on each file is whatever the uploader provided (validated up to 255 characters per [RFC 6838](https://datatracker.ietf.org/doc/html/rfc6838)); when no MIME type is detected, Webiny falls back to `application/octet-stream` (the same fallback used by Amazon S3). Out of the box, only the following categories have a built-in renderer in the Admin UI — every other type is stored normally but rendered with a default icon unless a custom [`FileManagerFileTypePlugin`](https://www.webiny.com/docs/5.x/file-manager/extending/create-a-file-type-plugin) is registered:
  - **Images** — `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`, and any other `image/*` MIME type (rendered with an inline thumbnail preview)
  - **All other types** (e.g. `video/mp4`, `video/quicktime`, `video/*`, `audio/*`, `application/pdf`, `application/zip`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and similar Office MIME types, `text/*`, `application/json`, `application/octet-stream`) — accepted and stored, rendered with the default fallback icon unless a custom file type plugin or [custom file preview](https://www.webiny.com/docs/5.x/file-manager/extending/customize-file-preview) is registered for them

**Usage:**
To run the script, use the following command:

```bash
ts-node .\lib\listWebinyFiles.ts
```

**Output:** All file metadata is logged to the console and persisted to `logs/list-webiny-files.log`.

---

### 15. 📚 `listWebinyCmsEntries.ts`

**Purpose:** List every entry of a Webiny Headless CMS content model via the Webiny SDK and log each entry's metadata using Pino.

**Location:** `lib/listWebinyCmsEntries.ts`

**Note:** This script uses the Webiny SDK. Before running, install the Webiny SDK (if not already installed) and add the Webiny-specific variables to your `.env` file.

```bash
npm install @webiny/sdk
```

```env
  # Webiny CMS Configuration
  WEBINY_API_URL=https://your-webiny-instance.example.com/graphql
  WEBINY_API_TOKEN=your_webiny_api_token
  WEBINY_TENANT=root  # Optional, defaults to "root"
```

**What it does:**

- Initializes the Webiny SDK with the `endpoint`, `token`, and `tenant` from environment variables
- Calls `sdk.cms.listEntries()` for the configured `modelId` with the requested top-level fields (`id`, `entryId`, `createdOn`, `savedOn`)
- Pages through every entry using cursor-based pagination (`meta.cursor` + `meta.hasMoreItems`)
- Logs each entry's metadata to the console and to `logs/list-webiny-cms-entries.log`

**Key Features:**

- Cursor pagination (100 items per page) until `meta.hasMoreItems` is `false`
- Configurable `modelId` (defaults to `aedCollection`) and `entryFields` array at the top of the script
- Result-pattern error handling via `result.isFail()` / `result.error.message`
- Structured logging of every entry (id, entryId, status, version, title, createdOn, savedOn) to both console and `logs/list-webiny-cms-entries.log`

**API Notes:**

- The Webiny SDK initialization options (`endpoint`, `token`, `tenant`) are documented in the [Webiny SDK Overview](https://www.webiny.com/docs/reference/sdk/overview).
- `listEntries()` requires a `modelId` and a `fields` array specifying which entry fields to return — nested `values.*` fields can be requested when the model schema is known.
- The API token must be created in **Settings → Access Management → API Keys** in the Webiny Admin and granted at least read permission on the target content model. See the [GraphQL API Overview](https://www.webiny.com/docs/headless-cms/graphql-api-overview) for details on tokens and tenant scoping.

**Usage:**
To run the script, use the following command (update `modelId` in the script first if needed):

```bash
ts-node .\lib\listWebinyCmsEntries.ts
```

**Output:** All entry metadata is logged to the console and persisted to `logs/list-webiny-cms-entries.log`.

---

### 16. 📄 `listWebinyCmsEntry.ts`

**Purpose:** Fetch a single Webiny Headless CMS entry by `entryId` for a given content model via the Webiny SDK and log its metadata using Pino.

**Location:** `lib/listWebinyCmsEntry.ts`

**Note:** This script uses the Webiny SDK. Before running, install the Webiny SDK (if not already installed) and add the Webiny-specific variables to your `.env` file.

```bash
npm install @webiny/sdk
```

```env
  # Webiny CMS Configuration
  WEBINY_API_URL=https://your-webiny-instance.example.com/graphql
  WEBINY_API_TOKEN=your_webiny_api_token
  WEBINY_TENANT=root          # Optional, defaults to "root"
  WEBINY_ENTRY_ID=your_entry_id  # Optional, overrides the default entryId in the script
```

**What it does:**

- Initializes the Webiny SDK with the `endpoint`, `token`, and `tenant` from environment variables
- Calls `sdk.cms.getEntry()` for the configured `modelId` and `entryId` with the requested fields (`id`, `entryId`, `createdOn`, `savedOn`, `values.contentId`, `values.siteId`)
- Logs the entry's metadata to the console and to `logs/list-webiny-cms-entry.log`

**Key Features:**

- Configurable `modelId` (defaults to `aedCollection`) and `entryFields` array at the top of the script
- `entryId` can be overridden via the `WEBINY_ENTRY_ID` environment variable
- Result-pattern error handling via `result.isFail()` / `result.error.message`
- Structured logging of the entry (id, entryId, status, version, title, createdOn, savedOn) to both console and `logs/list-webiny-cms-entry.log`

**API Notes:**

- The Webiny SDK initialization options (`endpoint`, `token`, `tenant`) are documented in the [Webiny SDK Overview](https://www.webiny.com/docs/reference/sdk/overview).
- `getEntry()` requires a `modelId`, a `where` filter (e.g. `{ entryId }`), and a `fields` array specifying which entry fields to return — nested `values.*` fields can be requested when the model schema is known.
- The API token must be created in **Settings → Access Management → API Keys** in the Webiny Admin and granted at least read permission on the target content model. See the [GraphQL API Overview](https://www.webiny.com/docs/headless-cms/graphql-api-overview) for details on tokens and tenant scoping.

**Usage:**
To run the script, use the following command (set `WEBINY_ENTRY_ID` or update the default `entryId` in the script first):

```bash
ts-node .\lib\listWebinyCmsEntry.ts
```

**Output:** Entry metadata is logged to the console and persisted to `logs/list-webiny-cms-entry.log`.

---

### 17. 📚 `listWebinyCmsEntryGraphQLManageAPI.ts`

**Purpose:** List every entry of a Webiny Headless CMS content model by issuing a raw GraphQL query against the Webiny Manage API (no SDK) and log each entry's metadata using Pino.

**Location:** `lib/listWebinyCmsEntryGraphQLManageAPI.ts`

**Note:** This script calls the Webiny **Manage API** directly via `fetch` — it does not use the Webiny SDK. The Manage API endpoint is typically `https://YOUR_DOMAIN/cms/manage/{locale_code}` (see the [GraphQL API Overview](https://www.webiny.com/docs/headless-cms/graphql-api-overview#manage-api)). Add the Webiny-specific variables to your `.env` file before running.

```env
  # Webiny CMS Manage API Configuration
  WEBINY_MANAGE_API_URL=https://your-webiny-instance.example.com/cms/manage/en-US
  WEBINY_API_TOKEN=your_webiny_api_token
  WEBINY_TENANT=root  # Optional, defaults to "root"
```

**What it does:**

- POSTs a GraphQL query to the Manage API endpoint with the `Authorization: Bearer` and `x-tenant` headers
- Executes the per-model list query (e.g. `listGaloSiteContentModels`) derived from the model's plural API name
- Requests `id`, `entryId`, `createdOn`, `savedOn`, selected `values.*` fields, `live.version`, `wbyAco_location.folderId`, and `meta` (`version`, `status`, `title`, `modelId`)
- Logs each returned entry to the console and to `logs/list-webiny-cms-entry-graphql-manage-api.log`

**Key Features:**

- Pure `fetch` + raw GraphQL — no `@webiny/sdk` dependency required
- Configurable `listQueryName` at the top of the script (Webiny derives this from the model's plural API name, e.g. `listPromoBanners` for the "Promo Banner" model)
- Surfaces both HTTP errors and GraphQL `errors` / per-payload `error` blocks distinctly
- Structured logging of every entry (id, entryId, status, version, title, folderId, createdOn, savedOn) to both console and `logs/list-webiny-cms-entry-graphql-manage-api.log`

**API Notes:**

- The Manage API exposes per-model typed queries and mutations; the list query name follows the pattern `list<PluralApiName>`. See the [GraphQL API Overview](https://www.webiny.com/docs/headless-cms/graphql-api-overview).
- The API token must be created in **Settings → Access Management → API Keys** in the Webiny Admin and granted at least read permission on the target content model.

**Usage:**
To run the script, use the following command (update `listQueryName` in the script first to match your model's plural API name):

```bash
ts-node .\lib\listWebinyCmsEntryGraphQLManageAPI.ts
```

**Output:** All entry metadata is logged to the console and persisted to `logs/list-webiny-cms-entry-graphql-manage-api.log`.

---

### 18. 🗂️ `getWebinyCmsFolder.ts`

**Purpose:** Fetch a single Webiny ACO (Advanced Content Organization) folder by `id` via the Webiny Main GraphQL API and log its metadata using Pino.

**Location:** `lib/getWebinyCmsFolder.ts`

**Note:** This script calls the Webiny **Main GraphQL API** directly via `fetch` (the ACO schema — `Query.aco.getFolder` — is exposed on the Main API at `/graphql`, **not** on the Manage API at `/cms/manage/...`). Add the Webiny-specific variables to your `.env` file before running.

```env
  # Webiny Main API + ACO Folder Configuration
  WEBINY_API_URL=https://your-webiny-instance.example.com/graphql
  WEBINY_API_TOKEN=your_webiny_api_token
  WEBINY_TENANT=root          # Optional, defaults to "root"
  WEBINY_FOLDER_ID=your_folder_id
```

**What it does:**

- Normalizes `WEBINY_API_URL` to ensure it targets the `/graphql` path on the Main API
- POSTs the `aco.getFolder(id: $id)` query to the Main API endpoint with the `Authorization: Bearer` and `x-tenant` headers
- Requests `id`, `title`, `slug`, `type`, and `parentId`
- Logs the returned folder to the console and to `logs/get-webiny-cms-folder.log`

**Key Features:**

- Pure `fetch` + raw GraphQL — no `@webiny/sdk` dependency required
- Endpoint normalization that appends `/graphql` when the configured URL is missing a path
- `folderId` is configurable via the `WEBINY_FOLDER_ID` environment variable
- Surfaces both HTTP errors and GraphQL `errors` / per-payload `error` blocks distinctly
- Structured logging of the folder (id, title, slug, type, parentId) to both console and `logs/get-webiny-cms-folder.log`

**API Notes:**

- The ACO schema lives on the Webiny Main API (`/graphql`), not on the Headless CMS Manage API (`/cms/manage/...`). Calling `aco.getFolder` against the Manage API will return `Cannot query field "aco" on type "Query"`.
- Folder `type` is namespaced by the owning application:
  - **CMS entry folders** — `cms:<modelId>` (e.g. `cms:fiftyFiftyContentBlockCollection`), one namespace per Headless CMS model.
  - **File Manager folders** — `FmFile` (the literal string registered by `@webiny/app-file-manager` via `FoldersFeature.register(child, { type: "FmFile" })`); the same value is used by `aco.listFolders(where: { type: "FmFile" })` to enumerate folders shown in the File Manager UI.
- The API token must be created in **Settings → Access Management → API Keys** in the Webiny Admin and granted at least read permission on the Content (ACO) area.

**Usage:**
To run the script, use the following command (set `WEBINY_FOLDER_ID` or update the default in the script first):

```bash
ts-node .\lib\getWebinyCmsFolder.ts
```

**Output:** Folder metadata is logged to the console and persisted to `logs/get-webiny-cms-folder.log`.

---

### 19. ➕ `createWebinyCmsFolder.ts`

**Purpose:** Create a new Webiny ACO folder for a Headless CMS content model via the Webiny Main GraphQL API and log the created folder's metadata using Pino.

**Location:** `lib/createWebinyCmsFolder.ts`

**Note:** This script calls the Webiny **Main GraphQL API** directly via `fetch` (the ACO `createFolder` mutation is exposed on the Main API at `/graphql`, **not** on the Manage API). Add the Webiny-specific variables to your `.env` file before running.

```env
  # Webiny Main API + ACO Folder Configuration
  WEBINY_API_URL=https://your-webiny-instance.example.com/graphql
  WEBINY_API_TOKEN=your_webiny_api_token
  WEBINY_TENANT=root                                    # Optional, defaults to "root"
  WEBINY_CMS_MODEL_ID=fiftyFiftyContentBlockCollection  # Headless CMS modelId the folder belongs to
  WEBINY_FOLDER_TITLE=New Test Folder                   # Optional, defaults shown
  WEBINY_FOLDER_SLUG=new-test-folder                    # Optional, defaults shown
  WEBINY_FOLDER_PARENT_ID=                              # Optional parent folder ID; null for top-level
```

**What it does:**

- Normalizes `WEBINY_API_URL` to ensure it targets the `/graphql` path on the Main API
- Builds the folder `type` as `cms:<WEBINY_CMS_MODEL_ID>` (the convention Webiny uses for CMS entry folders)
- POSTs the `aco.createFolder(data: $data)` mutation to the Main API endpoint with the `Authorization: Bearer` and `x-tenant` headers
- Requests `id`, `title`, `slug`, `type`, `parentId`, `createdOn`, and `createdBy` on the created folder
- Logs the created folder to the console and to `logs/create-webiny-cms-folder.log`

**Key Features:**

- Pure `fetch` + raw GraphQL — no `@webiny/sdk` dependency required
- Endpoint normalization that appends `/graphql` when the configured URL is missing a path (avoids the `404 "Unable to resolve the request!"` response from a non-GraphQL path)
- All folder fields (`title`, `slug`, `modelId`, `parentId`) are overridable via environment variables
- Surfaces both HTTP errors and GraphQL `errors` / per-payload `error` blocks distinctly
- Structured logging of the created folder (id, title, slug, type, parentId, createdOn, createdBy) to both console and `logs/create-webiny-cms-folder.log`

**API Notes:**

- The ACO schema lives on the Webiny Main API (`/graphql`), not on the Headless CMS Manage API (`/cms/manage/...`).
- This script always builds the folder `type` as `cms:<modelId>` (CMS entry folders) — otherwise the folder won't show up under that model in the Webiny Admin. Folders shown in the **File Manager** use a different `type`, the literal string **`FmFile`** (registered by `@webiny/app-file-manager` via `FoldersFeature.register(child, { type: "FmFile" })`); to create a File Manager folder instead, send `type: "FmFile"` (and omit the `cms:` prefix) when calling `aco.createFolder`.
- The API token must be created in **Settings → Access Management → API Keys** in the Webiny Admin and granted at least write permission on the Content (ACO) area.

**Usage:**
To run the script, use the following command (set `WEBINY_CMS_MODEL_ID` and optionally `WEBINY_FOLDER_TITLE` / `WEBINY_FOLDER_SLUG` / `WEBINY_FOLDER_PARENT_ID` first):

```bash
ts-node .\lib\createWebinyCmsFolder.ts
```

**Output:** Created folder metadata is logged to the console and persisted to `logs/create-webiny-cms-folder.log`.

---

**⚠️ WARNING:** The script below permanently deletes **all** Webiny content (entries, folders, content models, and content model groups) for the target tenant. Use with extreme caution! ⚠️

### 20. 🧨 `deleteAllWebinyContent.ts`

**Purpose:** Wipe a Webiny tenant by deleting every entry of every content model, every CMS ACO folder, every content model, and every content model group, in the order required by Webiny's referential integrity.

**Location:** `lib/deleteAllWebinyContent.ts`

**Note:** This script calls both the Webiny **Manage API** (entries, content models, content model groups) and the **Main GraphQL API** (ACO folders) directly via `fetch`. Both endpoints share the same `Authorization: Bearer` and `x-tenant` headers. Add the Webiny-specific variables to your `.env` file before running.

```env
  # Webiny Configuration (both APIs derived from WEBINY_API_URL when WEBINY_MANAGE_API_URL is not set)
  WEBINY_API_URL=https://your-webiny-instance.example.com/graphql
  WEBINY_MANAGE_API_URL=https://your-webiny-instance.example.com/cms/manage/en-US  # Optional
  WEBINY_API_TOKEN=your_webiny_api_token
  WEBINY_LOCALE=en-US  # Optional, defaults to "en-US"
  TENANT_ID=root       # Falls back to WEBINY_TENANT, then "root"
```

Then, in your shell (**not** in `.env`), set the destructive-operation safety guard:

```bash
$env:WEBINY_CONFIRM_DELETE_ALL="yes"   # PowerShell
# export WEBINY_CONFIRM_DELETE_ALL=yes # bash/zsh
```

**What it does:**

- Discovers all content models once via `listContentModels` on the Manage API
- **Phase 1 — Entries (Manage API):** For each model, calls `list<PluralApiName>` to get revision IDs, then `delete<SingularApiName>(revision: $r)` per entry
- **Phase 2 — Folders (Main API):** For each model, calls `aco.listFolders(where: { type: "cms:<modelId>" })`, orders folders so leaves are deleted before parents, then calls `aco.deleteFolder(id: $id)` per folder
- **Phase 3 — Content Models (Manage API):** Calls `deleteContentModel(modelId: $id)` for each non-plugin model; plugin models are logged and skipped
- **Phase 4 — Content Model Groups (Manage API):** Calls `listContentModelGroups` then `deleteContentModelGroup(id: $id)` for each non-plugin group

**Key Features:**

- Pure `fetch` + raw GraphQL — no `@webiny/sdk` dependency required
- Hard safety guard: refuses to run unless `WEBINY_CONFIRM_DELETE_ALL=yes` is set in the **shell** (not `.env`)
- Auto-derives the Manage API endpoint from `WEBINY_API_URL` + `WEBINY_LOCALE` when `WEBINY_MANAGE_API_URL` is not set
- Skips plugin-registered content models and groups (these cannot be deleted at runtime)
- Orders folder deletions leaves-first so Webiny does not reject parents that still contain children
- Per-phase error isolation: a failure inside one phase is logged but does not abort the remaining phases
- Structured logging of every list, delete, and skip to both console and `logs/delete-all-webiny-content.log`

**API Notes:**

- The Manage API exposes per-model typed queries (`list<PluralApiName>`) and mutations (`delete<SingularApiName>`), plus `listContentModels` / `deleteContentModel` and `listContentModelGroups` / `deleteContentModelGroup`. See the [GraphQL API Overview](https://www.webiny.com/docs/headless-cms/graphql-api-overview).
- The ACO `listFolders` / `deleteFolder` operations live on the Main API (`/graphql`), not on the Manage API.
- Webiny refuses to delete a folder that still contains child folders or entries, and refuses to delete a content model group that still contains models — this script orders the four phases (entries → folders → models → groups) to satisfy those constraints.
- The API token must be created in **Settings → Access Management → API Keys** in the Webiny Admin and granted write permission on both the Headless CMS and the Content (ACO) areas.

**Execution Order:**

1. Discover content models (`listContentModels`)
2. Phase 1 — delete all entries of every model
3. Phase 2 — delete all ACO folders for every `cms:<modelId>` type (leaves first)
4. Phase 3 — delete every non-plugin content model
5. Phase 4 — delete every non-plugin content model group

**Usage:**
To run the script, use the following command **after** setting `WEBINY_CONFIRM_DELETE_ALL=yes` in your shell:

```bash
ts-node .\lib\deleteAllWebinyContent.ts
```

**Output:** Per-phase progress, deleted IDs, and skipped plugin items are logged to the console and persisted to `logs/delete-all-webiny-content.log`.
