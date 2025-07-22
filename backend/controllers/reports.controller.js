import Report from "../models/report.model.js";
import User from "../models/user.model.js";
import pythonService from "../services/python.service.js"; // Importante para validar el SKU
import { handleHttpError } from "../utils/errorHandler.js";
import storageService from "../services/storage.service.js";

/**
 * Obtiene los reportes del usuario. Ya no incluye el modelo Product.
 */
export const getReports = async (req, res) => {
  try {
    const userId = req.user.id;
    const reports = await Report.findAll({
      where: { userId },
      include: [{ model: User, attributes: ["id", "nombre", "email"] }], // Solo incluimos el usuario
      order: [["createdAt", "DESC"]],
    });
    return res.json({ success: true, data: reports });
  } catch (err) {
    handleHttpError(res, "GET_REPORTS_ERROR", err);
  }
};

/**
 * Crea un nuevo reporte asociado a un SKU.
 */
export const createReport = async (req, res) => {
  try {
    if (!req.file) {
      return handleHttpError(
        res,
        "NO_FILE_PROVIDED",
        new Error("No se proporcionó ningún archivo."),
        400
      );
    }

    const { productCode } = req.body;
    const userId = req.user.id;

    // La validación ahora comprueba si el SKU existe en los datos de predicción del usuario.
    const productData = await pythonService.getProductByCode(
      userId,
      productCode
    );
    if (!productData) {
      return handleHttpError(
        res,
        "PRODUCT_CODE_NOT_FOUND",
        new Error(
          `El SKU ${productCode} no se encontró en tus datos de predicción.`
        ),
        404
      );
    }

    const fileName = `reporte-${productCode.replace(
      /[\s/]/g,
      "_"
    )}-${Date.now()}.pdf`;
    const filePath = `public/${userId}/${fileName}`;

    const publicUrl = await storageService.uploadReport(
      req.file.buffer,
      filePath,
      req.file.mimetype
    );

    // Guardamos el 'productCode' directamente en la tabla de reportes.
    const report = await Report.create({
      filename: fileName,
      url: publicUrl,
      userId,
      productCode: productCode,
    });

    return res.status(201).json({ success: true, data: report });
  } catch (err) {
    handleHttpError(res, "CREATE_REPORT_ERROR", err);
  }
};

/**
 * Obtiene un reporte específico por su ID.
 */
export const getReportById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const report = await Report.findOne({
      where: { id, userId },
      include: [{ model: User, attributes: ["id", "nombre", "email"] }],
    });

    if (!report) {
      return handleHttpError(
        res,
        "REPORT_NOT_FOUND",
        new Error("Reporte no encontrado o no tienes permiso."),
        404
      );
    }

    return res.json({ success: true, data: report });
  } catch (err) {
    handleHttpError(res, "GET_REPORT_BY_ID_ERROR", err);
  }
};
