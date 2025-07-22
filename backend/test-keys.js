// test-keys.js
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicKey = fs.readFileSync(path.join(__dirname, 'config', 'public.pem'), 'utf8');
const privateKey = fs.readFileSync(path.join(__dirname, 'config', 'private.pem'), 'utf8');

const testData = Buffer.from('Test message');

try {
    // Cifrar con la clave pública
    const encrypted = crypto.publicEncrypt(
        {
            key: publicKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256'
        },
        testData
    );
    console.log('Cifrado:', encrypted.toString('base64'));

    // Descifrar con la clave privada
    const decrypted = crypto.privateDecrypt(
        {
            key: privateKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256'
        },
        encrypted
    );
    console.log('Descifrado:', decrypted.toString('utf8'));
} catch (e) {
    console.error('Error en prueba de claves:', e);
}