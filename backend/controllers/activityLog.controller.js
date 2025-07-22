import activityLogService from '../services/activityLog.service.js';
import { handleHttpError } from '../utils/errorHandler.js';

/**
 * Obtiene el historial de actividades para un análisis específico.
 * @param {object} req - Objeto de solicitud Express.
 * @param {object} res - Objeto de respuesta Express.
 */
export const getAnalysisHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const { analysisId } = req.params;

        // Validar que el analysisId es un número
        if (isNaN(parseInt(analysisId, 10))) {
            return handleHttpError(res, 'INVALID_ANALYSIS_ID', new Error('El ID del análisis es inválido.'), 400);
        }

        const logs = await activityLogService.getLogsForAnalysis(userId, parseInt(analysisId, 10));

        // Es normal que un análisis nuevo no tenga logs, así que no se devuelve 404 si está vacío.
        res.json({ success: true, data: logs });

    } catch (err) {
        handleHttpError(res, 'GET_ANALYSIS_HISTORY_ERROR', err);
    }
};
