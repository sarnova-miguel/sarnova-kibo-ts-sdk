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

---

## 🌎 Quick Links

- [Kibo TypeScript SDK - Documentation](https://docs.kibocommerce.com/pages/typescript-sdk)
- [Kido TypeScript SDK - Github](https://github.com/KiboSoftware/typescript-rest-sdk)
- [Kibo API Documentation](https://docs.kibocommerce.com/api-overviews/getting-started)
- [ts-node](https://www.npmjs.com/package/ts-node)

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

3. **Set Up New Sandbox**

   ```bash
   ts-node .\lib\newSandboxSetup.ts
   ```

4. **Load Product Data**

   ```bash
   ts-node .\lib\newSandboxProducts.ts
   ```

5. **Clean Up (if needed)**

   ```bash
   ts-node .\lib\deleteProdsCatsTypesAttributes.ts
   ```

6. **Create Document Type, List, and Docs**

   ```bash
   ts-node .\lib\createDocTypeListDocs.ts
   ```

7. **Copy Documents Between Environments**

   ```bash
   ts-node .\lib\copyPasteDocs.ts
   ```

8. **Cart to Completed Order**

   ```bash
   ts-node .\lib\cartToCompletedOrder.ts
   ```

9. **Cart to Checkout to Order**

   ```bash
   ts-node .\lib\cartToCheckoutToOrder.ts
   ```

10. **Add Subscription Attributes**

```bash
ts-node .\lib\addSubscriptionAttributes.ts
```

11. **Create User Account and Login**

```bash
ts-node .\lib\userLogin.ts
```

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

- Deletes all products
- Deletes all categories (with cascade delete for children)
- Deletes all product types (except "Base" type)
- Deletes all product attributes (except system attributes)

**Key Features:**

- Batch processing (200 items per batch)
- Rate limiting (500ms between API calls)
- Structured logging to both console and `logs/delete-sandbox-products.log`
- Protects system-critical attributes and the "Base" product type
- Cascade deletion for categories to handle parent-child relationships

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

**Execution Order:**

1. Products (must be deleted first)
2. Categories
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
