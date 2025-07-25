// test-encryption.js
import crypto from 'crypto';
import axios from 'axios';

const API_BASE_URL = 'http://127.0.0.1:3500/api';
const USER_CREDENTIALS = {
    email: "andyjapon.ios@gmail.com", // <-- CAMBIA ESTO
    password: "andy123456" // <-- CAMBIA ESTO
};

function encryptWithRSA(plaintextBuffer, publicKeyPem) {
    const publicKey = crypto.createPublicKey(publicKeyPem);
    // --- ¡CORRECCIÓN CLAVE! ---
    // Se elimina 'oaepHash' para que coincida con el backend.
    const encrypted = crypto.publicEncrypt({
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
    }, plaintextBuffer);
    return encrypted.toString('base64');
}

function encryptWithAES(payloadObject, key) {
    const plaintext = JSON.stringify(payloadObject);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

function decryptWithAES(encryptedPayloadB64, key) {
    const encryptedBuffer = Buffer.from(encryptedPayloadB64, 'base64');
    const iv = encryptedBuffer.slice(0, 12);
    const authTag = encryptedBuffer.slice(-16);
    const ciphertext = encryptedBuffer.slice(12, -16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
}

async function runTest() {
    console.log("🚀 Iniciando prueba de cifrado de extremo a extremo...");
    try {
        console.log("\n1. Obteniendo llave pública del servidor...");
        const publicKeyResponse = await axios.get(`${API_BASE_URL}/security/public-key`);
        const publicKeyPem = publicKeyResponse.data.publicKey;
        console.log("   ✅ Llave pública obtenida.");

        console.log("\n2. Cifrando la petición de login...");
        const aesKey = crypto.randomBytes(32);
        const encryptedKey = encryptWithRSA(aesKey, publicKeyPem);
        const encryptedPayload = encryptWithAES(USER_CREDENTIALS, aesKey);
        const requestBody = { encryptedKey, payload: encryptedPayload };
        console.log("   ✅ Petición cifrada.");

        console.log("\n3. Enviando petición cifrada a /api/auth/login...");
        const loginResponse = await axios.post(`${API_BASE_URL}/auth/login`, requestBody);
        if (!loginResponse.data.data) throw new Error("La respuesta no vino cifrada.");
        console.log("   ✅ Respuesta cifrada recibida.");

        console.log("\n4. Descifrando la respuesta del servidor...");
        const decryptedResponse = decryptWithAES(loginResponse.data.data, aesKey);
        console.log("   ✅ ¡Respuesta descifrada exitosamente!");
        console.log("\n--- RESULTADO FINAL ---");
        console.log(JSON.stringify(decryptedResponse, null, 2));
        console.log("\n🎉 ¡Prueba completada exitosamente!");
    } catch (error) {
        console.error("\n❌ OCURRIÓ UN ERROR DURANTE LA PRUEBA ❌");
        if (error.response) {
            console.error("   - Status:", error.response.status, "\n   - Data:", error.response.data);
        } else {
            console.error("   - Mensaje:", error.message);
        }
    }
}

runTest();