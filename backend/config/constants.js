import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// Cargar variables de entorno desde .env
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Función auxiliar para obtener rutas absolutas de manera segura
const resolvePath = (relativePath) => path.resolve(__dirname, relativePath);

export const PATHS = {
    // Directorio del modelo de IA
    AI_MODEL_DIR: resolvePath('../../ai_model'),

    // --- NUEVA RUTA ---
    // Directorio para los archivos de configuración (llaves RSA, etc.)
    // Asume que este archivo (constants.js) se encuentra en 'src/config'
    CONFIG_DIR: resolvePath('.'),

    // Plantilla de Excel
    EXCEL_TEMPLATE: resolvePath('../../ai_model/data/PRUEBA PASANTIAS EPN.xlsx'),

    // Directorio para subidas temporales de archivos
    UPLOADS_DIR: resolvePath('../public/uploads'),

    // Directorio para los logs
    LOGS_DIR: process.env.LOGS_DIR || resolvePath('../logs'),

    // Tamaño máximo de archivo
    MAX_FILE_SIZE: 10 * 1024 * 1024 // 10MB
};

export const RATE_LIMIT = {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutos
    MAX_REQUESTS: 100
};