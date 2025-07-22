import encryptionService from '../services/encryption.service.js';
import { handleHttpError } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware para descifrar el cuerpo de las peticiones.
 * Guarda la llave AES de la sesión en req.aesKey para cifrar la respuesta.
 */
export const decryptionMiddleware = (req, res, next) => {
    // Lista de rutas que no usan cifrado de body (ej. subida de archivos)
    const excludedRoutes = ['/api/predictions/refresh', '/api/reports'];
    
    // Verifica si la ruta actual empieza con alguna de las rutas excluidas.
    const isExcludedRoute = excludedRoutes.some(route => req.path.startsWith(route));

    // Si la petición no debe ser descifrada, continúa.
    if (req.method === 'GET' || isExcludedRoute || !req.body?.encryptedKey || !req.body?.payload) {
        return next();
    }

    try {
        // El servicio ahora devuelve el cuerpo descifrado Y la llave AES.
        const { decryptedBody, aesKey } = encryptionService.decryptRequest(req.body);

        // 1. Reemplazar el cuerpo de la petición con los datos descifrados.
        req.body = decryptedBody;
        
        // 2. ¡NUEVO! Guardar la llave AES en el objeto de la petición.
        req.aesKey = aesKey;
        
        logger.info('Payload de la petición descifrado exitosamente.');
        next();

    } catch (error) {
        logger.error('Error en middleware de descifrado:', error);
        return handleHttpError(res, 'DECRYPTION_ERROR', new Error('Fallo al procesar la petición segura.'), 400);
    }
};