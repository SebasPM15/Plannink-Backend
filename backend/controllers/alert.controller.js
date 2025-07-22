import AlertService from '../services/alert.service.js';
import { handleHttpError } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';

export const evaluarAlertaYNotificar = async (req, res) => {
    try {
        // La validación del body ya fue hecha por el middleware de Joi.
        const { predictionData, isManual } = req.body;

        // El email se obtiene del usuario autenticado, no del body de la petición.
        // Esto previene que tu API sea usada para enviar correos a terceros.
        const email = req.user.email;

        const resultado = await AlertService.evaluarYEnviarAlerta(predictionData, email, isManual);

        if (resultado.alreadySent) {
            return res.status(200).json({
                success: false,
                message: 'Alerta ya fue enviada hoy. Puede reenviar manualmente si es necesario.',
                ...resultado
            });
        }

        if (!resultado.success) {
            // Si no fue exitoso pero no fue porque ya se envió, puede ser otro motivo (ej. no se requiere alerta).
            return res.status(202).json({ success: false, ...resultado });
        }

        return res.status(200).json({
            success: true,
            message: 'Alerta enviada correctamente.',
            ...resultado
        });
    } catch (error) {
        // Usamos el manejador de errores centralizado
        handleHttpError(res, 'ALERT_PROCESSING_ERROR', error);
    }
};
