# Kibo TypeScript SDK - Sarnova Sandbox Tools

This repository contains utilities for setting up and managing Sarnova sandbox environments using the Kibo TypeScript SDK.

---

## Getting Started

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

---

## Logs

All scripts generate detailed logs in the `logs/` directory:
- `add-sandbox-products.log` - Product creation logs
- `delete-sandbox-products.log` - Deletion operation logs

Logs include timestamps, operation status, entity details, and error messages for troubleshooting.

---

## Scripts Overview

### 1. `newSandboxSetup.ts`

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

### 2. `newSandboxProducts.ts`

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

**⚠️ WARNING:** The script below permanently deletes catalog data. Use with caution!

### 3. `deleteProdsCatsTypesAttributes.ts`

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

