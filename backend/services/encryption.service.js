import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { PATHS } from '../config/constants.js';

// Rutas a las llaves que generamos en el paso anterior
const privateKeyPath = path.join(PATHS.CONFIG_DIR, 'private.pem');
const publicKeyPath = path.join(PATHS.CONFIG_DIR, 'public.pem');

/**
 * @class EncryptionService
 * @description Gestiona el cifrado y descifrado de peticiones.
 */
class EncryptionService {
    constructor() {
        this.privateKey = null;
        this.publicKey = null;
        this._initializeKeys();
    }

    /**
     * Carga las llaves RSA desde los archivos al iniciar el servicio.
     */
    async _initializeKeys() {
        try {
            this.privateKey = await fs.readFile(privateKeyPath, 'utf8');
            this.publicKey = await fs.readFile(publicKeyPath, 'utf8');
            logger.info('Llaves de cifrado RSA cargadas exitosamente.');
        } catch (error) {
            logger.error('FALLO CRÍTICO: No se pudieron cargar las llaves RSA. Ejecuta el script generate-keys.js', error);
            process.exit(1); // Detiene la aplicación si no hay llaves
        }
    }

    /**
     * Devuelve la llave pública en formato PEM para que el frontend la use.
     */
    getPublicKey() {
        if (!this.publicKey) throw new Error("La llave pública no está disponible.");
        return this.publicKey;
    }

    /**
     * Descifra la llave AES y el payload de una petición entrante.
     * @param {object} encryptedBody - El cuerpo cifrado: { encryptedKey, payload }
     * @returns {object} - El objeto JSON del payload descifrado.
     */
    decryptRequest(encryptedBody) {
        if (!this.privateKey) throw new Error("La llave privada no está disponible.");
        const { encryptedKey, payload } = encryptedBody;
        try {
            // 1. Descifrar la llave AES usando la llave privada RSA
            const aesKeyBase64 = this._decryptRSA(encryptedKey);
            // 2. Descifrar el payload usando la llave AES descifrada
            const decryptedBody = this._decryptAES(payload, aesKeyBase64);
            // Retornar ambos para el middleware
            return { decryptedBody, aesKey: Buffer.from(aesKeyBase64, 'base64') };
        } catch (error) {
            logger.error('Error en decryptRequest:', error);
            throw error;
        }
    }

    /**
     * Cifra un objeto JSON para ser enviado como respuesta.
     * @param {object} payloadObject - El objeto JSON a cifrar.
     * @param {Buffer} key - La llave AES (en formato Buffer) que se usó en la petición.
     * @returns {string} - El payload cifrado en Base64.
     */
    encryptResponse(payloadObject, key) {
        try {
            const plaintext = JSON.stringify(payloadObject);
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

            const encrypted = Buffer.concat([
                cipher.update(plaintext, 'utf8'),
                cipher.final()
            ]);
            const authTag = cipher.getAuthTag();

            const encryptedCombined = Buffer.concat([iv, encrypted, authTag]);
            return encryptedCombined.toString('base64');
        } catch (e) {
            logger.error('Fallo en el cifrado AES de la respuesta:', e);
            throw new Error('No se pudo cifrar la respuesta del servidor.');
        }
    }

    /**
     * Función privada para descifrar con RSA (basada en tu lógica).
     */
    _decryptRSA(encryptedKeyB64) {
        try {
            const privateKey = crypto.createPrivateKey(this.privateKey);
            const decrypted = crypto.privateDecrypt(
                {
                    key: privateKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                },
                Buffer.from(encryptedKeyB64, 'base64')
            );
            return decrypted.toString('base64');
        } catch (e) {
            logger.error('Fallo en el descifrado RSA:', e);
            throw new Error('No se pudo descifrar la llave de sesión.');
        }
    }

    /**
     * Función privada para descifrar con AES-256-GCM (basada en tu lógica).
     */
    _decryptAES(encryptedPayloadB64, aesKeyBase64) {
        try {
            const key = Buffer.from(aesKeyBase64, 'base64');
            
            if (key.length !== 32) {
                throw new Error(`Longitud de llave AES inválida: ${key.length} bytes (esperado: 32 bytes)`);
            }
            
            const encryptedBuffer = Buffer.from(encryptedPayloadB64, 'base64');
            
            const iv = encryptedBuffer.slice(0, 12);
            const authTag = encryptedBuffer.slice(-16);
            const ciphertext = encryptedBuffer.slice(12, -16);
    
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);
    
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            const decryptedJson = decrypted.toString('utf8');
            
            try {
                const parsed = JSON.parse(decryptedJson);
                return parsed;
            } catch (parseError) {
                logger.error('Error al parsear JSON:', parseError);
                throw new Error('JSON inválido después del descifrado');
            }
        } catch (e) {
            logger.error('Fallo en el descifrado AES:', e);
            throw new Error('No se pudo descifrar el payload.');
        }
    }
}

export default new EncryptionService();