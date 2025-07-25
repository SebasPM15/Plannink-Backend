// generate-get-key.js
// Este script genera los valores necesarios para probar una ruta GET segura en Postman.
import crypto from 'crypto';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:3500/api';

async function generateKeyForPostman() {
    try {
        console.log("1. Obteniendo la llave pública del servidor...");
        const response = await axios.get(`${API_BASE_URL}/security/public-key`);
        const publicKeyPem = response.data.publicKey;
        console.log("   ✅ Llave pública obtenida.");

        console.log("\n2. Generando y cifrando la llave de sesión AES...");
        // Generar una nueva llave AES para la sesión
        const aesKey = crypto.randomBytes(32);

        // Cifrar la llave AES con la llave pública del servidor
        const encryptedKeyForHeader = crypto.publicEncrypt({
            key: publicKeyPem,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        }, aesKey).toString('base64');
        console.log("   ✅ Llave de sesión cifrada.");

        console.log("\n--- VALORES PARA POSTMAN ---");
        console.log("\n📋 Copia este valor para el header 'X-Encrypted-Key':");
        console.log("----------------------------------------------------------");
        console.log(encryptedKeyForHeader);
        console.log("----------------------------------------------------------");

        console.log("\n🔑 Guarda esta llave AES para descifrar la respuesta manualmente:");
        console.log("----------------------------------------------------------");
        console.log(aesKey.toString('base64'));
        console.log("----------------------------------------------------------\n");

    } catch (error) {
        console.error("\n❌ Error al generar la llave para Postman:");
        if (error.response) {
            console.error(`   - Status: ${error.response.status}`);
            console.error("   - Data:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("   - Mensaje:", error.message);
        }
    }
}

generateKeyForPostman();
