import encryptionService from '../services/encryption.service.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware para cifrar las respuestas del servidor.
 * Intercepta la función res.json() para aplicar el cifrado.
 */
export const encryptionMiddleware = (req, res, next) => {
    // Guardamos una referencia a la función original res.json
    const originalJson = res.json;

    // Sobrescribimos res.json con nuestra lógica de cifrado
    res.json = (body) => {
        // Restauramos la función original para evitar bucles infinitos y
        // para que la llamada final funcione correctamente.
        res.json = originalJson;

        // Condición para cifrar:
        // 1. La petición original debe haber sido cifrada (por lo tanto, req.aesKey existe).
        // 2. La respuesta no debe ser un error (asumimos que los errores no se cifran).
        if (!req.aesKey || body.success === false) {
            return res.json(body);
        }

        try {
            logger.info('Cifrando la respuesta del servidor...');
            // Cifrar el cuerpo de la respuesta con la misma llave AES de la petición
            const encryptedPayload = encryptionService.encryptResponse(body, req.aesKey);
            
            // Enviamos un nuevo objeto que contiene el payload cifrado.
            // El frontend espera un campo 'data' con la información cifrada.
            return res.json({ data: encryptedPayload });

        } catch (error) {
            logger.error('Error al cifrar la respuesta:', error);
            // Si el cifrado falla, enviar un error de servidor.
            return res.status(500).json({
                success: false,
                error: 'RESPONSE_ENCRYPTION_ERROR',
                message: 'No se pudo cifrar la respuesta del servidor.'
            });
        }
    };

    next();
};