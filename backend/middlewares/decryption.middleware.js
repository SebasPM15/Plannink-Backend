import encryptionService from '../services/encryption.service.js';
import { handleHttpError } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware para descifrar el cuerpo de las peticiones.
 * Ahora es ESTRICTO: rechaza peticiones no cifradas.
 */
export const decryptionMiddleware = (req, res, next) => {
    // Las peticiones GET no tienen un cuerpo que descifrar, así que continúan.
    if (req.method === 'GET') {
        return next();
    }

    // Las peticiones de subida de archivos (multipart/form-data) se excluyen del cifrado de body.
    // El cifrado se aplica a JSON, no a archivos binarios.
    if (req.headers['content-type']?.includes('multipart/form-data')) {
        return next();
    }

    // --- LÓGICA ESTRICTA ---
    // A partir de aquí, esperamos que cualquier petición con un cuerpo (POST, PUT, PATCH) esté cifrada.

    // Si la petición tiene un cuerpo pero NO tiene la estructura cifrada, se rechaza.
    if (req.body && (!req.body.encryptedKey || !req.body.payload)) {
        logger.warn(`Petición no cifrada rechazada para la ruta: ${req.path}`);
        return handleHttpError(res, 'UNENCRYPTED_REQUEST', new Error('Esta ruta requiere un payload cifrado.'), 400);
    }

    // Si la petición tiene el formato cifrado correcto, se procesa.
    if (req.body) {
        try {
            const { decryptedBody, aesKey } = encryptionService.decryptRequest(req.body);
            
            // Reemplazar el cuerpo de la petición con los datos descifrados.
            req.body = decryptedBody;
            
            // Guardar la llave AES en el objeto de la petición para poder cifrar la respuesta.
            req.aesKey = aesKey;
            
            logger.info('Payload de la petición descifrado exitosamente.');
        } catch (error) {
            return handleHttpError(res, 'DECRYPTION_ERROR', new Error('Fallo al procesar la petición segura.'), 400);
        }
    }
    
    // Continuar al siguiente middleware o controlador.
    next();
};