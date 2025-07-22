// File: controllers/reports.controller.js
import ReportService from "../routes/reports.routes.js";
import { handleHttpError } from "../utils/errorHandler.js";

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Gestión de reportes PDF
 */

/**
 * @swagger
 * /api/reports:
 *   get:
 *     summary: Lista todos los reportes
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Listado de reportes
 */
export const getReports = async (req, res) => {
  try {
    const data = await ReportService.list(req.user.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    handleHttpError(res, "GET_REPORTS_ERROR", err, err.status || 500);
  }
};

/**
 * @swagger
 * /api/reports:
 *   post:
 *     summary: Sube un nuevo reporte PDF
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [reportFile,productCode]
 *             properties:
 *               reportFile: { type: string, format: binary }
 *               productCode: { type: string }
 *     responses:
 *       201:
 *         description: Reporte creado
 */
export const createReport = async (req, res) => {
  try {
    const report = await ReportService.create(
      req.body.productCode,
      req.file,
      req.user.id
    );
    res.status(201).json({ success: true, data: report });
  } catch (err) {
    handleHttpError(res, "CREATE_REPORT_ERROR", err, err.status || 400);
  }
};

/**
 * @swagger
 * /api/reports/{id}:
 *   get:
 *     summary: Descarga un reporte por ID
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema: { type: integer }
 *         required: true
 *     responses:
 *       200:
 *         description: PDF
 */
export const getReportById = async (req, res) => {
  try {
    const stream = await ReportService.getById(req.params.id, req.user.id);
    res.setHeader("Content-Type", "application/pdf");
    stream.pipe(res);
  } catch (err) {
    handleHttpError(res, "GET_REPORT_ERROR", err, err.status || 404);
  }
};
