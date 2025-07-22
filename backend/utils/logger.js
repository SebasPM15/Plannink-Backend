import winston from 'winston';
import 'winston-daily-rotate-file'; // Importante para activar el transport
import path from 'path';
import { PATHS } from '../config/constants.js';
import fs from 'fs';

// Asegurarse de que el directorio de logs exista
if (!fs.existsSync(PATHS.LOGS_DIR)) {
    fs.mkdirSync(PATHS.LOGS_DIR, { recursive: true });
}

// 1. Configuración del transport de rotación de archivos
// Este transport se encargará de crear, rotar, comprimir y limpiar los archivos de log.
const fileRotateTransport = new winston.transports.DailyRotateFile({
    dirname: PATHS.LOGS_DIR,         // Directorio donde se guardarán los logs
    filename: 'app-%DATE%.log',      // Patrón del nombre de archivo. %DATE% será reemplazado.
    datePattern: 'YYYY-WW',          // Rota los logs SEMANALMENTE. Ej: app-2025-28.log (semana 28 del 2025)
    zippedArchive: true,             // Comprime los logs antiguos en .gz
    maxSize: '20m',                  // Tamaño máximo del archivo antes de rotar (ej. 20MB)
    maxFiles: '30d',                 // Conserva los logs de los últimos 30 días. Los más antiguos se borran.
    level: 'info'
});

const errorFileRotateTransport = new winston.transports.DailyRotateFile({
    dirname: PATHS.LOGS_DIR,
    filename: 'error-%DATE%.log',
    datePattern: 'YYYY-WW',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error' // Solo logs de nivel 'error'
});


// 2. Formato para la consola (más legible en desarrollo)
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
);

// 3. Creación del Logger principal
const logger = winston.createLogger({
    // Nivel de log: 'info' para producción, 'debug' para desarrollo
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json() // El formato por defecto para los archivos será JSON
    ),
    transports: [
        // En producción, usa los transports de rotación de archivos.
        fileRotateTransport,
        errorFileRotateTransport
    ],
    // 4. Manejo de excepciones no capturadas
    // Si la app crashea, este logger se asegurará de registrar el error fatal.
    exceptionHandlers: [
        new winston.transports.File({ filename: path.join(PATHS.LOGS_DIR, 'exceptions.log') })
    ],
    rejectionHandlers: [
        new winston.transports.File({ filename: path.join(PATHS.LOGS_DIR, 'rejections.log') })
    ]
});

// 5. Añadir la consola solo si no estamos en producción
// En producción, los logs de consola pueden afectar el rendimiento.
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat
    }));
}

// Stream para que Morgan (el logger de peticiones HTTP) use Winston
logger.stream = {
    write: (message) => logger.info(message.trim())
};

export { logger };
