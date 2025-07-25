// decrypt-tool.js
// Herramienta para descifrar manualmente una respuesta del servidor.
import crypto from 'crypto';

// --- CONFIGURACIÓN ---
// 1. Pega aquí el string cifrado que recibiste del servidor.
//    (Es el valor del campo "data" en la respuesta JSON).
const encryptedDataFromServer = 'fXZxn16lwLwzlxyDGw4M/95V+4aGj3jr9kDyQQ7m7iRYBwayE1QnSgeuseersFajGsSZe+XCq98fe4iikSjgo/A75NJ08YtJHFbfFniaaQRLn7chj90CzLTm86/9bO7gkXbN+X/1qP8KEqE3lhw4tV8KRab6sN/7zy6Mml90jlWOA0IcbCvwdvkl6hJroA9llgh2EeYZrcAYp2hciG9fwaG4GbvsVFHSiYo+PKvsjBTyKXb2Cpj+le8Mb62SyG5cK83xK/NF5fe7ugz+enuhVPQXAqPXhjASlKsAkUo6PmbCWHxPmdS1Aj2vsYjH4+An+DbFdDe+W9QfsrJW19iP6SQkmnr20a2yboQE1nsn3eWtmchhhB9KYFXEkYJtNuDTV3cio0/w2EsOHfqvkDdQiul7vFkEXbPqNWN/bOSI5G9asFTa4eOAno9XgyRqe5Z3C47VfhCZjHZHtY+CAD6iDKSL1ItMnxR0XICYb9t6L9fgibNMyWutk/jHLqclpNyLcl7kLUALZrL5xArpdCYiK82T4RYwc9yWuLLN6C4rI6brT/5jxG3/nMFTDKV6RsHYWsj0ciUrA9hGmr8UleEfgVvt9Ord0tNPiBm545hlsHMAerfbRjbxgLsqUEwCoVU+uF1uLI7CuHr4i7YWT6xXyBHD7J9DEPTy0+jkIFgWurviCdwMFtaoQ0DPJT7YwDNZ0SH21jn/UkOECsALdLVhdfIo3nXl+Qu7dtHK7LHlhtPR7v6eCS1NQyZ8hmzEqf2gzNfbqyleDId7Y1u+ZmqCkJV1clwjL0b08RyR+wIFGdsoDJVH0EOgKWa1uxqandVjuzcQ7SyATWz6BIN4QY+UnnNCXx1Gf36HGLt5EfW7uTHij4IWaU7GYPYRFDpq1crdnbK/XJUIW8DGnvMvatpS2dH9QxhVlcrKSdZsjN/Ur20IcprZIAWqSFJiw/xznvXp9yGpYaTEtmclQWqMUGG2vMPVletIFIlKncUPSftyZMtq7gCOeFN7QlAliIPANakyHXoFXFJo9bYopytTk6Hi4sR6SWGEvEM7KgnFcHIM3iTDSvwnzq74TNMhLKXe51/xMOY3Ftfp3mVizhOGdr9yvWlI7z97yrk1nkMI+X9YVz6zsRAPPZmEf8i53QAqZKsXhlnl8HF+pS1sOQlBx8QGZZ1RslBWActhPDJWSOT5ljxNSs9Er6W9RQ8X8ATQv5s5oN7Osf/BdqLNSkn9H+wl2w5WfTR/G6+eF62dzVTYYQ==';

// 2. Pega aquí la llave AES en Base64 que te dio el script 'generate-get-key.js'.
//    (Es la llave que el script te dijo que guardaras para descifrar).
const sessionAesKeyBase64 = 'J3SpiTKCeGe610fxPbmjvLZTxF3VjMu5+PL8VXQYfHU=';
// --- FIN DE LA CONFIGURACIÓN ---

/**
 * Descifra un payload cifrado con AES-256-GCM.
 * @param {string} encryptedPayloadB64 - El payload cifrado en Base64.
 * @param {string} aesKeyBase64 - La llave AES en Base64 que se usó en la petición.
 * @returns {object} - El objeto JSON descifrado.
 */
function decryptWithAES(encryptedPayloadB64, aesKeyBase64) {
    try {
        const key = Buffer.from(aesKeyBase64, 'base64');
        if (key.length !== 32) {
            throw new Error(`Longitud de llave AES inválida: ${key.length} bytes (esperado: 32)`);
        }

        const encryptedBuffer = Buffer.from(encryptedPayloadB64, 'base64');

        // Extraer las partes del payload combinado (IV, AuthTag, Ciphertext)
        const iv = encryptedBuffer.slice(0, 12);
        const authTag = encryptedBuffer.slice(-16);
        const ciphertext = encryptedBuffer.slice(12, -16);

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const decryptedJsonString = decrypted.toString('utf8');

        return JSON.parse(decryptedJsonString);
    } catch (error) {
        console.error("Fallo en el descifrado AES. Verifica que la llave y los datos sean correctos.");
        throw error;
    }
}

function main() {
    console.log('--- Herramienta de Descifrado de Respuesta ---');

    if (encryptedDataFromServer.startsWith('PEGA_AQUI') || sessionAesKeyBase64.startsWith('PEGA_AQUI')) {
        console.error('\n❌ ¡Acción requerida!');
        console.error('   Debes editar este archivo y rellenar las variables `encryptedDataFromServer` y `sessionAesKeyBase64`.\n');
        process.exit(1);
    }

    try {
        console.log("\n1. Descifrando la data recibida...");
        const decryptedData = decryptWithAES(encryptedDataFromServer, sessionAesKeyBase64);
        console.log("   ✅ ¡Data descifrada exitosamente!");

        console.log("\n--- RESULTADO FINAL (Datos en texto plano) ---");
        console.log("----------------------------------------------------------");
        console.log(JSON.stringify(decryptedData, null, 2));
        console.log("----------------------------------------------------------\n");

    } catch (error) {
        console.error("\n❌ Error durante el proceso de descifrado.");
        process.exit(1);
    }
}

main();
