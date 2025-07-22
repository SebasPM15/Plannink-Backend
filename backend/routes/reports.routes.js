import { Router } from 'express';
import multer from 'multer';
import { getReports, createReport, getReportById } from '../controllers/reports.controller.js';
import verifyToken from '../middlewares/auth.middleware.js';
import { validateCreateReport } from '../middlewares/reports.validation.js'; // Importar el validador actualizado

const router = Router();

// Configuración de Multer para manejar el archivo en memoria
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Aplicar autenticación a todas las rutas de este archivo
router.use(verifyToken);

// --- Rutas ---
router.get('/', getReports);
router.get('/:id', getReportById);

// La ruta POST ahora usa el nuevo validador que espera 'productCode'.
router.post(
    '/',
    upload.single('reportFile'),
    validateCreateReport, // <-- Usando el middleware actualizado
    createReport
);

export default router;