import { Router } from 'express';
import { getAnalysisHistory } from '../controllers/activityLog.controller.js'; // Importar el nuevo controlador
import verifyToken from '../middlewares/auth.middleware.js';

const router = Router();

// Aplicar autenticación a todas las rutas de este archivo
router.use(verifyToken);

// --- Ruta para obtener el historial de un análisis ---

router.get('/:analysisId', getAnalysisHistory);

export default router;