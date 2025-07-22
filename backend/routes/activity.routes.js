// File: routes/activity.routes.js
import { Router } from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { getAnalysisHistory } from "../controllers/activityLog.controller.js";

const router = Router();
router.use(verifyToken);

/**
 * @swagger
 * /api/history/{analysisId}:
 *   get:
 *     tags: [ActivityLog]
 */
router.get("/:analysisId", getAnalysisHistory);

export default router;
