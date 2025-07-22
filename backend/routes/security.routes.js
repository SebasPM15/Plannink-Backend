import { Router } from 'express';
import encryptionService from '../services/encryption.service.js';
import { handleHttpError } from '../utils/errorHandler.js';

const router = Router();

/**
 * @route GET /api/security/public-key
 * @description Devuelve la llave pública del servidor para que los clientes puedan cifrar datos.
 */
router.get('/public-key', (req, res) => {
    try {
        const publicKey = encryptionService.getPublicKey();
        res.status(200).json({ success: true, publicKey });
    } catch (error) {
        handleHttpError(res, 'PUBLIC_KEY_UNAVAILABLE', error, 503);
    }
});

export default router;