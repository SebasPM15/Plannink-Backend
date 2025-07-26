import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { handleHttpError } from "./utils/errorHandler.js";
import { logger } from "./utils/logger.js";
import sequelize from "./config/db.js";

import verifyToken from "./middlewares/auth.middleware.js";
import { decryptionMiddleware } from "./middlewares/decryption.middleware.js";
import { encryptionMiddleware } from "./middlewares/encryption.middleware.js";

import securityRoutes from "./routes/security.routes.js";
import authRoutes from "./routes/auth.routes.js"; // login, logout
import predictionsRouter from "./routes/predictions.routes.js";
import alertRoutes from "./routes/alert.routes.js";
import activityLog from "./routes/activity.routes.js";

import { swaggerMiddleware, swaggerUiSetup } from "./config/swagger.js";

const app = express();
const PORT = process.env.PORT || 3500;
const HOST = process.env.HOST || "0.0.0.0";

// 1. Seguridad esencial
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ],
  })
);

// 2. Logging y parsing
app.use(morgan("combined", { stream: logger.stream }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// 3. Documentación
app.use("/api-docs", swaggerMiddleware, swaggerUiSetup);

// 4. Conectar y sincronizar BD
sequelize
  .sync({ alter: true })
  .then(() => console.log("✅ Base de datos conectada y sincronizada"))
  .catch((err) => console.error("❌ Error de conexión a la DB:", err));

// 5. RUTAS PÚBLICAS
app.use("/api/security", securityRoutes);
app.use("/api/auth", authRoutes); // aquí van login y logout SIN decrypt/encrypt

// 6. RUTAS PROTEGIDAS (token + cifrado)
//    – rate limit, verifyToken, decrypt incoming, encrypt outgoing
const protectedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    handleHttpError(
      res,
      "TOO_MANY_REQUESTS",
      new Error("Límite de solicitudes excedido"),
      429
    ),
});

app.use(
  "/api/predictions",
  protectedLimiter,
  verifyToken,
  decryptionMiddleware,
  encryptionMiddleware,
  predictionsRouter
);

app.use(
  "/api/alertas",
  protectedLimiter,
  verifyToken,
  decryptionMiddleware,
  encryptionMiddleware,
  alertRoutes
);

app.use(
  "/api/history",
  protectedLimiter,
  verifyToken,
  decryptionMiddleware,
  encryptionMiddleware,
  activityLog
);

// 7. Health check (igual que en tu primer app.js)
const healthResponse = (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Inventory Prediction API",
    version: process.env.npm_package_version,
    environment: process.env.NODE_ENV || "development",
    port: PORT,
  });
};
app.get("/health", healthResponse);
app.get("/api/health", healthResponse);

// 8. Manejo de errores al final
app.use((req, res) => {
  handleHttpError(
    res,
    "NOT_FOUND",
    new Error(`Ruta no encontrada: ${req.originalUrl}`),
    404
  );
});
app.use((err, req, res, next) => {
  logger.error(`Error no manejado: ${err.stack}`);
  handleHttpError(res, "INTERNAL_SERVER_ERROR", err, 500);
});

// 9. Arrancar servidor
app.listen(PORT, HOST, () => {
  console.log(`🚀 Servidor corriendo en http://${HOST}:${PORT}`);
});

export default app;
