import pythonService from '../services/python.service.js';
import { handleHttpError } from '../utils/errorHandler.js';
import fs from 'fs/promises'; // Importar fs para la limpieza de archivos
import { logger } from '../utils/logger.js'; // Importar logger

/**
 * Obtiene las predicciones más recientes para un usuario.
 * @param {object} req - Objeto de solicitud Express.
 * @param {object} res - Objeto de respuesta Express.
 */
export const getPredictions = async (req, res) => {
    try {
        const userId = req.user.id;
        const analyses = await pythonService.listAnalysesForUser(userId);
        res.json({ success: true, data: analyses });
    } catch (error) {
        handleHttpError(res, 'ERROR_GET_PREDICTIONS', error);
    }
};

/**
 * Obtiene los datos de un análisis específico por su ID.
 * @param {object} req - Objeto de solicitud Express.
 * @param {object} res - Objeto de respuesta Express.
 */
export const getPredictionById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { analysisId } = req.params;
        const analysisData = await pythonService.getAnalysisData(userId, analysisId);
        res.json({ success: true, data: analysisData });
    } catch (error) {
        if (error.message.includes('no encontrado')) {
            return handleHttpError(res, 'ANALYSIS_NOT_FOUND', error, 404);
        }
        handleHttpError(res, 'ERROR_GET_ANALYSIS', error);
    }
};

/**
 * Obtiene la lista de análisis disponibles para un usuario.
 * @param {object} req - Objeto de solicitud Express.
 * @param {object} res - Objeto de respuesta Express.
 */
export const listAnalyses = async (req, res) => {
    try {
        const userId = req.user.id;
        const analyses = await pythonService.listAnalysesForUser(userId);
        res.json({ success: true, data: analyses });
    } catch (error) {
        handleHttpError(res, 'ERROR_LIST_ANALYSES', error);
    }
};

/**
 * Procesa un nuevo archivo Excel y genera un análisis.
 * Garantiza la limpieza del archivo temporal en todos los casos.
 * @param {object} req - Objeto de solicitud Express.
 * @param {object} res - Objeto de respuesta Express.
 */
export const refreshPredictions = async (req, res) => {
    try {
        const userId = req.user.id;
        if (!req.file) {
            return handleHttpError(res, 'NO_FILE_UPLOADED', new Error('Debe proporcionar un archivo Excel.'), 400);
        }
        const { analysisName, ...params } = req.body;
        if (!analysisName) {
            return handleHttpError(res, 'MISSING_ANALYSIS_NAME', new Error('Debe proporcionar un nombre para el análisis.'), 400);
        }

        const { analysis, predictions } = await pythonService.createAnalysisFromExcel({
            userId,
            file: req.file,
            params,
            analysisName
        });

        res.status(201).json({
            success: true,
            message: 'Análisis generado exitosamente.',
            data: {
                analysis,
                productos_procesados: predictions.length,
                parameters_used: params,
            },
        });

    } catch (error) {
        handleHttpError(res, 'ERROR_REFRESH_PREDICTIONS', error);
    } finally {
        // --- BLOQUE DE LIMPIEZA GARANTIZADO ---
        // Este bloque se ejecuta SIEMPRE, tanto si el 'try' tiene éxito
        // como si falla en cualquier punto (catch) o si hay un 'return' temprano.
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
                logger.info(`Archivo temporal de entrada eliminado desde el controlador: ${req.file.path}`);
            } catch (cleanupError) {
                logger.error(`Fallo crítico al limpiar el archivo temporal ${req.file.path}:`, cleanupError);
            }
        }
    }
};

/**
 * Aplica un override de Stock de Seguridad a una proyección específica.
 * @param {object} req - Objeto de solicitud Express.
 * @param {object} res - Objeto de respuesta Express.
 */
export const applySafetyStockToProjection = async (req, res) => {
    try {
        const userId = req.user.id;
        const { analysisId, code, projectionIndex } = req.params;
        const { safetyStock } = req.body;

        const parsedIndex = parseInt(projectionIndex, 10);
        if (isNaN(parsedIndex) || parsedIndex < 0) {
            return handleHttpError(res, 'INVALID_PROJECTION_INDEX', new Error('El índice de la proyección es inválido.'), 400);
        }
        if (safetyStock === undefined || safetyStock === null || isNaN(safetyStock) || safetyStock < 0) {
            return handleHttpError(res, 'INVALID_SAFETY_STOCK', new Error('El stock de seguridad debe ser un número positivo.'), 400);
        }

        const updatedProduct = await pythonService.applySafetyStockToProjection({
            userId,
            analysisId,
            productCode: code,
            projectionIndex: parsedIndex,
            newSafetyStock: parseFloat(safetyStock)
        });

        res.json({
            success: true,
            message: `Stock de seguridad aplicado a la proyección ${parsedIndex} del producto ${code}.`,
            data: updatedProduct,
        });
    } catch (error) {
        handleHttpError(res, 'ERROR_APPLYING_SS_TO_PROJECTION', error);
    }
};

/**
 * Actualiza una alerta específica para un producto.
 * @param {object} req - Objeto de solicitud Express.
 * @param {object} res - Objeto de respuesta Express.
 */
export const updateAlert = async (req, res) => {
    try {
        const userId = req.user.id;
        const { analysisId, code, alertId } = req.params;
        const updates = req.body;

        if (!updates || (updates.unidades === undefined && updates.lead_time_especifico === undefined)) {
            return handleHttpError(res, 'INVALID_UPDATES', new Error('Debe proporcionar "unidades" o "lead_time_especifico" para actualizar.'), 400);
        }

        const updatedProduct = await pythonService.updateAlert({
            userId,
            analysisId,
            productCode: code,
            alertId,
            updates
        });

        res.json({
            success: true,
            message: `Alerta ${alertId} del producto ${code} actualizada.`,
            data: updatedProduct,
        });
    } catch (error) {
        handleHttpError(res, 'ERROR_UPDATING_ALERT', error);
    }
};

/**
 * Añade unidades en tránsito manualmente a un producto.
 * @param {object} req - Objeto de solicitud Express.
 * @param {object} res - Objeto de respuesta Express.
 */
export const addManualTransitUnits = async (req, res) => {
    try {
        const userId = req.user.id;
        const { analysisId, code } = req.params;
        const { units, expectedArrivalDate, poNumber } = req.body;

        const updatedProduct = await pythonService.addManualTransitUnits({
            userId,
            analysisId,
            productCode: code,
            units,
            expectedArrivalDate,
            poNumber
        });

        res.json({
            success: true,
            message: `Unidades en tránsito manuales añadidas al producto ${code}.`,
            data: updatedProduct,
        });
    } catch (error) {
        handleHttpError(res, 'ERROR_ADDING_MANUAL_TRANSIT', error);
    }
};