// File: controllers/activityLog.controller.js
import ActivityLogService from "../services/activityLog.service.js";
import { handleHttpError } from "../utils/errorHandler.js";

/**
 * @swagger
 * tags:
 *   name: ActivityLog
 *   description: Historial de actividades
 */

/**
 * @swagger
 * /api/history/{analysisId}:
 *   get:
 *     summary: Obtiene historial de un análisis
 *     tags: [ActivityLog]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: analysisId
 *         schema: { type: integer }
 *         required: true
 *     responses:
 *       200:
 *         description: Array de eventos
 */
export const getAnalysisHistory = async (req, res) => {
  try {
    const data = await ActivityLogService.getByAnalysis(
      req.params.analysisId,
      req.user.id
    );
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleHttpError(res, "GET_HISTORY_ERROR", err, err.status || 404);
  }
};
