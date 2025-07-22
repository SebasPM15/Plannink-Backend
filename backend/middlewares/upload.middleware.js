import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises'; // <-- Importación faltante
import { PATHS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

// Configuración de rutas segura para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración mejorada del directorio de uploads
const getUploadsDir = async () => {
    try {
        const uploadsDir = PATHS?.UPLOADS_DIR || path.join(__dirname, '../public/uploads');
        
        // Verificar y crear directorio si no existe
        await fs.access(uploadsDir).catch(async () => {
            await fs.mkdir(uploadsDir, { recursive: true });
            logger.info(`Directorio de uploads creado en: ${uploadsDir}`);
        });
        
        return uploadsDir;
    } catch (error) {
        logger.error(`Error configurando directorio: ${error.message}`);
        throw new Error('Configuración fallida del sistema de archivos');
    }
};

// Configuración de almacenamiento dinámica
const createStorage = (uploadsDir) => multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const fileExt = path.extname(file.originalname);
        const fileName = path.basename(file.originalname, fileExt)
            .replace(/[^a-z0-9]/gi, '_') // Sanitizar nombre
            .toLowerCase();
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${fileName}-${uniqueSuffix}${fileExt}`);
    }
});

// Tipos MIME permitidos (Excel)
const ALLOWED_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel' // .xls
];

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];

// Middleware de upload configurado dinámicamente
export const configureUploadMiddleware = async () => {
    try {
        const uploadsDir = await getUploadsDir();
        return multer({
            storage: createStorage(uploadsDir),
            fileFilter: (req, file, cb) => {
                const fileExt = path.extname(file.originalname).toLowerCase();
                if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(fileExt)) {
                    const error = new Error(`Archivo no permitido: ${file.originalname}`);
                    error.code = 'INVALID_FILE_TYPE';
                    return cb(error, false);
                }
                cb(null, true);
            },
            limits: {
                fileSize: 10 * 1024 * 1024, // 10MB
                files: 1
            }
        });
    } catch (error) {
        logger.error(`Error inicializando upload middleware: ${error.message}`);
        throw error;
    }
};

// Export como función configurable
export const uploadMiddleware = await configureUploadMiddleware();