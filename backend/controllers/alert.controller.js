// File: controllers/alert.controller.js
import AlertService from "../services/alert.service.js";
import { handleHttpError } from "../utils/errorHandler.js";

/**
 * @swagger
 * tags:
 *   name: Alerts
 *   description: Creación y envío de alertas
 */

/**
 * @swagger
 * /api/alertas/stock:
 *   post:
 *     summary: Evalúa y envía alertas de stock
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [predictionData]
 *             properties:
 *               predictionData: { type: array }
 *               isManual: { type: boolean }
 *     responses:
 *       200:
 *         description: Alerta procesada
 */
export const evaluarAlertaYNotificar = async (req, res) => {
  try {
    const data = await AlertService.evaluateAndNotify(req.body, req.user.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleHttpError(res, "ALERT_ERROR", err, err.status || 400);
  }
};
