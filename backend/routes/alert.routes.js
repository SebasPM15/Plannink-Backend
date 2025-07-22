// File: routes/alert.routes.js
import { Router } from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { evaluarAlertaYNotificar } from "../controllers/alert.controller.js";
import { validateSendAlert } from "../middlewares/alert.validation.js";

const router = Router();

/**
 * @swagger
 * /api/alertas/stock:
 *   post:
 *     tags: [Alerts]
 */
router.post("/stock", verifyToken, validateSendAlert, evaluarAlertaYNotificar);

export default router;
