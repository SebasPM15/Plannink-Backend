// File: src/routes/security.routes.js
import { Router } from "express";
import encryptionService from "../services/encryption.service.js";
import { handleHttpError } from "../utils/errorHandler.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Security
 *   description: Endpoints de seguridad (cryptografía)
 */

/**
 * @swagger
 * /api/security/public-key:
 *   get:
 *     summary: Devuelve la llave pública del servidor
 *     tags: [Security]
 *     responses:
 *       200:
 *         description: Llave pública obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 publicKey:
 *                   type: string
 *                   example: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...\n-----END PUBLIC KEY-----"
 *       503:
 *         description: Servicio no disponible para obtener la llave pública
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/public-key", (req, res) => {
  try {
    const publicKey = encryptionService.getPublicKey();
    res.status(200).json({ success: true, publicKey });
  } catch (error) {
    handleHttpError(res, "PUBLIC_KEY_UNAVAILABLE", error, 503);
  }
});

export default router;
