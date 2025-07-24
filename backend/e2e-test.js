// e2e-test.js
// Script de prueba de extremo a extremo para el flujo de cifrado completo.
// Muestra la data cifrada (como la recibe el frontend) y luego la descifra.
import crypto from 'crypto';
import axios from 'axios';

// --- CONFIGURACIÓN ---
const API_BASE_URL = 'http://localhost:3500/api';

// Cambia estas credenciales por las de un usuario de prueba válido en tu DB.
const USER_CREDENTIALS = {
    email: "sebasdelpm@gmail.com",
    password: "SebasPm15"
};

// Cambia esta ruta por una de tus rutas GET que esté protegida por token.
const PROTECTED_GET_ROUTE = '/api/predictions/analyses';
// --- FIN DE LA CONFIGURACIÓN ---


// --- FUNCIONES CRIPTOGRÁFICAS AUXILIARES ---

/** Cifra un Buffer usando la llave pública RSA del servidor. */
function encryptWithRSA(plaintextBuffer, publicKeyPem) {
    return crypto.publicEncrypt({
        key: publicKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    }, plaintextBuffer).toString('base64');
}

/** Cifra un objeto JSON usando una llave AES. */
function encryptWithAES(payloadObject, key) {
    const plaintext = JSON.stringify(payloadObject);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

/** Descifra un payload cifrado con AES. */
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


// --- LÓGICA PRINCIPAL DE LA PRUEBA ---

async function runTest() {
    console.log("🚀 Iniciando prueba de cifrado de extremo a extremo...");
    let authToken = null;

    try {
        // --- ETAPA 1: OBTENER LLAVE PÚBLICA ---
        console.log("\n[ETAPA 1/5] Obteniendo llave pública del servidor...");
        const publicKeyResponse = await axios.get(`${API_BASE_URL}/security/public-key`);
        const publicKeyPem = publicKeyResponse.data.publicKey;
        if (!publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')) {
            throw new Error('La llave pública recibida no tiene el formato PEM esperado.');
        }
        console.log("  ✅ Llave pública obtenida.");

        // --- ETAPA 2: PRUEBA DE LOGIN (POST) ---
        console.log("\n[ETAPA 2/5] Cifrando y enviando petición de login...");
        const loginAesKey = crypto.randomBytes(32);
        const loginRequestBody = {
            encryptedKey: encryptWithRSA(loginAesKey, publicKeyPem),
            payload: encryptWithAES(USER_CREDENTIALS, loginAesKey)
        };
        const loginResponse = await axios.post(`${API_BASE_URL}/auth/login`, loginRequestBody);
        if (!loginResponse.data.data) throw new Error("La respuesta del login no vino cifrada.");
        console.log("  ✅ Respuesta cifrada de login recibida.");

        // --- ETAPA 3: DESCIFRAR RESPUESTA DE LOGIN ---
        console.log("\n[ETAPA 3/5] Descifrando la respuesta del login...");
        const decryptedLoginResponse = decryptWithAES(loginResponse.data.data, loginAesKey);
        authToken = decryptedLoginResponse.token;
        if (!authToken) throw new Error("No se encontró un token en la respuesta de login descifrada.");
        console.log("  ✅ Respuesta de login descifrada exitosamente. Token obtenido.");
        console.log("     (Mostrando solo una parte del token):", authToken.substring(0, 30) + '...');

        // --- ETAPA 4: PRUEBA DE RUTA PROTEGIDA (GET) ---
        console.log(`\n[ETAPA 4/5] Cifrando y enviando petición a ruta GET protegida (${PROTECTED_GET_ROUTE})...`);
        const getAesKey = crypto.randomBytes(32);
        const encryptedGetAesKey = encryptWithRSA(getAesKey, publicKeyPem);

        const getResponse = await axios.get(`${API_BASE_URL}${PROTECTED_GET_ROUTE.replace('/api', '')}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'X-Encrypted-Key': encryptedGetAesKey
            }
        });
        if (!getResponse.data.data) throw new Error("La respuesta del GET protegido no vino cifrada.");
        
        // --- [NUEVO] MOSTRANDO LA RESPUESTA CIFRADA ---
        console.log("\n  ✅ Respuesta CIFRADA recibida (así la ve Postman o el Frontend):");
        console.log("----------------------------------------------------------");
        console.log(JSON.stringify(getResponse.data, null, 2));
        console.log("----------------------------------------------------------");


        // --- ETAPA 5: DESCIFRAR RESPUESTA GET ---
        console.log("\n[ETAPA 5/5] Descifrando la respuesta de la ruta GET...");
        const decryptedGetResponse = decryptWithAES(getResponse.data.data, getAesKey);
        console.log("  ✅ ¡Respuesta GET descifrada exitosamente!");
        
        // --- [NUEVO] MOSTRANDO LA RESPUESTA DESCIFRADA ---
        console.log("\n--- RESULTADO FINAL (Datos descifrados, listos para usar en la UI) ---");
        console.log(JSON.stringify(decryptedGetResponse, null, 2));

        console.log("\n\n🎉 ¡Prueba completada exitosamente!");

    } catch (error) {
        console.error("\n❌ OCURRIÓ UN ERROR DURANTE LA PRUEBA ❌");
        if (error.response) {
            console.error(`  - Status: ${error.response.status}`);
            console.error("  - Data:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("  - Mensaje:", error.message);
        }
        process.exit(1);
    }
}

runTest();
