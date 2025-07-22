// File: routes/predictions.routes.js
import { Router } from "express";
import multer from "multer";
import verifyToken from "../middlewares/auth.middleware.js";
import {
  listAnalyses,
  getPredictionById,
  refreshPredictions,
  applySafetyStockToProjection,
  updateAlert,
  addManualTransitUnits,
} from "../controllers/predictions.controller.js";
import { validateWith } from "../middlewares/validation.middleware.js";
import {
  refreshParamsSchema,
  safetyStockSchema,
  updateAlertSchema,
  transitUnitsSchema,
} from "../middlewares/validation.middleware.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
router.use(verifyToken);

router.get("/analyses", listAnalyses);
router.get("/:id", getPredictionById);

router.post(
  "/refresh",
  upload.single("excel"),
  validateWith(refreshParamsSchema),
  refreshPredictions
);

router.post(
  "/safety-stock",
  validateWith(safetyStockSchema),
  applySafetyStockToProjection
);

router.put("/alert", validateWith(updateAlertSchema), updateAlert);

router.post(
  "/transit-units",
  validateWith(transitUnitsSchema),
  addManualTransitUnits
);

export default router;
