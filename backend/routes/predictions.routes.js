import { Router } from 'express';
import {
    getPredictions,
    getPredictionById,
    listAnalyses,
    refreshPredictions,
    applySafetyStockToProjection,
    updateAlert,
    addManualTransitUnits
} from '../controllers/predictions.controller.js';
import verifyToken from '../middlewares/auth.middleware.js';
import { uploadMiddleware } from '../middlewares/upload.middleware.js';
import { validateWith } from '../middlewares/validation.middleware.js';
import {
    refreshParamsSchema,
    safetyStockSchema,
    updateAlertSchema,
    transitUnitsSchema
} from '../middlewares/validation.middleware.js';

const router = Router();

// Aplicar autenticación a todas las rutas
router.use(verifyToken);

/*
 * RUTAS DE LECTURA (GET)
 */
// Lista todos los análisis del usuario
router.get('/analyses', listAnalyses);

// Obtiene los datos de un análisis específico
router.get('/analyses/:analysisId', getPredictionById);

// Mantiene compatibilidad con el endpoint anterior (lista análisis)
router.get('/', getPredictions);

/*
 * RUTA DE GENERACIÓN (POST)
 */
router.post(
    '/refresh',
    uploadMiddleware.single('excel'),
    validateWith(refreshParamsSchema),
    refreshPredictions
);

/*
 * RUTAS DE OVERRIDE GRANULAR (POST/PATCH)
 */
router.post(
    '/:analysisId/:code/projections/:projectionIndex/safety-stock',
    validateWith(safetyStockSchema),
    applySafetyStockToProjection
);

router.patch(
    '/:analysisId/:code/alerts/:alertId',
    validateWith(updateAlertSchema),
    updateAlert
);

router.post(
    '/:analysisId/:code/transit-units',
    validateWith(transitUnitsSchema),
    addManualTransitUnits
);

export default router;