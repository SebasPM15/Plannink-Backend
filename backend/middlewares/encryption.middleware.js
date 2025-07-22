import encryptionService from '../services/encryption.service.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware para cifrar las respuestas del servidor de forma estricta.
 * Intercepta la función res.json() para aplicar el cifrado de forma obligatoria
 * solo si la petición original fue cifrada.
 */
export const encryptionMiddleware = (req, res, next) => {
    // Guardamos una referencia a la función original res.json para poder restaurarla.
    const originalJson = res.json;

    // Sobrescribimos res.json con nuestra nueva lógica de cifrado.
    res.json = (body) => {
        // Restauramos la función original inmediatamente para que la llamada final
        // dentro de este bloque funcione y para evitar bucles infinitos.
        res.json = originalJson;

        // --- LÓGICA ESTRICTA DE CIFRADO ---
        // La respuesta solo se cifrará si se cumplen AMBAS condiciones:
        // 1. La petición original fue cifrada (lo sabemos porque `req.aesKey` existe).
        // 2. La respuesta del controlador NO es un error explícito (ej. `{ success: false, ... }`).
        //    Esto asegura que los mensajes de error lleguen en texto plano para facilitar la depuración en el frontend.
        if (!req.aesKey || (body && body.success === false)) {
            // Si no se cumplen las condiciones, se envía la respuesta en texto plano.
            return res.json(body);
        }

        try {
            logger.info('Cifrando la respuesta del servidor...');
            // Cifrar el cuerpo de la respuesta con la misma llave AES de la petición.
            const encryptedPayload = encryptionService.encryptResponse(body, req.aesKey);
            
            // Enviamos un nuevo objeto que contiene el payload cifrado.
            // El frontend espera un campo 'data' con la información cifrada.
            return res.json({ data: encryptedPayload });

        } catch (error) {
            logger.error('Error al cifrar la respuesta:', error);
            // Si el cifrado falla, es un error crítico del servidor.
            return res.status(500).json({
                success: false,
                error: 'RESPONSE_ENCRYPTION_ERROR',
                message: 'No se pudo cifrar la respuesta del servidor.'
            });
        }
    };

    // Continuar al siguiente middleware en la cadena.
    next();
};