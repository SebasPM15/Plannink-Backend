import ActivityLog from '../models/activityLog.model.js';
import { logger } from '../utils/logger.js';

class ActivityLogService {
    /**
     * Crea una nueva entrada en el historial de actividad.
     * @param {object} logData - Los datos para el registro.
     * @param {number} logData.userId - ID del usuario que realiza la acción.
     * @param {number} logData.analysisId - ID del análisis afectado.
     * @param {string} logData.actionType - Tipo de acción (ej. 'OVERRIDE_SS').
     * @param {string} logData.description - Descripción para el usuario.
     * @param {string} [logData.productCode] - SKU del producto afectado (opcional).
     * @param {object} [logData.details] - JSON con detalles técnicos (opcional).
     */
    async createLog({ userId, analysisId, actionType, description, productCode = null, details = null }) {
        try {
            await ActivityLog.create({
                userId,
                analysisId,
                actionType,
                description,
                productCode,
                details,
            });
            logger.info(`Log creado: ${actionType} para análisis #${analysisId}`);
        } catch (error) {
            logger.error(`Error al crear log de actividad para análisis #${analysisId}:`, error);
            // No lanzamos el error para no detener la operación principal del usuario.
        }
    }

    /**
     * Obtiene todos los logs de actividad para un análisis específico.
     * @param {number} userId - ID del usuario.
     * @param {number} analysisId - ID del análisis.
     * @returns {Promise<Array>} - Lista de actividades.
     */
    async getLogsForAnalysis(userId, analysisId) {
        return ActivityLog.findAll({
            where: { userId, analysisId },
            order: [['createdAt', 'DESC']],
        });
    }
}

export default new ActivityLogService();
