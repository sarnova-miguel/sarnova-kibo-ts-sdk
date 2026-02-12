import Bottleneck from "bottleneck";
import * as dotenv from "dotenv";
import pino from "pino";
import { Configuration } from "@kibocommerce/rest-sdk";
import { DocumentsApi } from "@kibocommerce/rest-sdk/clients/Content/apis/DocumentsApi";
import { DocumentTypeApi } from "@kibocommerce/rest-sdk/clients/Content/apis/DocumentTypeApi";
import { DocumentListApi } from "@kibocommerce/rest-sdk/clients/Content/apis/DocumentListApi";
import { DocumentPublishingApi } from "@kibocommerce/rest-sdk/clients/Content/apis/DocumentPublishingApi";

import documentTemplateData from "./data/documentTemplate.json";
import documentListTemplateData from "./data/documentListTemplate.json";
import documentTypeTemplateData from "./data/documentTypeTemplate.json";

const documentTemplate = documentTemplateData;
const documentListTemplate = documentListTemplateData;
const documentTypeTemplate = documentTypeTemplateData;

// Initialize Pino logger with multiple transports
const transport = pino.transport({
  targets: [
    {
      target: "pino/file",
      options: {
        destination: "./logs/document-type-list-creation.log",
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

const configuration = new Configuration({
  tenantId: process.env.TENANT_ID || "",
  siteId: process.env.SITE_ID || "",
  masterCatalog: process.env.MASTER_CATALOG || "",
  sharedSecret: process.env.SHARED_SECRET || "",
  clientId: process.env.CLIENT_ID || "",
  pciHost: process.env.PCI_HOST || "",
  authHost: process.env.AUTH_HOST || "",
  apiEnv: process.env.API_ENV || "",
});

// view document
async function viewDocument(docId: string, docListName: string) {
    logger.info({ docId, docListName }, 'Viewing document...');

    const documentsClient = new DocumentsApi(configuration);

    try {
        const document = await documentsClient.getDocument({
            documentListName: docListName,
            documentId: docId
        });

        logger.info({ document }, 'Document retrieved successfully');

        console.log('Document retrieved successfully: ', { document });
        const messages = document.properties.messages;
        console.log('Messages retrieved successfully: ', { messages });
        messages.forEach((text: string, index: number) => {
            const parsedText = JSON.parse(text);
            console.log(`Text ${index + 1}: `, parsedText.text);
            console.log(`Redirect URL ${index + 1}: `, parsedText.redirectUrl);
        });

        return document;
    } catch (error) {
        logger.error({ error }, 'Error retrieving document');
        throw error;
    }
}

// create document type
// This function uses data from data/documentTypeTemplate.json
// Use this data to create sample document types for testing and dev purposes.
// Or update the data to match your needs.
async function createDocumentType() {
    logger.info('Starting document type creation...');

    const documentTypeClient = new DocumentTypeApi(configuration);

    try {
        // Use limiter to rate-limit API calls
        await limiter.schedule(async () => {
            try {
                const createdDocumentType = await documentTypeClient.createDocumentType({
                    documentType: documentTypeTemplate
                });
                logger.info({
                    documentTypeFQN: createdDocumentType.documentTypeFQN,
                    name: createdDocumentType.name,
                    namespace: createdDocumentType.namespace
                }, 'Created document type');
            } catch (error) {
                logger.error({
                    documentTypeFQN: documentTypeTemplate.documentTypeFQN,
                    name: documentTypeTemplate.name,
                    error: error instanceof Error ? error.message : String(error)
                }, 'Error creating document type');
            }
        });
        logger.info('Document type creation complete');
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error)
        }, 'Error in createDocumentType');
    }
}


// create document list
// This function uses data from data/documentListTemplate.json
// Update the scopeId to match your siteId in the .env file before running.
// Use this data to create sample document lists for testing and dev purposes.
// Or update the data to match your needs.
async function createDocumentList() {
    logger.info('Starting document list creation...');

    const documentListClient = new DocumentListApi(configuration);

    try {
        // Use limiter to rate-limit API calls
        await limiter.schedule(async () => {
            try {
                // Use siteId from environment as scopeId
                const documentListData = {
                    ...documentListTemplate,
                    scopeId: parseInt(process.env.SITE_ID || '0')
                };

                const createdDocumentList = await documentListClient.createDocumentList({
                    documentList: documentListData
                });
                logger.info({
                    listFQN: createdDocumentList.listFQN,
                    name: createdDocumentList.name,
                    namespace: createdDocumentList.namespace,
                    scopeId: createdDocumentList.scopeId
                }, 'Created document list');
            } catch (error) {
                logger.error({
                    documentListFQN: `${documentListTemplate.name}@${documentListTemplate.namespace}`,
                    name: documentListTemplate.name,
                    error: error instanceof Error ? error.message : String(error),
                    fullError: error
                }, 'Error creating document list');
            }
        });
        logger.info('Document list creation complete');
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error)
        }, 'Error in createDocumentList');
    }
}


// create documents
// This function uses data from data/documentTemplate.json
// The documentTemplate.json file should contain an array of document objects.
// Use this data to create sample documents for testing and dev purposes.
// Or update the data to match your needs.
async function createDocuments() {
    logger.info('Starting document creation...');

    const documentsClient = new DocumentsApi(configuration);
    const publishingClient = new DocumentPublishingApi(configuration);

    try {
        const documentIds: string[] = [];

        // Iterate through each document template in the array
        for (const [index, docTemplate] of documentTemplate.entries()) {
            logger.info({
                index: index + 1,
                total: documentTemplate.length,
                documentName: docTemplate.name
            }, 'Processing document');

            let documentId: string | undefined;

            // Use limiter to rate-limit API calls for document creation
            await limiter.schedule(async () => {
                try {
                    const createdDocument = await documentsClient.createDocument({
                        documentListName: docTemplate.listFQN,
                        document: docTemplate
                    });
                    documentId = createdDocument.id ?? undefined;
                    if (documentId) {
                        documentIds.push(documentId);
                    }
                    logger.info({
                        documentId: createdDocument.id,
                        name: createdDocument.name,
                        documentTypeFQN: createdDocument.documentTypeFQN,
                        listFQN: createdDocument.listFQN,
                        publishState: createdDocument.publishState
                    }, 'Created document');
                } catch (error) {
                    logger.error({
                        documentName: docTemplate.name,
                        listFQN: docTemplate.listFQN,
                        error: error instanceof Error ? error.message : String(error),
                        fullError: error
                    }, 'Error creating document');
                }
            });

            // Publish the document if it was created successfully
            if (documentId) {
                await limiter.schedule(async () => {
                    try {
                        await publishingClient.publishDocuments({
                            requestBody: [documentId!]
                        });
                        logger.info({
                            documentId,
                            listFQN: docTemplate.listFQN
                        }, 'Published document');
                    } catch (error) {
                        logger.error({
                            documentId,
                            listFQN: docTemplate.listFQN,
                            error: error instanceof Error ? error.message : String(error),
                            fullError: error
                        }, 'Error publishing document');
                    }
                });
            }
        }

        logger.info({
            totalDocuments: documentTemplate.length,
            successfullyCreated: documentIds.length
        }, 'Document creation and publishing complete');
    } catch (error) {
        logger.error({
            error: error instanceof Error ? error.message : String(error)
        }, 'Error in createDocuments');
    }
}



// ***** ready functions *****
async function main() {
    // await createDocumentType();
    // await createDocumentList();
    await createDocuments();
    logger.info('*** Document type list creation process complete!👍🏽 ***');
}


main();