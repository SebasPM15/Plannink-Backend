// File: src/app.js
import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { handleHttpError } from "./utils/errorHandler.js";
import { logger } from "./utils/logger.js";
import sequelize from "./config/db.js";

// Swagger
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const swaggerDefinition = {
  openapi: "3.0.0",
  info: {
    title: "Inventory Prediction API",
    version: "1.0.0",
    description:
      "API para predicciones de inventario, alertas, reportes y autenticación",
  },
  servers: [
    {
      url: `http://localhost:${process.env.PORT || 3500}`,
      description: "Servidor local",
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      // --- Ejemplo de schema de usuario ---
      User: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          nombre: { type: "string", example: "André Cuvi" },
          email: {
            type: "string",
            format: "email",
            example: "andre@example.com",
          },
          celular: { type: "string", example: "+593123456789" },
        },
      },
      AuthResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          message: { type: "string" },
          token: { type: "string" },
          user: { $ref: "#/components/schemas/User" },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: { type: "string" },
          message: { type: "string" },
        },
      },
      // Agrega aquí otros schemas: Prediction, Analysis, Report, ActivityLog, AlertPayload, etc.
    },
  },
  security: [{ bearerAuth: [] }],
};

const options = {
  swaggerDefinition,
  apis: ["./routes/*.js", "./controllers/*.js"],
};

const swaggerSpec = swaggerJsdoc(options);

const PORT = process.env.PORT || 3500;
const HOST = process.env.HOST || "0.0.0.0";
const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(morgan("combined", { stream: logger.stream }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Middlewares de cifrado
import { decryptionMiddleware } from "./middlewares/decryption.middleware.js";
import { encryptionMiddleware } from "./middlewares/encryption.middleware.js";
app.use(decryptionMiddleware);
app.use(encryptionMiddleware);

// DB
sequelize
  .sync({ alter: true })
  .then(() => console.log("✅ Base de datos conectada y sincronizada"))
  .catch((err) => console.error("❌ Error de conexión a la DB:", err));

// Rutas
import securityRoutes from "./routes/security.routes.js";
import authRoutes from "./routes/auth.routes.js";
import predictionsRouter from "./routes/predictions.routes.js";
import alertRoutes from "./routes/alert.routes.js";
import activityLog from "./routes/activity.routes.js";
import reportsRoutes from "./routes/reports.routes.js";

app.use("/api/security", securityRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/predictions", predictionsRouter);
app.use("/api/alertas", alertRoutes);
app.use("/api/history", activityLog);
app.use("/api/reports", reportsRoutes);

// Health
const healthResponse = async (req, res) => {
  const dbStatus = await sequelize
    .authenticate()
    .then(() => "connected")
    .catch(() => "disconnected");
  res
    .status(200)
    .json({ status: "OK", dbStatus, timestamp: new Date().toISOString() });
};
app.get("/health", healthResponse);
app.get("/api/health", healthResponse);

// Errores
app.use((req, res) =>
  handleHttpError(
    res,
    "NOT_FOUND",
    new Error(`Ruta no encontrada: ${req.originalUrl}`),
    404
  )
);
app.use((err, req, res, next) => {
  logger.error(`Error no manejado: ${err.stack}`);
  handleHttpError(res, "INTERNAL_SERVER_ERROR", err, 500);
});

app.listen(PORT, HOST, () =>
  console.log(`🚀 Servidor en http://${HOST}:${PORT}`)
);

export default app;
