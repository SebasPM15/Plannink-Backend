import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resolvePath = (relativePath) => path.resolve(__dirname, relativePath);

// Ruta raíz del backend dentro del contenedor
const BACKEND_ROOT = resolvePath("../../..");

export const PATHS = {
  AI_MODEL_DIR: process.env.AI_MODEL_DIR || resolvePath("../../../ai_model"),

  CONFIG_DIR: resolvePath("."),

  EXCEL_TEMPLATE: path.join(
    process.env.AI_MODEL_DIR || resolvePath("../../../ai_model"),
    "data",
    "PRUEBA PASANTIAS EPN.xlsx"
  ),

  UPLOADS_DIR:
    process.env.UPLOADS_DIR || path.join(BACKEND_ROOT, "public", "uploads"),

  LOGS_DIR: process.env.LOGS_DIR || path.join(BACKEND_ROOT, "logs"),

  MAX_FILE_SIZE: 10 * 1024 * 1024,
};

export const RATE_LIMIT = {
  WINDOW_MS: 15 * 60 * 1000,
  MAX_REQUESTS: 100,
};
