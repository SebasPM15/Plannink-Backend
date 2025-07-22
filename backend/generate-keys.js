// generate-keys.js
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Obtener __dirname en módulos ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateKeys() {
    console.log("Generando nuevo par de llaves RSA de 2048 bits...");

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const configPath = path.join(__dirname, 'src', 'config');

    // Asegúrate de que la carpeta exista
    fs.mkdirSync(configPath, { recursive: true });

    fs.writeFileSync(path.join(configPath, 'public.pem'), publicKey);
    fs.writeFileSync(path.join(configPath, 'private.pem'), privateKey);

    console.log("✅ Llaves generadas y guardadas en 'src/config/'");
    console.log("IMPORTANTE: Añade 'private.pem' a tu archivo .gitignore para no subirlo al repositorio.");
}

generateKeys();
