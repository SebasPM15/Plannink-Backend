import emailService from './emailService.js'; // Usaremos el servicio centralizado
import { logger } from '../utils/logger.js';
import sanitizeHtml from 'sanitize-html';

class AlertService {
    constructor() {
        this.lastSentDates = new Map(); // Almacena las últimas fechas de envío por producto
    }

    // Función para sanitizar texto plano que se insertará en el HTML
    _sanitizeText(text) {
        return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
    }

    generarMensajeHTML(producto) {
        const proyeccion = producto.PROYECCIONES[0];
        const consumos = producto.CONSUMOS_MENSUALES_PREVISTOS || [];
        
        // 1. Sanitizar todos los datos dinámicos para prevenir XSS
        const descripcionSegura = this._sanitizeText(producto.DESCRIPCION);
        const codigoSeguro = this._sanitizeText(producto.CODIGO);
        const mesSeguro = this._sanitizeText(proyeccion.mes);

        // 1. Encontrar el consumo máximo para calcular el porcentaje de la barra de progreso.
        const maxConsumo = consumos.length > 0 ? Math.max(...consumos.map(c => c.yhat)) : 1;

        // Generar tabla de consumos mensuales previstos
        const consumosMensualesHTML = consumos.map(consumo => {
            // 2. Calcular el ancho de la barra de progreso para cada mes.
            const porcentajeAncho = maxConsumo > 0 ? (consumo.yhat / maxConsumo) * 100 : 0;
            // 3. Determinar si esta fila debe ser resaltada.
            const esMesActual = consumo.month === proyeccion.mes;

            return `
                <tr style="${esMesActual ? 'background-color: #e3f2fd;' : ''}">
                    <td style="padding: 12px 15px; border-bottom: 1px solid #e0e0e0; font-size: 14px; color: #333;">
                        ${this._sanitizeText(consumo.month)}
                    </td>
                    <td style="padding: 12px 15px; border-bottom: 1px solid #e0e0e0; font-size: 14px; text-align: right; color: #333; font-weight: 500;">
                        ${consumo.yhat.toFixed(2)} uds
                    </td>
                    <td style="padding: 12px 15px; border-bottom: 1px solid #e0e0e0; width: 40%;">
                        <div style="height: 8px; background-color: #e0e0e0; border-radius: 4px; overflow: hidden;">
                            <div style="width: ${porcentajeAncho}%; height: 100%; background: linear-gradient(90deg, #4299e1, #3182ce); border-radius: 4px;"></div>
                        </div>
                    </td>
                </tr>
                `;
        }).join('');

        const htmlCompleto = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; color: #333; max-width: 650px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
            <!-- Encabezado -->
            <div style="background: linear-gradient(90deg, #003087 0%, #0052cc 100%); padding: 20px; color: white;">
                <h2 style="margin: 0; font-size: 24px; font-weight: 600;">⚠️ Alerta de Stock Crítico</h2>
                <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.9;">Sistema Automático de Gestión de Inventarios</p>
            </div>
            
            <!-- Cuerpo -->
            <div style="padding: 25px; background: #ffffff;">
                <h3 style="margin: 0 0 10px; color: #003087; font-size: 20px; font-weight: 600;">${descripcionSegura}</h3>
                <p style="color: #666; font-size: 14px; margin: 0 0 20px;">
                    <strong>Código:</strong> ${codigoSeguro} | 
                    <strong>Periodo:</strong> ${mesSeguro}
                </p>

                <!-- Información de Stock -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                    <div style="background: #f8fafc; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0;">
                        <h4 style="margin: 0 0 10px; color: #003087; font-size: 16px; font-weight: 600;">Estado del Stock</h4>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Inicial:</strong> ${proyeccion.stock_inicial_mes.toFixed(2)} unidades</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Proyectado:</strong> ${proyeccion.stock_proyectado_mes.toFixed(2)} unidades</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Días de cobertura:</strong> ${Math.round(proyeccion.tiempo_cobertura || 0)} días</p>
                    </div>
                    
                    <div style="background: #f8fafc; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0;">
                        <h4 style="margin: 0 0 10px; color: #003087; font-size: 16px; font-weight: 600;">Acción Requerida</h4>
                        <p style="margin: 5px 0; font-size: 14px;">
                            <strong>Estado:</strong> 
                            <span style="color: ${proyeccion.deficit > 0 ? '#d32f2f' : '#388e3c'}">
                                ${proyeccion.deficit > 0 ? 'DÉFICIT' : 'Stock suficiente'}
                            </span>
                        </p>
                        <p style="margin: 5px 0; font-size: 14px;">
                            <strong>Acción:</strong> ${proyeccion.accion_requerida || 'Revisar inventario'}
                        </p>
                        <p style="margin: 5px 0; font-size: 14px;">
                            <strong>Unidades a pedir:</strong> ${proyeccion.unidades_a_pedir.toFixed(2)} unidades
                        </p>
                        <p style="margin: 5px 0; font-size: 14px;">
                            <strong>Cajas a pedir:</strong> ${proyeccion.cajas_pedir} cajas
                        </p>
                    </div>
                </div>

                <!-- Consumos Mensuales -->
                <div style="background: #f8fafc; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0; margin-bottom: 20px;">
                    <h4 style="margin: 0 0 10px; color: #003087; font-size: 16px; font-weight: 600;">Consumos Mensuales Previstos</h4>
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #e3f2fd;">
                                <th style="padding: 10px; border: 1px solid #e0e0e0; font-size: 14px; text-align: left;">Mes</th>
                                <th style="padding: 10px; border: 1px solid #e0e0e0; font-size: 14px; text-align: right;">Consumo Proyectado</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${consumosMensualesHTML}
                        </tbody>
                    </table>
                </div>

                <!-- Fechas Clave -->
                <div style="background: #e3f2fd; padding: 15px; border-radius: 6px; border: 1px solid #bbdefb; margin-bottom: 20px;">
                    <h4 style="margin: 0 0 10px; color: #003087; font-size: 16px; font-weight: 600;">Fechas Clave</h4>
                    <p style="margin: 5px 0; font-size: 14px;">
                        <strong>Fecha de pedido:</strong> ${proyeccion.alertas_y_pedidos?.[0]?.fecha_alerta || 'N/A'}
                    </p>
                    <p style="margin: 5px 0; font-size: 14px;">
                        <strong>Fecha estimada de arribo:</strong> ${proyeccion.alertas_y_pedidos?.[0]?.fecha_arribo || 'N/A'}
                    </p>
                </div>

                <!-- Advertencia -->
                <div style="background: #fff3cd; padding: 15px; border-radius: 6px; border: 1px solid #ffeeba;">
                    <p style="margin: 0; font-size: 14px; color: #856404; font-weight: 500;">
                        ⚠️ Se detectó un nivel de stock crítico con ${Math.round(proyeccion.tiempo_cobertura || 0)} días de cobertura. 
                        Se recomienda tomar acción inmediata.
                    </p>
                </div>
            </div>

            <!-- Pie de página -->
            <div style="background: #f8fafc; padding: 15px; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #e0e0e0;">
                <p style="margin: 0;">
                    Sistema Automático de Alertas de Stock | ${new Date().toLocaleString('es-ES', {
            dateStyle: 'medium',
            timeStyle: 'short',
        })}
                </p>
                <p style="margin: 5px 0 0;">
                    Este es un correo automático, por favor no respondas directamente. 
                    Contacta a <a href="mailto:${process.env.EMAIL_USER}" style="color: #0052cc;">${process.env.EMAIL_USER}</a> para soporte.
                </p>
            </div>
        </div>
        `;

        return sanitizeHtml(htmlCompleto, {
            allowedTags: ['div', 'h2', 'p', 'h3', 'h4', 'strong', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
            allowedAttributes: {
                '*': ['style'], // Permite el atributo 'style' en todas las etiquetas permitidas
                'a': ['href']
            }
        });
    }

    async evaluarYEnviarAlerta(prediction, email, isManual = false) {
        if (!prediction?.success || !prediction?.data?.PROYECCIONES?.length) {
            logger.warn('Intento de evaluar alerta con datos de predicción inválidos.');
            return { success: false, error: "Datos de predicción inválidos o sin proyecciones." };
        }

        const producto = prediction.data;
        const primeraProyeccion = producto.PROYECCIONES[0];
        const hoy = new Date().toDateString();

        // Verificar condiciones para enviar alerta
        const debeAlertar =
            primeraProyeccion.tiempo_cobertura <= 10 ||
            primeraProyeccion.alerta_stock ||
            primeraProyeccion.deficit > 0;

        if (!debeAlertar) {
            return { success: false, message: "No se requiere alerta." };
        }

        // Evitar envío redundante si no es manual
        if (!isManual && this.lastSentDates.get(producto.CODIGO) === hoy) {
            return { success: false, message: "Alerta ya enviada hoy.", alreadySent: true };
        }

        // Generar asunto más específico
        const nivelUrgencia = primeraProyeccion.tiempo_cobertura <= 5 ? 'URGENTE' : 'CRÍTICO';
        const subject = `[${nivelUrgencia}] ${producto.DESCRIPCION} - Stock bajo en ${primeraProyeccion.mes}`;
        const html = this.generarMensajeHTML(producto);

        try {
            // 2. Delegar el envío al servicio centralizado de email
            const result = await emailService.sendEmail({
                to: email,
                subject,
                html,
                fromName: "Sistema de Alertas de Stock"
            });

            if (result.success && !isManual) {
                this.lastSentDates.set(producto.CODIGO, hoy);
            }

            return {
                ...result,
                urgency: nivelUrgencia.toLowerCase(),
                details: {
                    productCode: producto.CODIGO,
                    coverageDays: Math.round(primeraProyeccion.tiempo_cobertura || 0),
                    deficit: primeraProyeccion.deficit,
                    unitsToOrder: primeraProyeccion.unidades_a_pedir,
                    boxesToOrder: primeraProyeccion.cajas_pedir,
                },
            };
        } catch (error) {
            logger.error('Fallo crítico en el servicio de alertas.', {
                errorMessage: error.message,
                productCode: producto.CODIGO,
                stack: error.stack
            });
            return { success: false, error: 'No se pudo procesar la alerta por un error interno.' };
        }
    }
}

export default new AlertService();