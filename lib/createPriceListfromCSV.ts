import * as fs from "fs";
import * as path from "path";
import { parse } from "csv/sync";
import pino from "pino";

// --- Logger setup ---
const logger = pino({
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: { colorize: true },
        level: "info",
      },
      {
        target: "pino/file",
        options: {
          destination: path.join(__dirname, "..", "logs", "create-pricelist-from-csv.log"),
        },
        level: "info",
      },
    ],
  },
});

// --- Main ---
async function main() {
  const csvFilePath = process.argv[2];

  if (!csvFilePath) {
    logger.error("No CSV file path provided. Usage: ts-node lib/createPriceListfromCSV.ts <path-to-csv>");
    process.exit(1);
  }

  const resolvedPath = path.resolve(csvFilePath);

  if (!fs.existsSync(resolvedPath)) {
    logger.error({ path: resolvedPath }, "CSV file not found");
    process.exit(1);
  }

  logger.info({ path: resolvedPath }, "Reading CSV file");

  const fileContent = fs.readFileSync(resolvedPath, "utf-8");

  const records: Record<string, string>[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  logger.info({ totalRows: records.length }, "CSV file parsed successfully");

  // Log column headers
  if (records.length > 0) {
    const columns = Object.keys(records[0]);
    logger.info({ columns }, "CSV columns detected");
  }

  // Log each row
  records.forEach((record, index) => {
    logger.info({ row: index + 1, data: record }, "CSV row");
  });

  logger.info("Done logging CSV contents");
}

main().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, "Unhandled error");
  process.exit(1);
});
