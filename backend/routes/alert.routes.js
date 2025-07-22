import express from 'express';
import { evaluarAlertaYNotificar } from '../controllers/alert.controller.js';

// --- Middlewares de Seguridad y Validación ---
import verifyToken from '../middlewares/auth.middleware.js';
import { validateSendAlert } from '../middlewares/alert.validation.js'; // Importamos el validador específico

const router = express.Router();

// La ruta para enviar alertas ahora requiere un token válido y que el body sea correcto.
router.post(
    '/stock', 
    verifyToken,          // 1. Asegura que el usuario esté autenticado.
    validateSendAlert,    // 2. Valida la estructura del `req.body`.
    evaluarAlertaYNotificar // 3. Solo si todo lo anterior pasa, se ejecuta el controlador.
);

export default router;
