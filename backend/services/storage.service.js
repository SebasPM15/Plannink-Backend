import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    logger.error("Las variables de entorno de Supabase (URL y SERVICE_KEY) no están definidas.");
    throw new Error("Configuración de Storage incompleta.");
}

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
);

class StorageService {
    /**
     * Sube un archivo a un bucket específico en Supabase.
     * @param {string} bucketName - El nombre del bucket.
     * @param {string} filePath - La ruta completa del archivo dentro del bucket.
     * @param {Buffer} fileBuffer - El contenido del archivo en formato buffer.
     * @param {string} contentType - El tipo MIME del archivo.
     * @param {object} options - Opciones adicionales.
     * @param {boolean} [options.overwrite=false] - Si se debe sobrescribir el archivo.
     * @param {string|null} [options.contentEncoding=null] - La codificación del contenido (ej. 'gzip').
     * @returns {Promise<string>} - La URL pública del archivo subido.
     */
    async uploadFile(bucketName, filePath, fileBuffer, contentType, options = {}) {
        const { overwrite = false, contentEncoding = null } = options;

        try {
            const uploadOptions = {
                contentType,
                upsert: overwrite, // 'upsert' es el término de Supabase para 'overwrite'
            };

            // Añadir contentEncoding solo si se proporciona
            if (contentEncoding) {
                uploadOptions.contentEncoding = contentEncoding;
            }

            const { data, error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(filePath, fileBuffer, uploadOptions);

            if (uploadError) {
                throw uploadError;
            }

            const { data: { publicUrl } } = supabase.storage
                .from(bucketName)
                .getPublicUrl(data.path);

            logger.info(`Archivo subido a ${bucketName}: ${publicUrl}`);
            return publicUrl;

        } catch (error) {
            logger.error(`Error al subir a Supabase bucket '${bucketName}':`, error.message);
            throw new Error("Fallo al subir el archivo al almacenamiento.");
        }
    }

    // --- MÉTODO AÑADIDO ---
    /**
     * Sube un archivo de reporte (PDF, etc.) al bucket 'reports'.
     * @param {Buffer} fileBuffer - El contenido del archivo en formato buffer.
     * @param {string} filePath - La ruta completa del archivo dentro del bucket.
     * @param {string} contentType - El tipo MIME del archivo.
     * @returns {Promise<string>} - La URL pública del archivo subido.
     */
    async uploadReport(fileBuffer, filePath, contentType) {
        // Llama al método genérico 'uploadFile' con el nombre del bucket ya definido.
        return this.uploadFile('reports', filePath, fileBuffer, contentType);
    }
}

export default new StorageService();