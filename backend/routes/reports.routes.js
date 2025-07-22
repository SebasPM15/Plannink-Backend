// File: routes/reports.routes.js
import { Router } from "express";
import multer from "multer";
import verifyToken from "../middlewares/auth.middleware.js";
import {
  getReports,
  createReport,
  getReportById,
} from "../controllers/reports.controller.js";
import { validateCreateReport } from "../middlewares/reports.validation.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
router.use(verifyToken);

router.get("/", getReports);

router.post(
  "/",
  upload.single("reportFile"),
  validateCreateReport,
  createReport
);

router.get("/:id", getReportById);

export default router;
