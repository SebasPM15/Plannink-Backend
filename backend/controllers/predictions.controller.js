// File: controllers/predictions.controller.js
import PredictionService from "../services/python.service.js";
import { handleHttpError } from "../utils/errorHandler.js";

/**
 * @swagger
 * tags:
 *   name: Predictions
 *   description: Gestión de análisis y proyecciones
 */

/**
 * @swagger
 * /api/predictions/analyses:
 *   get:
 *     summary: Lista análisis del usuario
 *     tags: [Predictions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de análisis
 */
export const listAnalyses = async (req, res) => {
  try {
    const data = await PredictionService.listAnalyses(req.user.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleHttpError(res, "LIST_ANALYSES_ERROR", err, err.status || 500);
  }
};

/**
 * @swagger
 * /api/predictions/{id}:
 *   get:
 *     summary: Obtiene predicción por ID
 *     tags: [Predictions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema: { type: integer }
 *         required: true
 *     responses:
 *       200:
 *         description: Detalle de predicción
 */
export const getPredictionById = async (req, res) => {
  try {
    const data = await PredictionService.getById(req.params.id, req.user.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleHttpError(res, "GET_PREDICTION_ERROR", err, err.status || 404);
  }
};

/**
 * @swagger
 * /api/predictions/refresh:
 *   post:
 *     summary: Procesa Excel y genera análisis
 *     tags: [Predictions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [excel,analysisName]
 *             properties:
 *               excel: { type: string, format: binary }
 *               analysisName: { type: string }
 *     responses:
 *       201:
 *         description: Análisis generado
 */
export const refreshPredictions = async (req, res) => {
  try {
    await PredictionService.refresh(
      req.file,
      req.body.analysisName,
      req.user.id
    );
    res.status(201).json({ success: true, message: "Análisis generado" });
  } catch (err) {
    handleHttpError(res, "REFRESH_ERROR", err, err.status || 400);
  }
};

/**
 * @swagger
 * /api/predictions/safety-stock:
 *   post:
 *     summary: Aplica stock de seguridad
 *     tags: [Predictions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SafetyStockRequest'
 *     responses:
 *       200:
 *         description: Stock aplicado
 */
export const applySafetyStockToProjection = async (req, res) => {
  try {
    const data = await PredictionService.applySafetyStock(
      req.body,
      req.user.id
    );
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleHttpError(res, "STOCK_ERROR", err, err.status || 400);
  }
};

/**
 * @swagger
 * /api/predictions/alert:
 *   put:
 *     summary: Actualiza configuración de alerta
 *     tags: [Predictions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAlertRequest'
 *     responses:
 *       200:
 *         description: Alerta actualizada
 */
export const updateAlert = async (req, res) => {
  try {
    const data = await PredictionService.updateAlert(req.body, req.user.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleHttpError(res, "UPDATE_ALERT_ERROR", err, err.status || 400);
  }
};

/**
 * @swagger
 * /api/predictions/transit-units:
 *   post:
 *     summary: Agrega unidades en tránsito manuales
 *     tags: [Predictions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransitUnitsRequest'
 *     responses:
 *       200:
 *         description: Unidades agregadas
 */
export const addManualTransitUnits = async (req, res) => {
  try {
    const data = await PredictionService.addTransitUnits(req.body, req.user.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleHttpError(res, "TRANSIT_ERROR", err, err.status || 400);
  }
};
