import Bottleneck from "bottleneck";
import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import { DocumentsApi } from "@kibocommerce/rest-sdk/clients/Content/apis/DocumentsApi";

const pageSize = 200;

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/copy-paste-documents.log",
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
  transport
);

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 500
});

dotenv.config();

// Source environment configuration
const sourceConfiguration = new Configuration({
  tenantId: process.env.TENANT_ID || "",
  siteId: process.env.SITE_ID || "",
  masterCatalog: process.env.MASTER_CATALOG || "",
  sharedSecret: process.env.SHARED_SECRET || "",
  clientId: process.env.CLIENT_ID || "",
  pciHost: process.env.PCI_HOST || "",
  authHost: process.env.AUTH_HOST || "",
  apiEnv: process.env.API_ENV || "",
});

// Destination environment configuration
const destinationConfiguration = new Configuration({
  tenantId: process.env.DEST_TENANT_ID || "",
  siteId: process.env.DEST_SITE_ID || "",
  masterCatalog: process.env.MASTER_CATALOG || "",
  sharedSecret: process.env.SHARED_SECRET || "",
  clientId: process.env.CLIENT_ID || "",
  pciHost: process.env.PCI_HOST || "",
  authHost: process.env.AUTH_HOST || "",
  apiEnv: process.env.API_ENV || "",
});

/**
 * Get all documents from a document list in the source environment
 * @param documentListName - The name of the document list
 * @returns Array of documents
 */
async function getDocumentsFromSource(documentListName: string) {
  logger.info({ documentListName }, 'Fetching documents from source environment...');

  const documentsClient = new DocumentsApi(sourceConfiguration);
  const allDocuments: any[] = [];
  let startIndex = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      await limiter.schedule(async () => {
        try {
          const response = await documentsClient.getDocuments({
            documentListName,
            pageSize,
            startIndex,
          });

          const documents = response.items || [];
          allDocuments.push(...documents);

          logger.info({
            documentListName,
            fetched: documents.length,
            total: allDocuments.length,
            totalCount: response.totalCount,
          }, 'Fetched batch of documents');

          // Check if there are more documents to fetch
          hasMore = allDocuments.length < (response.totalCount || 0);
          startIndex += pageSize;
        } catch (error) {
          logger.error({
            documentListName,
            error: error instanceof Error ? error.message : String(error),
          }, 'Error fetching documents');
          throw error;
        }
      });
    }

    logger.info({
      documentListName,
      totalDocuments: allDocuments.length,
    }, 'Successfully fetched all documents from source');

    return allDocuments;
  } catch (error) {
    logger.error({
      documentListName,
      error: error instanceof Error ? error.message : String(error),
    }, 'Error in getDocumentsFromSource');
    throw error;
  }
}

/**
 * Create a document in the destination environment
 * @param documentListName - The name of the document list
 * @param document - The document object to create
 * @returns The created document
 */
async function createDocumentInDestination(documentListName: string, document: any) {
  logger.info({
    documentListName,
    documentName: document.name,
    documentId: document.id,
  }, 'Creating document in destination environment...');

  const documentsClient = new DocumentsApi(destinationConfiguration);

  try {
    const createdDocument = await documentsClient.createDocument({
      documentListName,
      document: {
        name: document.name,
        documentTypeFQN: document.documentTypeFQN,
        listFQN: document.listFQN,
        properties: document.properties,
        publishState: document.publishState,
      },
    });

    logger.info({
      documentListName,
      documentId: createdDocument.id,
      documentName: createdDocument.name,
    }, 'Successfully created document in destination');

    return createdDocument;
  } catch (error) {
    logger.error({
      documentListName,
      documentName: document.name,
      error: error instanceof Error ? error.message : String(error),
    }, 'Error creating document in destination');
    throw error;
  }
}

/**
 * Copy all documents from source environment to destination environment
 * @param documentListName - The name of the document list to copy
 */
async function copyDocuments(documentListName: string) {
  logger.info({ documentListName }, 'Starting document copy process...');

  try {
    // Fetch all documents from source
    const documents = await getDocumentsFromSource(documentListName);

    if (documents.length === 0) {
      logger.info({ documentListName }, 'No documents found to copy');
      return;
    }

    logger.info({
      documentListName,
      totalDocuments: documents.length,
    }, 'Starting to copy documents to destination');

    let successCount = 0;
    let failureCount = 0;

    // Copy each document to destination with rate limiting
    for (const [index, document] of documents.entries()) {
      logger.info({
        index: index + 1,
        total: documents.length,
        documentName: document.name,
      }, 'Processing document');

      await limiter.schedule(async () => {
        try {
          await createDocumentInDestination(documentListName, document);
          successCount++;
        } catch (error) {
          failureCount++;
          logger.error({
            documentName: document.name,
            error: error instanceof Error ? error.message : String(error),
          }, 'Failed to copy document - continuing with next document');
        }
      });
    }

    logger.info({
      documentListName,
      totalDocuments: documents.length,
      successCount,
      failureCount,
    }, 'Document copy process complete');
  } catch (error) {
    logger.error({
      documentListName,
      error: error instanceof Error ? error.message : String(error),
    }, 'Error in copyDocuments');
    throw error;
  }
}

/**
 * Main function to execute the document copy process
 */
async function main() {
  // Get document list name from environment variable or use default
  const documentListName = process.env.DOCUMENT_LIST_NAME || "";

  if (!documentListName) {
    logger.error('DOCUMENT_LIST_NAME environment variable is required');
    throw new Error('DOCUMENT_LIST_NAME environment variable is required');
  }

  await copyDocuments(documentListName);
  logger.info('*** Document copy-paste process complete! 👍🏽 ***');
}

main();
