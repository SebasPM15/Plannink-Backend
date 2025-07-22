import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import pako from "pako";
import pkg from "jstat";
import { PATHS } from "../config/constants.js";
import { logger } from "../utils/logger.js";
import storageService from "./storage.service.js";
import Analysis from "../models/analysis.model.js";
import activityLogService from "./activityLog.service.js"; // ¡Importante!

const { jStat } = pkg;

/**
 * @class PythonService
 * @description Orquesta la ejecución de análisis, su almacenamiento en la nube y la manipulación de datos.
 */
class PythonService {
    constructor() {
        this.scriptPath = path.join(PATHS.AI_MODEL_DIR, "src/predict.py");
        this.pythonOutputPath = path.join(
            PATHS.AI_MODEL_DIR,
            "data",
            "predicciones_completas.min.json"
        );
        this.timeout = 300000; // 5 minutos
        this.defaultLeadTimeDays = 20;
        this.defaultDiasConsumoMensual = 22;
    }

    // --- METODOS PUBLICOS PRINCIPALES ---

    /**
     * Procesa un nuevo archivo Excel, comprime el resultado, lo sube a Supabase y crea un registro en la DB.
     * @param {object} options - Opciones para la creación del análisis.
     * @param {number} options.userId - ID del usuario autenticado.
     * @param {object} options.file - Objeto del archivo de multer.
     * @param {object} options.params - Parametros de la simulación.
     * @param {string} options.analysisName - Nombre descriptivo para el análisis.
     * @returns {Promise<object>} - El nuevo objeto de análisis y sus predicciones.
     */
    async createAnalysisFromExcel({ userId, file, params, analysisName }) {
        try {
            logger.info(
                `Iniciando nuevo análisis '${analysisName}' para usuario ${userId}`
            );
            await this.runScript(file.path, params);

            const predictionsBuffer = await fs.readFile(this.pythonOutputPath);
            const compressedData = pako.gzip(predictionsBuffer);
            logger.info(
                `JSON comprimido. Tamaño original: ${predictionsBuffer.length}, comprimido: ${compressedData.length}`
            );

            const storagePath = `public/${userId}/${analysisName.replace(
                /\s/g,
                "_"
            )}-${Date.now()}.json.gz`;
            const publicUrl = await storageService.uploadFile(
                "analyses",
                storagePath,
                compressedData,
                "application/json",
                { contentEncoding: "gzip" }
            );

            const newAnalysis = await Analysis.create({
                name: analysisName,
                originalFileName: file.originalname,
                storagePath: storagePath,
                url: publicUrl,
                userId: userId,
            });

            // Registrar la actividad de creación
            await activityLogService.createLog({
                userId,
                analysisId: newAnalysis.id,
                actionType: 'CREACION_ANALISIS',
                description: `Se creó el análisis "${analysisName}" desde el archivo "${file.originalname}".`,
                details: { params }
            });

            logger.info(
                `Nuevo análisis #${newAnalysis.id} creado para el usuario ${userId}`
            );
            return {
                analysis: newAnalysis,
                predictions: JSON.parse(predictionsBuffer.toString("utf-8")),
            };
        } catch (error) {
            logger.error(
                `Error procesando nuevo Excel para usuario ${userId}: ${error.message}`
            );
            throw error;
        } finally {
            await this.cleanTempFiles(file.path);
        }
    }

    /**
     * Obtiene la lista de todos los análisis guardados de un usuario.
     * @param {number} userId - ID del usuario autenticado.
     * @returns {Promise<Array>} - Lista de análisis del usuario.
     */
    async listAnalysesForUser(userId) {
        return Analysis.findAll({
            where: { userId },
            order: [["createdAt", "DESC"]],
            attributes: [
                "id",
                "name",
                "originalFileName",
                "url",
                "createdAt",
                "updatedAt",
            ],
        });
    }

    /**
     * Obtiene y descomprime los datos de un análisis específico desde Supabase.
     * @param {number} userId - ID del usuario autenticado.
     * @param {number} analysisId - ID del análisis.
     * @returns {Promise<object>} - Datos descomprimidos del análisis.
     */
    async getAnalysisData(userId, analysisId) {
        const analysis = await Analysis.findOne({
            where: { id: analysisId, userId },
        });
        if (!analysis)
            throw new Error("Análisis no encontrado o no pertenece al usuario.");

        logger.info(`Descargando datos para el análisis #${analysisId}`);
        const response = await fetch(analysis.url);
        if (!response.ok)
            throw new Error(
                `No se pudo descargar el archivo de análisis. Status: ${response.status}`
            );

        const compressedBuffer = await response.arrayBuffer();
        const decompressedData = pako.ungzip(new Uint8Array(compressedBuffer));
        const jsonData = JSON.parse(new TextDecoder("utf-8").decode(decompressedData));

        // --- ¡NUEVA LÓGICA DE REGISTRO DE ACCESO! ---
        // Se registra que el usuario accedió a este análisis.
        // Esta es una llamada "fire and forget": no usamos 'await' para no retrasar
        // la respuesta al usuario. La prioridad es entregar los datos rápidamente.
        activityLogService.createLog({
            userId,
            analysisId,
            actionType: 'ACCESS_ANALYSIS',
            description: `Se consultaron los datos del análisis: "${analysis.name}".`
        }).catch(err => {
            // Si el logging falla, solo lo registramos en los logs del servidor
            // pero no detenemos la operación principal.
            logger.error(`Fallo al crear el log de acceso para el análisis #${analysisId}:`, err);
        });
        // --- FIN DE LA NUEVA LÓGICA ---
        return jsonData;
    }

    // --- METODOS DE GESTION DE OVERRIDES ---

    /**
     * Aplica un override de Stock de Seguridad a un producto dentro de un análisis específico.
     * @param {object} params - Parametros para el override.
     * @param {number} params.userId - ID del usuario.
     * @param {number} params.analysisId - ID del análisis.
     * @param {string} params.productCode - Código del producto.
     * @param {number} params.projectionIndex - Índice de la proyección.
     * @param {number} params.newSafetyStock - Nuevo valor de stock de seguridad.
     * @returns {Promise<object>} - Producto actualizado.
     */
    async applySafetyStockToProjection({
        userId,
        analysisId,
        productCode,
        projectionIndex,
        newSafetyStock,
    }) {
        if (
            newSafetyStock === undefined ||
            newSafetyStock === null ||
            isNaN(newSafetyStock) ||
            newSafetyStock < 0
        ) {
            throw new Error("El stock de seguridad debe ser un número positivo.");
        }

        // 1. Obtener datos y capturar el valor antiguo
        const predictions = await this.getAnalysisData(userId, analysisId);
        const productIndex = this._findProductIndex(predictions, productCode);
        if (productIndex === -1) throw new Error(`Producto ${productCode} no encontrado.`);

        const productBeforeUpdate = predictions[productIndex];
        const projectionMonthKey = productBeforeUpdate.PROYECCIONES[projectionIndex]?.mes;
        if (!projectionMonthKey) throw new Error("Índice de proyección inválido.");

        const previousValue = this._getEffectiveSafetyStock(productBeforeUpdate, projectionMonthKey);

        const updateFunction = (product) => {
            if (
                projectionIndex < 0 ||
                projectionIndex >= product.PROYECCIONES.length
            ) {
                throw new Error("Índice de proyección inválido.");
            }
            const projectionMonthKey = product.PROYECCIONES[projectionIndex].mes;
            if (!product.CONFIGURACION.OVERRIDES)
                product.CONFIGURACION.OVERRIDES = {};
            if (!product.CONFIGURACION.OVERRIDES.SAFETY_STOCK)
                product.CONFIGURACION.OVERRIDES.SAFETY_STOCK = {};
            product.CONFIGURACION.OVERRIDES.SAFETY_STOCK[projectionMonthKey] =
                parseFloat(newSafetyStock);
            logger.info(
                `Override de SS aplicado a ${productCode}, mes ${projectionMonthKey}. Nuevo SS: ${newSafetyStock}`
            );
            return product;
        };

        const result = await this._applyOverrideAndRecalculate({
            userId,
            analysisId,
            productCode,
            updateFunction,
            regenerateAlerts: true,
        });

        // Registrar la actividad de override
        await activityLogService.createLog({
            userId,
            analysisId,
            productCode,
            actionType: 'OVERRIDE_SS',
            description: `Se cambió el Stock de Seguridad para ${productCode} de ${previousValue.toFixed(0)} a ${newSafetyStock}.`,
            details: {
                projectionMonth: projectionMonthKey,
                previousValue: previousValue,
                newValue: newSafetyStock
            }
        });

        return result;
    }

    /**
     * Aplica un override de Lead Time a un producto para un mes específico.
     * @param {object} params - Parametros para el override.
     * @param {number} params.userId - ID del usuario.
     * @param {number} params.analysisId - ID del análisis.
     * @param {string} params.productCode - Código del producto.
     * @param {number} params.projectionIndex - Índice de la proyección.
     * @param {number} params.newLeadTime - Nuevo valor de lead time en días.
     * @returns {Promise<object>} - Producto actualizado.
     */
    async applyLeadTimeToProjection({
        userId,
        analysisId,
        productCode,
        projectionIndex,
        newLeadTime,
    }) {
        if (
            newLeadTime === undefined ||
            newLeadTime === null ||
            isNaN(newLeadTime) ||
            newLeadTime < 0
        ) {
            throw new Error("El lead time debe ser un número positivo.");
        }

        // 1. Obtener datos y capturar el valor antiguo
        const predictions = await this.getAnalysisData(userId, analysisId);
        const productIndex = this._findProductIndex(predictions, productCode);
        if (productIndex === -1) throw new Error(`Producto ${productCode} no encontrado.`);

        const productBeforeUpdate = predictions[productIndex];
        const projectionMonthKey = productBeforeUpdate.PROYECCIONES[projectionIndex]?.mes;
        if (!projectionMonthKey) throw new Error("Índice de proyección inválido.");

        const previousValue = this._getEffectiveLeadTime(productBeforeUpdate, projectionMonthKey);

        const updateFunction = (product) => {
            if (
                projectionIndex < 0 ||
                projectionIndex >= product.PROYECCIONES.length
            ) {
                throw new Error("Índice de proyección inválido.");
            }
            const projectionMonthKey = product.PROYECCIONES[projectionIndex].mes;
            if (!product.CONFIGURACION.OVERRIDES)
                product.CONFIGURACION.OVERRIDES = {};
            if (!product.CONFIGURACION.OVERRIDES.LEAD_TIME_DAYS)
                product.CONFIGURACION.OVERRIDES.LEAD_TIME_DAYS = {};
            product.CONFIGURACION.OVERRIDES.LEAD_TIME_DAYS[projectionMonthKey] =
                parseInt(newLeadTime);
            logger.info(
                `Override de lead time aplicado a ${productCode}, mes ${projectionMonthKey}. Nuevo lead time: ${newLeadTime}`
            );
            return product;
        };

        const result = await this._applyOverrideAndRecalculate({
            userId,
            analysisId,
            productCode,
            updateFunction,
            regenerateAlerts: true,
        });

        await activityLogService.createLog({
            userId,
            analysisId,
            productCode,
            actionType: 'OVERRIDE_LT',
            description: `Se cambió el Lead Time para ${productCode} de ${previousValue} a ${newLeadTime} días.`,
            details: {
                projectionMonth: projectionMonthKey,
                previousValue: previousValue,
                newValue: newLeadTime
            }
        });

        return result;
    }

    /**
     * Actualiza una alerta específica para un producto en un análisis.
     * @param {object} params - Parametros para la actualización.
     * @param {number} params.userId - ID del usuario.
     * @param {number} params.analysisId - ID del análisis.
     * @param {string} params.productCode - Código del producto.
     * @param {string} params.alertId - ID de la alerta.
     * @param {object} params.updates - Objeto con las actualizaciones (unidades, lead_time_especifico).
     * @returns {Promise<object>} - Producto actualizado.
     */
    async updateAlert({ userId, analysisId, productCode, alertId, updates }) {
        const { unidades, lead_time_especifico } = updates;
        if (
            (unidades !== undefined && isNaN(unidades)) ||
            (lead_time_especifico !== undefined && isNaN(lead_time_especifico))
        ) {
            throw new Error("Los valores de actualización deben ser numéricos.");
        }

        // 1. Obtener datos y capturar el valor antiguo
        const predictions = await this.getAnalysisData(userId, analysisId);
        const productIndex = this._findProductIndex(predictions, productCode);
        if (productIndex === -1) throw new Error(`Producto ${productCode} no encontrado.`);

        const productBeforeUpdate = predictions[productIndex];
        const alertBeforeUpdate = this._findAlert(productBeforeUpdate, alertId)?.alert;
        if (!alertBeforeUpdate) throw new Error(`Alerta ${alertId} no encontrada.`);

        const previousValues = {
            unidades: alertBeforeUpdate.unidades,
            lead_time_especifico: alertBeforeUpdate.lead_time_especifico
        };

        const updateFunction = (product) => {
            const { alert } = this._findAlert(product, alertId);
            if (!alert)
                throw new Error(
                    `Alerta con ID ${alertId} no encontrada para el producto ${productCode}.`
                );

            if (unidades !== undefined) alert.unidades = parseFloat(unidades);
            if (lead_time_especifico !== undefined) {
                alert.lead_time_especifico = parseInt(lead_time_especifico);
                alert.fecha_arribo = this._recalculateArrivalDate(alert);
            }
            logger.info(
                `Override de alerta ${alertId} en ${productCode} aplicado. Updates: ${JSON.stringify(
                    updates
                )}`
            );
            return product;
        };

        const result = await this._applyOverrideAndRecalculate({
            userId,
            analysisId,
            productCode,
            updateFunction,
            regenerateAlerts: false,
        });

        await activityLogService.createLog({
            userId,
            analysisId,
            productCode,
            actionType: 'UPDATE_ALERT',
            description: `Se modificó la alerta ${alertId} para el producto ${productCode}.`,
            details: {
                alertId,
                previousValues,
                newValues: updates
            }
        });

        return result;
    }

    /**
     * Añade unidades en tránsito manualmente a un producto en un análisis.
     * @param {object} params - Parametros para añadir unidades.
     * @param {number} params.userId - ID del usuario.
     * @param {number} params.analysisId - ID del análisis.
     * @param {string} params.productCode - Código del producto.
     * @param {number} params.units - Cantidad de unidades.
     * @param {string} params.expectedArrivalDate - Fecha de arribo esperada.
     * @param {string} [params.poNumber] - Número de orden de compra (opcional).
     * @returns {Promise<object>} - Producto actualizado.
     */
    async addManualTransitUnits({
        userId,
        analysisId,
        productCode,
        units,
        expectedArrivalDate,
        poNumber,
    }) {
        if (!units || isNaN(units) || units <= 0)
            throw new Error("Las unidades deben ser un número positivo.");
        if (
            !expectedArrivalDate ||
            !this._isValidDate(new Date(expectedArrivalDate))
        )
            throw new Error("La fecha de arribo es inválida.");

        const updateFunction = (product) => {
            if (!product.PEDIDOS_POR_LLEGAR) product.PEDIDOS_POR_LLEGAR = [];
            product.PEDIDOS_POR_LLEGAR.push({
                unidades: parseFloat(units),
                fecha_arribo: expectedArrivalDate,
                po_number: poNumber || `manual-${Date.now()}`,
                isManual: true,
            });
            logger.info(`Unidades en tránsito manuales añadidas a ${productCode}.`);
            return product;
        };

        const result = await this._applyOverrideAndRecalculate({
            userId,
            analysisId,
            productCode,
            updateFunction,
            regenerateAlerts: false,
        });

        await activityLogService.createLog({
            userId,
            analysisId,
            productCode,
            actionType: 'ADD_TRANSIT',
            description: `Se añadieron ${units} unidades en tránsito manuales al producto ${productCode}.`,
            details: { units, expectedArrivalDate, poNumber }
        });

        return result;
    }

    // --- MOTOR DE RE-SIMULACION Y LOGICA INTERNA ---

    /**
     * Orquesta el proceso de descargar, modificar, recalcular y volver a subir un análisis.
     * @param {object} params - Parametros para la operación.
     * @param {number} params.userId - ID del usuario.
     * @param {number} params.analysisId - ID del análisis.
     * @param {string} params.productCode - Código del producto.
     * @param {Function} params.updateFunction - Función que modifica el producto.
     * @param {boolean} params.regenerateAlerts - Indica si se deben regenerar las alertas.
     * @returns {Promise<object>} - Producto actualizado.
     */
    async _applyOverrideAndRecalculate({
        userId,
        analysisId,
        productCode,
        updateFunction,
        regenerateAlerts,
    }) {
        if (typeof this._findProductIndex !== "function") {
            logger.error(
                "Método _findProductIndex no está definido en PythonService."
            );
            throw new Error("Error interno: método _findProductIndex no disponible.");
        }

        const analysis = await Analysis.findOne({
            where: { id: analysisId, userId },
        });
        if (!analysis)
            throw new Error("Análisis no encontrado para aplicar el override.");

        let predictions = await this.getAnalysisData(userId, analysisId);
        const productIndex = this._findProductIndex(predictions, productCode);
        if (productIndex === -1)
            throw new Error(`Producto ${productCode} no encontrado en el análisis.`);

        let productToUpdate = predictions[productIndex];

        productToUpdate = updateFunction(productToUpdate);

        // Actualizar proyecciones con nuevo stock de seguridad o lead time
        productToUpdate.PROYECCIONES.forEach((proj) => {
            const ss = this._getEffectiveSafetyStock(productToUpdate, proj.mes);
            const leadTime = this._getEffectiveLeadTime(productToUpdate, proj.mes);
            proj.stock_seguridad = parseFloat(ss.toFixed(2));
            proj.lead_time_days = parseInt(leadTime);
            proj.punto_reorden = parseFloat(
                (proj.consumo_diario * leadTime + ss).toFixed(2)
            );
            proj.stock_seguridad_source = productToUpdate.CONFIGURACION.OVERRIDES
                ?.SAFETY_STOCK?.[proj.mes]
                ? "Manual"
                : "Calculado";
        });

        // Limpiar y regenerar alertas si es necesario
        if (regenerateAlerts) {
            productToUpdate.PROYECCIONES.forEach((p) => (p.alertas_y_pedidos = []));
            const newAlerts = this._regenerateAlertsAndOrders(productToUpdate);
            logger.info(
                `Asignando ${newAlerts.length} alertas nuevas para ${productCode}`
            );
            newAlerts.forEach((alert) => {
                if (!alert.fecha_alerta) {
                    logger.warn(
                        `Alerta sin fecha_alerta válida: ${JSON.stringify(alert)}`
                    );
                    return;
                }
                const alertDate = new Date(alert.fecha_alerta + "T00:00:00");
                if (isNaN(alertDate.getTime())) {
                    logger.warn(`Fecha de alerta inválida: ${alert.fecha_alerta}`);
                    return;
                }
                const alertMonthKey = `${alertDate
                    .toLocaleString("es-ES", { month: "short" })
                    .toUpperCase()
                    .slice(0, 3)}-${alertDate.getFullYear()}`;
                const projection = productToUpdate.PROYECCIONES.find(
                    (p) => p.mes === alertMonthKey
                );
                if (projection) {
                    if (!projection.alertas_y_pedidos) projection.alertas_y_pedidos = [];
                    projection.alertas_y_pedidos.push(alert);
                    logger.debug(
                        `Alerta asignada a ${alertMonthKey}: ${JSON.stringify(alert)}`
                    );
                } else {
                    logger.warn(`No se encontró proyección para el mes ${alertMonthKey}`);
                }
            });
        }

        this._recalculateProjections(productToUpdate);
        this._updateMainProductMetrics(productToUpdate);

        predictions[productIndex] = productToUpdate;

        const newBuffer = Buffer.from(JSON.stringify(predictions));
        const compressedData = pako.gzip(newBuffer);

        try {
            await storageService.uploadFile(
                "analyses",
                analysis.storagePath,
                compressedData,
                "application/json",
                {
                    overwrite: true,
                    contentEncoding: "gzip",
                }
            );

            await Analysis.update({}, { where: { id: analysisId, userId } });

            logger.info(
                `Análisis #${analysisId} actualizado y sobrescrito en Storage para producto ${productCode}.`
            );
        } catch (error) {
            logger.error(
                `Error al subir el archivo actualizado para el análisis #${analysisId}: ${error.message}`
            );
            throw new Error(
                "Fallo al subir el archivo actualizado al almacenamiento."
            );
        }

        return productToUpdate;
    }

    /**
     * Recalcula las proyecciones diarias y totales de un producto.
     * @param {object} product - Objeto del producto a recalcular.
     */
    _recalculateProjections(product) {
        const config = product.CONFIGURACION;
        const diasConsumoMensual =
            config.DIAS_CONSUMO_MENSUAL || this.defaultDiasConsumoMensual;

        let todosLosPedidos = [
            ...(product.PEDIDOS_POR_LLEGAR || []).filter(
                (p) => p.isManual && p.fecha_arribo
            ),
            ...product.PROYECCIONES.flatMap((p) => p.alertas_y_pedidos || []),
        ]
            .map((p) => ({ ...p, fecha_arribo: this._recalculateArrivalDate(p) }))
            .sort((a, b) => new Date(a.fecha_arribo) - new Date(b.fecha_arribo));

        const unidadesEnTransitoPorFecha = new Map();
        let fechaTemp = new Date(product.FECHA_INICIAL + "T00:00:00");
        const fechaFinalSimulacion = new Date(
            product.PROYECCIONES[product.PROYECCIONES.length - 1].fecha_fin_mes +
            "T00:00:00"
        );
        while (fechaTemp <= fechaFinalSimulacion) {
            unidadesEnTransitoPorFecha.set(fechaTemp.toISOString().split("T")[0], 0);
            fechaTemp.setDate(fechaTemp.getDate() + 1);
        }

        todosLosPedidos.forEach((pedido) => {
            if (!pedido.fecha_arribo) {
                logger.warn(
                    `Pedido sin fecha_arribo válida: ${JSON.stringify(pedido)}`
                );
                return;
            }
            const fechaArribo = new Date(pedido.fecha_arribo + "T00:00:00");
            let fechaTransito = pedido.fecha_alerta
                ? new Date(pedido.fecha_alerta + "T00:00:00")
                : new Date(product.FECHA_INICIAL + "T00:00:00");
            while (fechaTransito < fechaArribo) {
                const fechaStr = fechaTransito.toISOString().split("T")[0];
                if (unidadesEnTransitoPorFecha.has(fechaStr)) {
                    unidadesEnTransitoPorFecha.set(
                        fechaStr,
                        unidadesEnTransitoPorFecha.get(fechaStr) + pedido.unidades
                    );
                }
                fechaTransito.setDate(fechaTransito.getDate() + 1);
            }
        });

        let stockProyectado = parseFloat(product.STOCK_TOTAL);

        for (let i = 0; i < product.PROYECCIONES.length; i++) {
            const projection = product.PROYECCIONES[i];
            projection.stock_diario_proyectado = [];
            const fechaFinMes = new Date(projection.fecha_fin_mes + "T00:00:00");

            if (i === 0) {
                projection.stock_inicial_mes = parseFloat(product.STOCK_TOTAL);
            } else {
                projection.stock_inicial_mes = parseFloat(
                    product.PROYECCIONES[i - 1].stock_proyectado_mes.toFixed(2)
                );
            }

            stockProyectado = parseFloat(projection.stock_inicial_mes);

            let fechaSimulacion = new Date(projection.fecha_inicio_mes + "T00:00:00");
            let pedidosPendientes = JSON.parse(JSON.stringify(todosLosPedidos));

            while (fechaSimulacion <= fechaFinMes) {
                const fechaSimulacionStr = fechaSimulacion.toISOString().split("T")[0];

                let pedidosRecibidosHoy = 0;
                pedidosPendientes = pedidosPendientes.filter((pedido) => {
                    if (pedido.fecha_arribo === fechaSimulacionStr) {
                        pedidosRecibidosHoy += pedido.unidades;
                        return false;
                    }
                    return true;
                });
                stockProyectado += pedidosRecibidosHoy;

                stockProyectado = Math.max(
                    0,
                    stockProyectado - projection.consumo_diario
                );

                const unidadesEnTransitoHoy =
                    unidadesEnTransitoPorFecha.get(fechaSimulacionStr) || 0;

                projection.stock_diario_proyectado.push({
                    fecha: fechaSimulacionStr,
                    stock_proyectado: parseFloat(stockProyectado.toFixed(2)),
                    unidades_en_transito: parseFloat(unidadesEnTransitoHoy.toFixed(2)),
                    stock_total_proyectado: parseFloat(
                        (stockProyectado + unidadesEnTransitoHoy).toFixed(2)
                    ),
                });

                fechaSimulacion.setDate(fechaSimulacion.getDate() + 1);
            }

            if (projection.stock_diario_proyectado.length > 0) {
                const ultimoDia =
                    projection.stock_diario_proyectado[
                    projection.stock_diario_proyectado.length - 1
                    ];
                this._updateMonthlyProjectionTotals(projection, ultimoDia, product);

                if (
                    Math.abs(
                        projection.stock_proyectado_mes - ultimoDia.stock_proyectado
                    ) > 0.01
                ) {
                    logger.warn(
                        `Inconsistencia en ${product.CODIGO} para ${projection.mes}: stock_proyectado_mes (${projection.stock_proyectado_mes}) no coincide con último stock_diario_proyectado (${ultimoDia.stock_proyectado})`
                    );
                }
            }
        }
    }

    /**
     * Regenera las alertas y pedidos basados en el ROP actualizado.
     * @param {object} product - Objeto del producto.
     * @returns {Array} - Nueva lista de alertas.
     */
    _regenerateAlertsAndOrders(product) {
        logger.info(
            `Regenerando alertas para ${product.CODIGO} basado en ROP actualizado.`
        );
        const newAlerts = [];

        let stockFisicoSimulado = parseFloat(product.STOCK_TOTAL);
        let stockTotalSimulado = parseFloat(product.STOCK_TOTAL);
        let fechaSimulacion = new Date(product.FECHA_INICIAL + "T00:00:00");
        const fechaFinal = new Date(
            product.PROYECCIONES[product.PROYECCIONES.length - 1].fecha_fin_mes +
            "T00:00:00"
        );

        // Conservar unidades en tránsito manuales
        const manualPedidos = (product.PEDIDOS_POR_LLEGAR || []).filter(
            (p) => p.isManual && p.fecha_arribo
        );

        while (fechaSimulacion <= fechaFinal) {
            const fechaSimulacionStr = fechaSimulacion.toISOString().split("T")[0];
            const mesKey = `${fechaSimulacion
                .toLocaleString("es-ES", { month: "short" })
                .toUpperCase()
                .slice(0, 3)}-${fechaSimulacion.getFullYear()}`;
            const projection = product.PROYECCIONES.find((p) => p.mes === mesKey);

            if (!projection) {
                logger.warn(`No se encontró proyección para el mes ${mesKey}`);
                fechaSimulacion.setDate(fechaSimulacion.getDate() + 1);
                continue;
            }

            // Recibir unidades en tránsito manuales
            let pedidosRecibidos = 0;
            manualPedidos.forEach((pedido) => {
                if (pedido.fecha_arribo === fechaSimulacionStr) {
                    pedidosRecibidos += pedido.unidades;
                    logger.debug(
                        `Recibido pedido manual en ${fechaSimulacionStr}: ${pedido.unidades} unidades`
                    );
                }
            });
            stockFisicoSimulado += pedidosRecibidos;
            stockTotalSimulado += pedidosRecibidos;

            // Verificar si se necesita una alerta
            if (stockTotalSimulado <= projection.punto_reorden) {
                const leadTime = this._getEffectiveLeadTime(product, mesKey);
                const ss = this._getEffectiveSafetyStock(product, mesKey);
                const consumoLeadTime = projection.consumo_diario * leadTime;
                const deficit =
                    projection.punto_reorden - stockTotalSimulado + consumoLeadTime;
                const cajasAPedir =
                    product.UNIDADES_POR_CAJA > 0
                        ? Math.ceil(deficit / product.UNIDADES_POR_CAJA)
                        : 0;
                const unidadesAPedir = cajasAPedir * product.UNIDADES_POR_CAJA;

                if (unidadesAPedir > 0) {
                    const nuevaAlerta = {
                        fecha_alerta: fechaSimulacionStr,
                        fecha_arribo: this._addDays(fechaSimulacion, leadTime)
                            .toISOString()
                            .split("T")[0],
                        unidades: parseFloat(unidadesAPedir.toFixed(2)),
                        cajas_pedir: cajasAPedir,
                        lead_time_especifico: leadTime,
                    };
                    newAlerts.push(nuevaAlerta);
                    stockTotalSimulado += unidadesAPedir;
                    logger.debug(
                        `Nueva alerta generada en ${fechaSimulacionStr}: ${JSON.stringify(
                            nuevaAlerta
                        )}`
                    );
                }
            }

            // Aplicar consumo diario
            const consumoHoy = projection.consumo_diario;
            stockFisicoSimulado = Math.max(0, stockFisicoSimulado - consumoHoy);
            stockTotalSimulado = Math.max(0, stockTotalSimulado - consumoHoy);

            fechaSimulacion.setDate(fechaSimulacion.getDate() + 1);
        }
        logger.info(
            `Se generaron ${newAlerts.length} nuevas alertas para ${product.CODIGO}.`
        );
        return newAlerts;
    }

    /**
     * Actualiza los totales mensuales de una proyección.
     * @param {object} projection - Proyección mensual.
     * @param {object} ultimoDia - Datos del último día de la proyección.
     * @param {object} product - Objeto del producto.
     */
    _updateMonthlyProjectionTotals(projection, ultimoDia, product) {
        const mesKey = projection.mes;
        const config = product.CONFIGURACION;
        const leadTime = this._getEffectiveLeadTime(product, mesKey);
        const ss = this._getEffectiveSafetyStock(product, mesKey);
        const rop = projection.consumo_diario * leadTime + ss;

        projection.stock_proyectado_mes = ultimoDia.stock_proyectado;
        projection.unidades_en_transito = ultimoDia.unidades_en_transito;
        projection.stock_total_proyectado = ultimoDia.stock_total_proyectado;
        projection.stock_seguridad = parseFloat(ss.toFixed(2));
        projection.punto_reorden = parseFloat(rop.toFixed(2));
        projection.stock_seguridad_source = config.OVERRIDES?.SAFETY_STOCK?.[mesKey]
            ? "Manual"
            : "Calculado";
        projection.indicador_riesgo =
            ultimoDia.stock_proyectado > rop
                ? "Bajo"
                : ultimoDia.stock_proyectado > ss
                    ? "Medio"
                    : "Alto";
    }

    /**
     * Actualiza las métricas principales del producto.
     * @param {object} product - Objeto del producto.
     */
    _updateMainProductMetrics(product) {
        const defaultLeadTime =
            product.CONFIGURACION.LEAD_TIME_DAYS || this.defaultLeadTimeDays;
        const totalTransit =
            (product.PEDIDOS_POR_LLEGAR || [])
                .filter((p) => p.isManual)
                .reduce((sum, p) => sum + p.unidades, 0) +
            product.PROYECCIONES.flatMap((p) => p.alertas_y_pedidos).reduce(
                (sum, a) => sum + a.unidades,
                0
            );
        product.STOCK_TOTAL = parseFloat(product.STOCK_TOTAL); // Usar directamente el valor de STOCK_TOTAL
        product.STOCK_SEGURIDAD = this._getEffectiveSafetyStock(product, null);
        product.PUNTO_REORDEN =
            product.CONSUMO_DIARIO * defaultLeadTime + product.STOCK_SEGURIDAD;
        product.DEFICIT = Math.max(product.PUNTO_REORDEN - product.STOCK_TOTAL, 0); // No sumamos unidades en tránsito
        const cajas =
            product.UNIDADES_POR_CAJA > 0
                ? Math.ceil(product.DEFICIT / product.UNIDADES_POR_CAJA)
                : 0;
        product.CAJAS_A_PEDIR = cajas;
        product.UNIDADES_A_PEDIR = cajas * product.UNIDADES_POR_CAJA;
    }

    /**
     * Obtiene el lead time efectivo para un mes específico.
     * @param {object} product - Objeto del producto.
     * @param {string} monthKey - Clave del mes (e.g., 'ENE-2025').
     * @returns {number} - Valor del lead time.
     */
    _getEffectiveLeadTime(product, monthKey) {
        if (
            monthKey &&
            product.CONFIGURACION.OVERRIDES?.LEAD_TIME_DAYS?.[monthKey]
        ) {
            return parseInt(product.CONFIGURACION.OVERRIDES.LEAD_TIME_DAYS[monthKey]);
        }
        return product.CONFIGURACION.LEAD_TIME_DAYS || this.defaultLeadTimeDays;
    }

    /**
     * Obtiene el stock de seguridad efectivo para un mes específico.
     * @param {object} product - Objeto del producto.
     * @param {string} monthKey - Clave del mes (e.g., 'ENE-2025').
     * @returns {number} - Valor del stock de seguridad.
     */
    _getEffectiveSafetyStock(product, monthKey) {
        if (monthKey && product.CONFIGURACION.OVERRIDES?.SAFETY_STOCK?.[monthKey]) {
            return parseFloat(product.CONFIGURACION.OVERRIDES.SAFETY_STOCK[monthKey]);
        }
        if (
            product.CONFIGURACION.SAFETY_STOCK_SOURCE === "Manual" &&
            product.CONFIGURACION.SAFETY_STOCK !== null
        ) {
            return parseFloat(product.CONFIGURACION.SAFETY_STOCK);
        }
        const defaultLeadTime =
            product.CONFIGURACION.LEAD_TIME_DAYS || this.defaultLeadTimeDays;
        return this._calculateDynamicSafetyStock(product, defaultLeadTime);
    }

    /**
     * Calcula el stock de seguridad dinámico.
     * @param {object} product - Objeto del producto.
     * @param {number} leadTime - Días de lead time.
     * @returns {number} - Stock de seguridad calculado.
     */
    _calculateDynamicSafetyStock(product, leadTime) {
        const sigmaD = product.SIGMA_D || 0;
        if (sigmaD === 0)
            logger.warn(
                `SIGMA_D es 0 para ${product.CODIGO}. El SS dinámico será 0.`
            );
        const z = this._calculateZFactor(product.CONFIGURACION.NIVEL_SERVICIO);
        return z * sigmaD * Math.sqrt(leadTime);
    }

    /**
     * Encuentra una alerta específica en un producto.
     * @param {object} product - Objeto del producto.
     * @param {string} alertId - ID de la alerta.
     * @returns {object} - Índice de la proyección y la alerta.
     */
    _findAlert(product, alertId) {
        for (let i = 0; i < product.PROYECCIONES.length; i++) {
            const alertIndex = product.PROYECCIONES[i].alertas_y_pedidos.findIndex(
                (a) => a.fecha_alerta === alertId
            );
            if (alertIndex !== -1) {
                return {
                    projectionIndex: i,
                    alert: product.PROYECCIONES[i].alertas_y_pedidos[alertIndex],
                };
            }
        }
        return { projectionIndex: -1, alert: null };
    }

    /**
     * Encuentra el índice de un producto en las predicciones.
     * @param {Array} predictions - Lista de predicciones.
     * @param {string} productCode - Código del producto.
     * @returns {number} - Índice del producto o -1 si no se encuentra.
     */
    _findProductIndex(predictions, productCode) {
        logger.debug(
            `Buscando producto con código ${productCode} en las predicciones.`
        );
        const index = predictions.findIndex((p) => p.CODIGO === productCode);
        if (index === -1) {
            logger.warn(`Producto ${productCode} no encontrado en las predicciones.`);
        }
        return index;
    }

    /**
     * Calcula el factor Z para el nivel de servicio.
     * @param {number} serviceLevel - Nivel de servicio (porcentaje).
     * @returns {number} - Factor Z.
     */
    _calculateZFactor(serviceLevel = 99.99) {
        return jStat.normal.inv(parseFloat(serviceLevel) / 100, 0, 1);
    }

    /**
     * Valida si una fecha es válida.
     * @param {Date} date - Fecha a validar.
     * @returns {boolean} - Verdadero si la fecha es válida.
     */
    _isValidDate(date) {
        return date instanceof Date && !isNaN(date.getTime());
    }

    /**
     * Añade días a una fecha.
     * @param {Date} fechaInicio - Fecha inicial.
     * @param {number} dias - Días a añadir.
     * @returns {Date} - Nueva fecha.
     */
    _addDays(fechaInicio, dias) {
        const fecha = new Date(fechaInicio);
        fecha.setDate(fecha.getDate() + dias);
        return fecha;
    }

    /**
     * Recalcula la fecha de arribo de una alerta.
     * @param {object} alert - Objeto de la alerta.
     * @returns {string} - Nueva fecha de arribo.
     */
    _recalculateArrivalDate(alert) {
        if (!alert.fecha_alerta || alert.lead_time_especifico === undefined) {
            return alert.fecha_arribo;
        }
        const newArrival = this._addDays(
            new Date(alert.fecha_alerta),
            alert.lead_time_especifico
        );
        return newArrival.toISOString().split("T")[0];
    }

    /**
     * Ejecuta el script de Python con los parámetros proporcionados.
     * @param {string} inputPath - Ruta del archivo de entrada.
     * @param {object} params - Parametros para el script.
     * @returns {Promise<void>} - Promesa que se resuelve cuando el script termina.
     */
    runScript(inputPath, params) {
        return new Promise((resolve, reject) => {
            const args = this._buildPythonArgs(inputPath, params);
            const pythonProcess = spawn("python", args);
            let errorLog = "";

            const timeoutId = setTimeout(() => {
                pythonProcess.kill();
                reject(new Error("Tiempo de ejecución del script de Python excedido."));
            }, this.timeout);

            pythonProcess.stdout.on("data", (data) => {
                logger.debug(`Python stdout: ${data.toString().trim()}`);
            });

            pythonProcess.stderr.on("data", (data) => {
                errorLog += data.toString();
                logger.error(`Python stderr: ${data.toString().trim()}`);
            });

            pythonProcess.on("close", (code) => {
                clearTimeout(timeoutId);
                if (code === 0) resolve();
                else
                    reject(
                        new Error(
                            `El script de Python falló con código ${code}. Error: ${errorLog}`
                        )
                    );
            });
        });
    }

    /**
     * Construye los argumentos para el script de Python.
     * @param {string} inputPath - Ruta del archivo de entrada.
     * @param {object} params - Parametros para el script.
     * @returns {Array} - Lista de argumentos.
     */
    _buildPythonArgs(inputPath, params) {
        const {
            serviceLevel,
            diasOperacion,
            minUnidadesCaja,
            leadTimeDays,
            safetyStock,
        } = params;
        const validatedParams = {
            excel: inputPath,
            service_level: parseFloat(serviceLevel),
            dias_operacion: parseInt(diasOperacion, 10),
            min_unidades_caja: parseInt(minUnidadesCaja, 10),
            lead_time_days: parseInt(leadTimeDays, 10),
            safety_stock:
                safetyStock !== null && safetyStock !== undefined
                    ? parseFloat(safetyStock)
                    : null,
        };

        for (const key in validatedParams) {
            if (
                validatedParams[key] !== null &&
                isNaN(validatedParams[key]) &&
                typeof validatedParams[key] !== "string"
            ) {
                throw new Error(`Parámetro inválido para el script de Python: ${key}`);
            }
        }

        const args = [
            "-u",
            this.scriptPath,
            "--excel",
            validatedParams.excel,
            "--service_level",
            validatedParams.service_level.toString(),
            "--dias_operacion",
            validatedParams.dias_operacion.toString(),
            "--min_unidades_caja",
            validatedParams.min_unidades_caja.toString(),
            "--lead_time_days",
            validatedParams.lead_time_days.toString(),
        ];
        if (validatedParams.safety_stock !== null) {
            args.push("--safety_stock", validatedParams.safety_stock.toString());
        }
        return args;
    }

    /**
     * Elimina archivos temporales.
     * @param {string} filePath - Ruta del archivo a eliminar.
     * @returns {Promise<void>} - Promesa que se resuelve al eliminar el archivo.
     */
    async cleanTempFiles(filePath) {
        if (!filePath) return;
        try {
            await fs.unlink(filePath);
            logger.info(`Archivo temporal de entrada eliminado: ${filePath}`);
        } catch (error) {
            logger.warn(`No se pudo eliminar el archivo temporal: ${error.message}`);
        }
    }

    // --- NUEVO MÉTODO AÑADIDO ---
    /**
     * Busca un producto por su SKU a través de TODOS los análisis de un usuario,
     * comenzando por el más reciente.
     * @param {number} userId - ID del usuario.
     * @param {string} productCode - El SKU del producto a buscar.
     * @returns {Promise<object|null>} - El objeto del producto si se encuentra, o null si no.
     */
    async getProductByCode(userId, productCode) {
        logger.info(`Buscando SKU '${productCode}' en todos los análisis del usuario ${userId}...`);

        // 1. Obtener la lista de todos los análisis, del más reciente al más antiguo.
        const analyses = await this.listAnalysesForUser(userId);
        if (!analyses || analyses.length === 0) {
            logger.warn(`El usuario ${userId} no tiene análisis para buscar el SKU.`);
            return null;
        }

        // 2. Iterar sobre cada análisis para buscar el SKU.
        for (const analysis of analyses) {
            logger.debug(`Buscando en análisis #${analysis.id} ('${analysis.name}')...`);
            try {
                const predictions = await this.getAnalysisData(userId, analysis.id);
                const product = predictions.find(p => p.CODIGO === productCode);

                if (product) {
                    logger.info(`SKU '${productCode}' encontrado en el análisis #${analysis.id}.`);
                    return product; // ¡Encontrado! Retornamos inmediatamente.
                }
            } catch (error) {
                logger.error(`No se pudieron cargar los datos del análisis #${analysis.id} para buscar el SKU:`, error.message);
                // Si un archivo falla, continuamos con el siguiente.
            }
        }

        // 3. Si el bucle termina, el producto no se encontró en ningún análisis.
        logger.warn(`SKU '${productCode}' NO fue encontrado en ninguno de los ${analyses.length} análisis del usuario ${userId}.`);
        return null;
    }
}

export default new PythonService();