import encryptionService from '../services/encryption.service.js';
import { handleHttpError } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';

// --- [NUEVO] LISTA DE RUTAS PÚBLICAS ---
// Rutas que no requieren cifrado. Se debe usar la ruta completa que ve Express.
const PUBLIC_ROUTES = [
    '/api/security/public-key', // Ruta para obtener la llave pública
    '/health',                  // Ruta de Health Check
    '/api/health',              // Ruta de Health Check alternativa
    // Las rutas de Swagger UI a menudo tienen sub-rutas, usar un startsWith es más robusto.
];

/**
 * Middleware para descifrar peticiones entrantes de forma estricta.
 */
export const decryptionMiddleware = (req, res, next) => {
    // --- Verificación de Ruta Pública ---
    // Usamos startsWith para Swagger, ya que genera múltiples rutas (index.html, swagger-ui-bundle.js, etc.)
    if (PUBLIC_ROUTES.includes(req.path) || req.path.startsWith('/api-docs')) {
        logger.info(`Ruta pública accedida, omitiendo descifrado para: ${req.path}`);
        return next();
    }

    // Excluir subida de archivos (multipart/form-data) del cifrado.
    if (req.headers['content-type']?.includes('multipart/form-data')) {
        return next();
    }

    try {
        // --- LÓGICA PARA PETICIONES GET (Seguras) ---
        if (req.method === 'GET') {
            const encryptedKeyHeader = req.headers['x-encrypted-key'];

            if (!encryptedKeyHeader) {
                logger.warn(`Petición GET segura sin header 'X-Encrypted-Key' rechazada para la ruta: ${req.path}`);
                return handleHttpError(res, 'MISSING_ENCRYPTION_KEY', new Error('Esta ruta GET segura requiere una llave de cifrado en el header.'), 400);
            }

            const aesKey = encryptionService.decryptSessionKey(encryptedKeyHeader);
            req.aesKey = aesKey;
            logger.info('Llave de sesión de GET descifrada exitosamente.');
        
        // --- LÓGICA PARA PETICIONES CON CUERPO (POST, PUT, PATCH - Seguras) ---
        } else if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
            
            if (!req.body.encryptedKey || !req.body.payload) {
                logger.warn(`Petición no cifrada rechazada para la ruta: ${req.path}`);
                return handleHttpError(res, 'UNENCRYPTED_REQUEST', new Error('Esta ruta requiere un payload cifrado.'), 400);
            }

            const { decryptedBody, aesKey } = encryptionService.decryptRequest(req.body);
            req.body = decryptedBody;
            req.aesKey = aesKey;
            logger.info('Payload de la petición descifrado exitosamente.');
        }

    } catch (error) {
        return handleHttpError(res, 'DECRYPTION_ERROR', new Error('Fallo al procesar la petición segura.'), 400);
    }
    
    // Continuar al siguiente middleware o controlador.
    next();
};