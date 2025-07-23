import json
import sys
import os
import argparse
from datetime import datetime, timedelta
import locale
import logging
import numpy as np
import pandas as pd
from scipy.stats import norm
import re
from dateutil.relativedelta import relativedelta
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass

# Configuración regional
try:
    locale.setlocale(locale.LC_ALL, 'en_US.UTF-8')
except:
    locale.setlocale(locale.LC_ALL, '')

# Configuración de argumentos
parser = argparse.ArgumentParser(description='Generar predicciones de inventario')
parser.add_argument('--excel', type=str, 
                    default=os.path.join(os.path.dirname(__file__), '../data/Template Plannink (1).xlsx'),
                    help='Ruta al archivo Excel de entrada')
parser.add_argument('--transito', type=float, default=0.0,
                    help='Unidades en tránsito disponibles para asignación')
parser.add_argument('--dias_transito', type=int, default=0,
                    help='Días de tránsito para los pedidos')
parser.add_argument('--service_level', type=float, default=99.99,
                    help='Nivel de servicio en porcentaje (default: 95.0)')
parser.add_argument('--dias_operacion', type=int, default=22,
                    help='Días de operación para calcular el consumo diario (default: 22)')
parser.add_argument('--min_unidades_caja', type=float, default=1.0,
                    help='Mínimo de unidades por caja (default: 1.0)')
parser.add_argument('--lead_time_days', type=int, default=20,
                    help='Días de lead time para cálculo de inventario (default: 20)')
parser.add_argument('--safety_stock', type=float, default=None,
                    help='Stock de seguridad fijo (opcional, si no se especifica se calcula dinámicamente)')
args = parser.parse_args()

# Diccionario de meses en español
SPANISH_MONTHS = {
    1: "ENE", 2: "FEB", 3: "MAR", 4: "ABR", 
    5: "MAY", 6: "JUN", 7: "JUL", 8: "AGO",
    9: "SEP", 10: "OCT", 11: "NOV", 12: "DIC"
}

# Configuración de logging
def setup_logging():
    """Configura el sistema de logging con nivel DEBUG para depuración."""
    logging.basicConfig(
        level=logging.DEBUG,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('prediction_log.txt', encoding='utf-8'),
            logging.StreamHandler(sys.stdout)
        ]
    )
    return logging.getLogger()

logger = setup_logging()

@dataclass
class HoltWintersParams:
    alpha: float = 0.3
    beta: float = 0.1
    gamma: float = 0.2
    seasonal_periods: int = 12
    seasonal: str = 'add'

@dataclass
class SerieData:
    codigo: str
    descripcion: str
    valores: List[float]
    fechas: List[datetime]
    es_valida: bool = True
    razon_invalida: str = ""

class DataCleaner:
    def __init__(self, min_periods=12, max_zeros_pct=0.5, outlier_threshold=1.5):
        self.min_periods = min_periods
        self.max_zeros_pct = max_zeros_pct
        self.outlier_threshold = outlier_threshold
    
    def clean_and_validate(self, series: List[SerieData]) -> List[SerieData]:
        cleaned_series = []
        valid_count = 0
        
        for serie in series:
            logger.debug(f"Validando serie para {serie.codigo}: {len(serie.valores)} períodos, valores={serie.valores[:5]}...")
            if self._validate(serie):
                cleaned = self._clean(serie)
                cleaned_series.append(cleaned)
                valid_count += 1
            else:
                logger.warning(f"Serie para {serie.codigo} inválida: {serie.razon_invalida}")
                cleaned_series.append(serie)
        
        logger.info(f"Series válidas: {valid_count}/{len(series)}")
        return cleaned_series
    
    def _validate(self, serie: SerieData) -> bool:
        vals = np.array(serie.valores)
        valid = True
        
        if len(vals) < self.min_periods:
            serie.razon_invalida = f"Insuficientes períodos ({len(vals)} < {self.min_periods})"
            valid = False
        elif np.mean(vals == 0) > self.max_zeros_pct:
            serie.razon_invalida = f"Demasiados ceros ({np.mean(vals == 0):.2%})"
            valid = False
        elif np.all(vals <= 0):
            serie.razon_invalida = "Sin valores positivos"
            valid = False
        elif np.std(vals, ddof=1) < 1e-6:
            serie.razon_invalida = f"Sin variabilidad (std={np.std(vals, ddof=1):.2e})"
            valid = False
            
        serie.es_valida = valid
        logger.debug(f"Validación para {serie.codigo}: {'Válida' if valid else 'Inválida'}, Razón: {serie.razon_invalida}")
        return valid
    
    def _clean(self, serie: SerieData) -> SerieData:
        vals = np.array(serie.valores)
        
        # Reemplazar negativos con 0
        vals = np.maximum(vals, 0)
        
        # Manejar ceros con interpolación
        zero_mask = vals == 0
        if zero_mask.any():
            vals[zero_mask] = np.nan
            vals = pd.Series(vals).interpolate(method='linear').ffill().bfill().values
        
        # Manejar outliers con IQR
        q1, q3 = np.percentile(vals[vals > 0], [25, 75]) if np.any(vals > 0) else (0, 0)
        iqr = q3 - q1
        if iqr > 0:
            lower, upper = q1 - self.outlier_threshold*iqr, q3 + self.outlier_threshold*iqr
            outlier_mask = (vals < lower) | (vals > upper)
            if outlier_mask.any():
                median = np.median(vals[~outlier_mask])
                vals[outlier_mask] = median
        
        serie.valores = vals.tolist()
        logger.debug(f"Serie limpia para {serie.codigo}: {serie.valores[:5]}...")
        return serie

class HoltWintersOptimized:
    def __init__(self, seasonal_periods=12):
        self.seasonal_periods = seasonal_periods
    
    def _determine_seasonality(self, data: np.ndarray) -> str:
        if len(data) < 2 * self.seasonal_periods:
            logger.debug("Datos insuficientes para determinar estacionalidad, usando aditiva")
            return 'add'
        
        n_seasons = len(data) // self.seasonal_periods
        truncated_length = n_seasons * self.seasonal_periods
        truncated_data = data[:truncated_length]
        
        try:
            seasonal_variation = np.std(truncated_data.reshape(n_seasons, self.seasonal_periods), axis=0)
            cv = np.mean(seasonal_variation) / np.mean(truncated_data) if np.mean(truncated_data) != 0 else 0
            logger.debug(f"Coeficiente de variación estacional: {cv:.3f}")
            return 'mul' if cv > 0.15 else 'add'
        except Exception as e:
            logger.warning(f"Error al calcular estacionalidad: {str(e)}, usando aditiva por defecto")
            return 'add'
    
    def _fit_model(self, data: np.ndarray, params: HoltWintersParams) -> Dict:
        alpha, beta, gamma = params.alpha, params.beta, params.gamma
        seasonal_type = params.seasonal
        n = len(data)
        m = self.seasonal_periods
        
        level, trend, seasonal, fitted = np.zeros(n), np.zeros(n), np.zeros(n), np.zeros(n)
        
        level[0] = np.mean(data[:m]) if n >= m else data[0]
        trend[0] = (np.mean(data[m:min(2*m, n)]) - np.mean(data[:m])) / m if n >= 2*m else 0
        
        if seasonal_type == 'add':
            seasonal[:m] = data[:m] - level[0]
        else:
            seasonal[:m] = np.where(level[0] != 0, data[:m] / level[0], 1)
        
        for t in range(1, n):
            prev_level = level[t-1]
            prev_trend = trend[t-1]
            seasonal_idx = t - m if t >= m else t
            
            if seasonal_type == 'add':
                level[t] = alpha * (data[t] - seasonal[seasonal_idx]) + (1 - alpha) * (prev_level + prev_trend)
                seasonal[t] = gamma * (data[t] - level[t]) + (1 - gamma) * seasonal[seasonal_idx]
                fitted[t] = prev_level + prev_trend + seasonal[seasonal_idx]
            else:
                level[t] = alpha * (data[t] / (seasonal[seasonal_idx] if seasonal[seasonal_idx] != 0 else 1)) + (1 - alpha) * (prev_level + prev_trend)
                seasonal[t] = gamma * (data[t] / (level[t] if level[t] != 0 else 1)) + (1 - gamma) * seasonal[seasonal_idx]
                fitted[t] = (prev_level + prev_trend) * seasonal[seasonal_idx]
            
            trend[t] = beta * (level[t] - prev_level) + (1 - beta) * prev_trend
        
        return {
            'level': level,
            'trend': trend,
            'seasonal': seasonal,
            'fitted': fitted,
            'seasonal_type': seasonal_type
        }
    
    def _generate_predictions(self, model: Dict, periods: int) -> List[float]:
        last_level = model['level'][-1]
        last_trend = model['trend'][-1]
        seasonal_component = model['seasonal'][-self.seasonal_periods:]
        seasonal_type = model.get('seasonal_type', 'add')
        
        predictions = []
        for h in range(1, periods + 1):
            if seasonal_type == 'add':
                pred = last_level + h * last_trend + seasonal_component[h % self.seasonal_periods]
            else:
                pred = (last_level + h * last_trend) * seasonal_component[h % self.seasonal_periods]
            
            pred = max(0, pred)
            if h > 1:
                pred = 0.8 * pred + 0.2 * predictions[-1]
            
            predictions.append(pred)
        
        return predictions
    
    def fit_predict(self, data: List[float], forecast_periods: int = 6, last_date: datetime = None, dias_operacion: int = 22) -> Dict:
        try:
            data_array = np.array(data, dtype=float)
            logger.debug(f"Ajustando Holt-Winters para datos: {data_array[:5]}... (len={len(data_array)})")
            
            params = HoltWintersParams()
            seasonal_type = self._determine_seasonality(data_array)
            params.seasonal = seasonal_type
            logger.debug(f"Tipo de estacionalidad: {seasonal_type}")
            
            model = self._fit_model(data_array, params)
            predictions = self._generate_predictions(model, forecast_periods)
            
            fitted = model['fitted']
            errors = data_array - fitted
            safe_actual = np.where(data_array == 0, 1e-10, data_array)
            metrics = {
                'mae': float(np.mean(np.abs(errors))),
                'rmse': float(np.sqrt(np.mean(errors**2))),
                'mape': float(np.mean(np.abs(errors / safe_actual)) * 100),
                'mse': float(np.mean(errors**2))
            }
            logger.debug(f"Métricas: MAPE={metrics['mape']:.2f}%, RMSE={metrics['rmse']:.2f}")
            
            monthly_consumptions = []
            current_date = last_date + relativedelta(months=1)
            for i, monthly_pred in enumerate(predictions):
                month_date = current_date + relativedelta(months=i)
                monthly_consumptions.append({
                    'month': f"{SPANISH_MONTHS[month_date.month]}-{month_date.year}",
                    'yhat': float(max(0, round(monthly_pred, 2)))
                })
            
            return {
                'monthly_consumptions': monthly_consumptions,
                'fitted': fitted.tolist(),
                'params': params.__dict__,
                'metrics': metrics,
                'seasonal_type': seasonal_type
            }
        
        except Exception as e:
            logger.error(f"Error al ajustar Holt-Winters: {str(e)}")
            avg = np.mean(data_array[data_array > 0]) if np.any(data_array > 0) else 0
            monthly_avg = avg if avg > 0 else 0
            monthly_consumptions = []
            current_date = last_date + relativedelta(months=1)
            params = HoltWintersParams()
            for i in range(forecast_periods):
                month_date = current_date + relativedelta(months=i)
                monthly_consumptions.append({
                    'month': f"{SPANISH_MONTHS[month_date.month]}-{month_date.year}",
                    'yhat': float(max(0, round(monthly_avg, 2)))
                })
            return {
                'monthly_consumptions': monthly_consumptions,
                'fitted': [float(monthly_avg)] * len(data),
                'params': params.__dict__,
                'metrics': {'mae': 0.0, 'rmse': 0.0, 'mape': 0.0, 'mse': 0.0},
                'seasonal_type': 'add'
            }

def generar_predicciones_holt_winters(series: List[SerieData], ultima_fecha: datetime, forecast_horizon: int = 6, dias_operacion: int = 22) -> Dict:
    resultados = {}
    mape_total = 0.0
    count = 0
    predictor = HoltWintersOptimized(seasonal_periods=12)
    
    for serie in series:
        logger.debug(f"Procesando serie para {serie.codigo}")
        if not serie.es_valida:
            logger.warning(f"Serie {serie.codigo} no válida, omitiendo Holt-Winters")
            continue
        try:
            result = predictor.fit_predict(
                serie.valores, 
                forecast_periods=forecast_horizon,
                last_date=ultima_fecha,
                dias_operacion=dias_operacion
            )
            monthly_consumptions = result['monthly_consumptions']
            metrics = result['metrics']
            params = result['params']
            
            logger.info(f"Producto {serie.codigo} - Parámetros: alpha={params['alpha']}, beta={params['beta']}, gamma={params['gamma']}, seasonal={params['seasonal']}")
            logger.info(f"Producto {serie.codigo} - Métricas: MAPE={metrics['mape']:.2f}%, RMSE={metrics['rmse']:.2f}")
            logger.info(f"Producto {serie.codigo} - Consumos mensuales previstos: {[{mc['month']: mc['yhat']} for mc in monthly_consumptions]}")
            
            resultados[serie.codigo] = {
                'monthly_consumptions': monthly_consumptions,
                'params': params,
                'metrics': metrics
            }
            
            if metrics['mape'] < 100:
                mape_total += metrics['mape']
                count += 1
        
        except Exception as e:
            logger.error(f"Error al predecir para {serie.codigo}: {str(e)}")
    
    if count > 0:
        mape_promedio = mape_total / count
        logger.info(f"MAPE promedio: {mape_promedio:.2f}%")
        if mape_promedio <= 10:
            logger.info("La precisión cumple con el requisito de error menor al 10%")
        else:
            logger.warning("La precisión NO cumple con el requisito de error menor al 10%")
    else:
        logger.warning("No se calcularon MAPE: datos insuficientes")
    
    logger.info("Nota: Los consumos mensuales previstos se encuentran en el campo 'CONSUMOS_MENSUALES_PREVISTOS' del JSON de salida para cada producto.")
    logger.debug(f"Predicciones generadas para {len(resultados)} productos: {list(resultados.keys())}")
    
    return resultados

def normalizar_nombre_columna(col):
    col = re.sub(r'\s+', ' ', col.strip().upper().replace("\n", " ").replace("/", ""))
    return col

def encontrar_columna(df, nombres_posibles):
    df_cols_normalized = {normalizar_nombre_columna(col): col for col in df.columns}
    for nombre in nombres_posibles:
        nombre_normalized = normalizar_nombre_columna(nombre)
        if nombre_normalized in df_cols_normalized:
            return df_cols_normalized[nombre_normalized]
    return None

def parsear_fecha_excel(fecha_celda):
    try:
        if isinstance(fecha_celda, (datetime, pd.Timestamp)):
            return fecha_celda
        
        meses_espanol = {
            'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6,
            'jul': 7, 'ago': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dic': 12
        }
        
        fecha_str = str(fecha_celda).strip().lower()
        
        if '/' in fecha_str:
            partes = fecha_str.split('/')
            if len(partes) == 3:
                dia, mes, anio = partes
                mes_num = None
                if mes[:3] in meses_espanol:
                    mes_num = meses_espanol[mes[:3]]
                else:
                    try:
                        mes_num = int(mes)
                    except ValueError:
                        pass
                
                if mes_num:
                    anio_completo = 2000 + int(anio) if len(anio) == 2 else int(anio)
                    return datetime(anio_completo, mes_num, int(dia))
        
        try:
            return pd.to_datetime(fecha_str)
        except:
            pass
        
        return None
        
    except Exception as e:
        logger.error(f"Error al parsear fecha: {str(e)}")
        return None
def identificar_columnas_consumo(df):
    # Identify columns that match the pattern "MMM YYYY" (e.g., "AGO 2023")
    cols_consumo = [col for col in df.columns if re.match(r'^\w{3}\s+\d{4}$', col.strip().upper())]
    
    if not cols_consumo:
        raise ValueError("No se encontraron columnas de consumo en el archivo")
    
    fechas_consumo = []
    for col in cols_consumo:
        try:
            partes = col.split()
            if len(partes) == 2:
                mes_abr = partes[0].upper()
                año = int(partes[1])
                
                mes_num = next((num for num, abr in SPANISH_MONTHS.items() if abr.upper() == mes_abr), None)
                
                if mes_num:
                    fecha = datetime(año, mes_num, 1)
                    fechas_consumo.append((col, fecha))
        except Exception as e:
            logger.warning(f"No se pudo parsear la columna {col}: {str(e)}")
            continue
    
    fechas_consumo.sort(key=lambda x: x[1])
    cols_ordenadas = [item[0] for item in fechas_consumo]
    ultima_fecha = fechas_consumo[-1][1] if fechas_consumo else None
    
    logger.info(f"Se detectaron {len(cols_ordenadas)} columnas de consumo. Última fecha: {ultima_fecha.strftime('%Y-%m-%d') if ultima_fecha else 'No determinada'}")
    
    return cols_ordenadas, ultima_fecha

def cargar_datos():
    try:
        logger.info(f"Cargando archivo Excel: {os.path.abspath(args.excel)}")
        if not os.path.exists(args.excel):
            raise FileNotFoundError(f"Archivo no encontrado: {args.excel}")
        
        fecha_df = pd.read_excel(args.excel, header=None, nrows=2)
        fecha_celda = fecha_df.iloc[1, 0]
        fecha_inicio_prediccion = parsear_fecha_excel(fecha_celda) or datetime(2025, 2, 14)
        
        df = pd.read_excel(args.excel, skiprows=2)
        df.columns = [col.strip().replace("\n", " ") for col in df.columns]
        cols_to_drop = [col for col in df.columns if "Unnamed" in col]
        if cols_to_drop:
            df = df.drop(columns=cols_to_drop)
        
        cols_consumo, ultima_fecha = identificar_columnas_consumo(df)
        
        columnas_basicas = {
            "CODIGO": ["CODIGO", "CÓDIGO", "CODE"],
            "DESCRIPCION": ["DESCRIPCION", "DESCRIPCIÓN", "DESCRIPTION"],
            "UNID/CAJA": ["UNID/CAJA", "UNIDAD/CAJA", "UNIDADESPECIALESCAJA", "UNID CAJA", "UNIDAD CAJA"],
            "STOCK INICIAL": ["STOCK INICIAL", "STOCK INICIAL", "STOCK_INICIAL"],
            "STOCK TOTAL": ["STOCK TOTAL", "STOCK  TOTAL", "STOCK   TOTAL", "STOCK_TOTAL", "STOCK"],
            "UNIDADES EN TRANSITO": ["UNIDADES EN TRANSITO", "UNIDADES EN TRÁNSITO", "UNIDADES TRANSITO"]
        }
        
        columnas_encontradas = {}
        missing_cols = []
        for key, posibles in columnas_basicas.items():
            col_encontrada = encontrar_columna(df, posibles)
            if col_encontrada:
                columnas_encontradas[key] = col_encontrada
            else:
                missing_cols.append(key)
        
        if missing_cols:
            raise ValueError(f"Columnas básicas faltantes: {missing_cols}")
        
        rename_dict = {v: k for k, v in columnas_encontradas.items()}
        df = df.rename(columns=rename_dict)
        
        df["STOCK_INICIAL"] = df["STOCK INICIAL"].astype(float)
        df["STOCK_TOTAL"] = df["STOCK TOTAL"].astype(float)
        
        df[["CODIGO", "DESCRIPCION"]] = df[["CODIGO", "DESCRIPCION"]].fillna("")
        
        return df, cols_consumo, ultima_fecha, fecha_inicio_prediccion
    except Exception as e:
        logger.error(f"Error en carga de datos: {str(e)}")
        sys.exit(1)

def preparar_series(df: pd.DataFrame, cols_consumo: List[str]) -> List[SerieData]:
    series = []
    for _, row in df.iterrows():
        codigo = str(row.get('CODIGO', '')).strip()
        descripcion = str(row.get('DESCRIPCION', ''))
        
        valores = []
        fechas = []
        for col in cols_consumo:
            valor = row[col]
            try:
                valores.append(float(valor) if not pd.isna(valor) else 0.0)
            except (ValueError, TypeError):
                logger.warning(f"Valor no numérico en {col} para {codigo}: {valor}, usando 0.0")
                valores.append(0.0)
            
            parts = col.split()
            if len(parts) >= 3:
                month_abr = parts[1].upper()
                year = int(parts[2])
                month = next((k for k, v in SPANISH_MONTHS.items() if v == month_abr), 1)
                fechas.append(datetime(year, month, 1))
            else:
                fechas.append(datetime(1900, 1, 1))
        
        series.append(SerieData(
            codigo=codigo,
            descripcion=descripcion,
            valores=valores,
            fechas=fechas
        ))
        logger.debug(f"Serie preparada para {codigo}: {len(valores)} valores, primeros 5={valores[:5]}")
    return series

def sumar_dias(fecha_inicio, dias):
    return fecha_inicio + timedelta(days=dias)

def calcular_predicciones(df, cols_consumo, ultima_fecha, fecha_inicio_prediccion, dias_transito, holt_winters_predictions=None,
                         service_level=99.99, dias_operacion=22, min_unidades_caja=1.0, lead_time_days=20, safety_stock=None,
                         SPANISH_MONTHS=None, logger=None, max_dias_reposicion=22, dias_consumo_mensual=22):
    """
    Calcula proyecciones de inventario para un SKU usando una política de revisión continua basada en stock total proyectado.
    Permite especificar un lead time específico para cada alerta o pedido.
    """
    try:
        if logger is None:
            logger = logging.getLogger(__name__)

        logger.info(f"Iniciando cálculos de predicciones para {fecha_inicio_prediccion}")

        if SPANISH_MONTHS is None:
            SPANISH_MONTHS = {1: 'ENE', 2: 'FEB', 3: 'MAR', 4: 'ABR', 5: 'MAY', 6: 'JUN',
                              7: 'JUL', 8: 'AGO', 9: 'SEP', 10: 'OCT', 11: 'NOV', 12: 'DIC'}

        numeric_cols = [col for col in df.columns if col not in ["CODIGO", "DESCRIPCION"]]
        df[numeric_cols] = df[numeric_cols].apply(pd.to_numeric, errors='coerce').fillna(0.0)
        df["UNID/CAJA"] = df["UNID/CAJA"].replace(0, 1.0).astype(float)

        df["PROM CONSU"] = df[cols_consumo].mean(axis=1).astype(float)
        df["DIARIO"] = df["PROM CONSU"] / dias_operacion
        df["CONSUMO_LEADTIME"] = df["DIARIO"] * lead_time_days

        if len(cols_consumo) > 1:
            df["SIGMA_D"] = df[cols_consumo].std(axis=1).fillna(0.0) / np.sqrt(dias_operacion)
        else:
            df["SIGMA_D"] = 0.0
        df["SIGMA_LT"] = df["SIGMA_D"] * np.sqrt(lead_time_days)

        if safety_stock is not None:
            logger.info(f"Usando stock de seguridad fijo: {safety_stock}")
            df["SS"] = float(safety_stock)
            df["SS_SOURCE"] = "Manual"
        else:
            z = norm.ppf(service_level / 100)
            df["SS"] = z * df["SIGMA_LT"]
            df["SS_SOURCE"] = "Calculado"

        df["ROP"] = df["DIARIO"] * lead_time_days + df["SS"]
        df["UNID/CAJA"] = df["UNID/CAJA"].apply(lambda x: max(x, min_unidades_caja))
        df["STOCK MINIMO (Prom + SS)"] = df["PROM CONSU"] + df["SS"]

        resultados_completos = []
        fecha_actual = ultima_fecha + relativedelta(months=1)

        for _, row in df.iterrows():
            if not isinstance(row["CODIGO"], str) or row["CODIGO"] == "":
                continue
            codigo = str(row["CODIGO"]).strip()
            logger.debug(f"Calculando predicciones para {codigo}")

            stock_inicial = float(row["STOCK_INICIAL"])
            stock_total = float(row["STOCK_TOTAL"])
            consumo_diario_inicial = float(row["DIARIO"])
            punto_reorden = float(row["ROP"])
            stock_seguridad = float(row["SS"])
            stock_minimo = float(row["STOCK MINIMO (Prom + SS)"])
            consumo_leadtime = float(row["CONSUMO_LEADTIME"])
            ss_source = row["SS_SOURCE"]
            unidades_caja = float(row["UNID/CAJA"])

            unidades_en_transito = 0.0
            pedidos_por_llegar = []

            proyecciones = []
            monthly_consumptions = []
            if holt_winters_predictions and codigo in holt_winters_predictions:
                monthly_consumptions = holt_winters_predictions[codigo]['monthly_consumptions']
                logger.debug(f"Consumos mensuales Holt-Winters para {codigo}: {[mc['yhat'] for mc in monthly_consumptions]}")

            for mes in range(6):
                month_date = fecha_actual + relativedelta(months=mes)
                end_date = month_date + relativedelta(months=1) - timedelta(days=1)
                days_in_month = min((end_date - month_date + timedelta(days=1)).days, dias_consumo_mensual)

                consumo_mensual = None
                prediccion_usada = False
                if holt_winters_predictions and codigo in holt_winters_predictions:
                    for mc in monthly_consumptions:
                        if mc['month'] == f"{SPANISH_MONTHS[month_date.month]}-{month_date.year}":
                            consumo_mensual = float(mc['yhat'])
                            prediccion_usada = True
                            logger.info(f"Producto {codigo}, Mes {month_date.strftime('%Y-%m')}: Predicción Holt-Winters = {consumo_mensual:.2f}")
                            break

                if not consumo_mensual:
                    historicos_mes = []
                    mes_historico = f"{SPANISH_MONTHS.get(month_date.month, 'ENE').upper()[:3]}"
                    for col in cols_consumo:
                        if mes_historico in col and pd.notna(row.get(col, np.nan)):
                            try:
                                val = float(row[col])
                                if val > 0:
                                    historicos_mes.append(val)
                            except (ValueError, TypeError):
                                continue
                    consumo_mensual = float(np.mean(historicos_mes)) if historicos_mes else float(row["PROM CONSU"])
                    logger.warning(f"Producto {codigo}, Mes {month_date.strftime('%Y-%m')}: Promedio histórico = {consumo_mensual:.2f}")

                consumo_diario = consumo_mensual / dias_consumo_mensual
                stock_inicial_mes = stock_total if mes == 0 else proyecciones[-1].get('stock_proyectado_mes', stock_total)
                stock_proyectado = stock_inicial_mes
                consumo_acumulado = 0.0

                stock_diario_proyectado = []
                alertas_registradas = []

                current_date = month_date
                while current_date <= end_date:
                    # Recibir pedidos que llegan en esta fecha
                    pedidos_recibidos = 0.0
                    pedidos_a_eliminar = []
                    for pedido in pedidos_por_llegar:
                        if pedido['fecha_arribo'].date() <= current_date.date():
                            pedidos_recibidos += float(pedido['unidades'])
                            pedidos_a_eliminar.append(pedido)
                            logger.debug(f"Recibiendo {pedido['unidades']} unidades en {current_date.strftime('%Y-%m-%d')}")

                    if pedidos_recibidos > 0:
                        stock_proyectado += pedidos_recibidos
                        for pedido in pedidos_a_eliminar:
                            pedidos_por_llegar.remove(pedido)

                    # Restar consumo diario
                    consumo_dia = consumo_diario
                    consumo_acumulado += consumo_dia
                    stock_proyectado = max(stock_proyectado - consumo_dia, 0.0)

                    # Calcular stock total proyectado después del consumo
                    stock_total_proyectado = stock_proyectado + sum(p['unidades'] for p in pedidos_por_llegar)

                    # Generar alerta y pedido si stock total proyectado <= ROP
                    if stock_total_proyectado <= punto_reorden:
                        fecha_alerta = current_date
                        # Usar lead_time_especifico si está definido, de lo contrario usar lead_time_days
                        lead_time_especifico = lead_time_days  # Aquí podrías definir una lógica para obtener un lead_time específico
                        # Ejemplo: lead_time_especifico = obtener_lead_time_especifico(fecha_alerta, codigo)
                        fecha_arribo = current_date + timedelta(days=lead_time_especifico)
                        consumo_leadtime_periodo = consumo_diario * lead_time_especifico
                        punto_reorden = consumo_diario * lead_time_especifico + stock_seguridad
                        deficit = punto_reorden - stock_total_proyectado + consumo_leadtime_periodo
                        cajas_a_pedir = int(float(np.ceil(deficit / unidades_caja)))
                        unidades_a_pedir = float(cajas_a_pedir * unidades_caja)
                        if unidades_a_pedir > 0:
                            pedidos_por_llegar.append({
                                'fecha_arribo': fecha_arribo,
                                'unidades': unidades_a_pedir
                            })
                            alertas_registradas.append({
                                'fecha_alerta': fecha_alerta.strftime("%Y-%m-%d"),
                                'fecha_arribo': fecha_arribo.strftime("%Y-%m-%d"),
                                'unidades': unidades_a_pedir,
                                'cajas_pedir': cajas_a_pedir,
                                'lead_time_especifico': int(lead_time_especifico)
                            })
                            logger.debug(f"Pedido generado para {codigo} en {fecha_alerta.strftime('%Y-%m-%d')}: {unidades_a_pedir} unidades, llega {fecha_arribo.strftime('%Y-%m-%d')} con lead time {lead_time_especifico}")

                    # Registrar el estado diario después del consumo y posible pedido
                    stock_diario_proyectado.append({
                        'fecha': current_date.strftime("%Y-%m-%d"),
                        'stock_proyectado': float(round(stock_proyectado, 2)),
                        'unidades_en_transito': float(round(sum(p['unidades'] for p in pedidos_por_llegar), 2)),
                        'stock_total_proyectado': float(round(stock_total_proyectado, 2))
                    })

                    # Avanzar al siguiente día
                    current_date += timedelta(days=1)

                riesgo = "Bajo" if stock_proyectado > punto_reorden else "Medio" if stock_proyectado > stock_seguridad else "Alto"
                info_mes = {
                    "mes": f"{SPANISH_MONTHS[month_date.month]}-{month_date.year}",
                    "fecha_inicio_mes": month_date.strftime("%Y-%m-%d"),
                    "fecha_fin_mes": end_date.strftime("%Y-%m-%d"),
                    "stock_inicial_mes": float(round(stock_inicial_mes, 2)),
                    "stock_proyectado_mes": float(round(stock_proyectado, 2)),
                    "stock_total_proyectado": float(round(stock_proyectado + sum(p['unidades'] for p in pedidos_por_llegar), 2)),
                    "consumo_mensual": float(round(consumo_mensual, 2)),
                    "consumo_diario": float(round(consumo_diario, 2)),
                    "stock_seguridad": float(round(stock_seguridad, 2)),
                    "stock_seguridad_source": ss_source,
                    "stock_minimo": float(round(stock_minimo, 2)),
                    "punto_reorden": float(round(punto_reorden, 2)),
                    "unidades_en_transito": float(round(sum(p['unidades'] for p in pedidos_por_llegar), 2)),
                    "stock_diario_proyectado": stock_diario_proyectado,
                    "alertas_y_pedidos": alertas_registradas,
                    "tiempo_cobertura": float(round(stock_proyectado / consumo_diario, 2)) if consumo_diario > 0 else 0.0,
                    "frecuencia_reposicion": float(round(lead_time_days, 2)),
                    "dias_consumo_mensual": int(dias_consumo_mensual),
                    "stock_total": float(round(stock_total, 2)),
                    "lead_time_days": int(lead_time_days),
                    "prediccion_usada": prediccion_usada,
                    "indicador_riesgo": riesgo
                }
                proyecciones.append(info_mes)

                # Validación: Asegurar que stock_proyectado_mes coincide con el último stock_diario_proyectado
                if stock_diario_proyectado:
                    ultimo_stock_diario = stock_diario_proyectado[-1]['stock_proyectado']
                    if abs(info_mes['stock_proyectado_mes'] - ultimo_stock_diario) > 0.01:
                        logger.warning(f"Inconsistencia en {codigo} para {info_mes['mes']}: stock_proyectado_mes ({info_mes['stock_proyectado_mes']}) no coincide con último stock_diario_proyectado ({ultimo_stock_diario})")

            holt_winters_info = {}
            if holt_winters_predictions and codigo in holt_winters_predictions:
                pred_data = holt_winters_predictions[codigo]
                holt_winters_info = {
                    "PARAMETROS": {
                        "alpha": float(pred_data['params']['alpha']),
                        "beta": float(pred_data['params']['beta']),
                        "gamma": float(pred_data['params']['gamma']),
                        "seasonal": pred_data['params']['seasonal'],
                        "seasonal_periods": int(pred_data['params']['seasonal_periods'])
                    },
                    "METRICAS": {
                        "mae": float(round(pred_data['metrics']['mae'], 2)),
                        "rmse": float(round(pred_data['metrics']['rmse'], 2)),
                        "mape": float(round(pred_data['metrics']['mape'], 2)),
                        "mse": float(round(pred_data['metrics']['mse'], 2))
                    }
                }

            producto_info = {
                "CODIGO": codigo,
                "DESCRIPCION": str(row["DESCRIPCION"]),
                "FECHA_INICIAL": fecha_actual.strftime('%Y-%m-%d'),
                "UNIDADES_POR_CAJA": float(unidades_caja),
                "STOCK_INICIAL": float(stock_inicial),
                "UNIDADES_EN_TRANSITO": float(unidades_en_transito),
                "STOCK_TOTAL": float(stock_total),
                "CONSUMO_PROMEDIO": float(row["PROM CONSU"]),
                "CONSUMO_LEADTIME": float(consumo_leadtime),
                "CONSUMO_PROYECTADO": float(row["PROM CONSU"]),
                "CONSUMO_TOTAL": float(row["PROM CONSU"]),
                "CONSUMO_DIARIO": float(consumo_diario_inicial),
                "SIGMA_D": float(row.get("SIGMA_D", 0.0)),  # <-- AÑADE ESTA LÍNEA
                "STOCK_SEGURIDAD": float(stock_seguridad),
                "STOCK_SEGURIDAD_SOURCE": ss_source,
                "STOCK_MINIMO": float(row["PROM CONSU"] + stock_seguridad),
                "PUNTO_REORDEN": float(punto_reorden),
                "DEFICIT": float(max(punto_reorden - stock_total, 0.0)),
                "CAJAS_A_PEDIR": int(float(np.ceil(max(punto_reorden - stock_total, 0.0) / unidades_caja))),
                "UNIDADES_A_PEDIR": float(np.ceil(max(punto_reorden - stock_total, 0.0) / unidades_caja) * unidades_caja),
                "CONSUMOS_MENSUALES_PREVISTOS": [
                    {"month": mc["month"], "yhat": float(mc["yhat"])} for mc in monthly_consumptions
                ],
                "STOCK_PROYECTADO_ALTERNATIVO": float(round(max(stock_total - consumo_leadtime, 0.0), 2)),
                "DIAS_COBERTURA": float(round(stock_total / consumo_diario_inicial, 2)) if consumo_diario_inicial > 0 else 0.0,
                "FRECUENCIA_REPOSICION": float(round(punto_reorden / consumo_diario_inicial, 2)) if consumo_diario_inicial > 0 else 0.0,
                "STOCK_ACTUAL_AJUSTADO": float(round(stock_total, 2)),
                "HISTORICO_CONSUMOS": {col.split()[1] + "_" + col.split()[2]: float(row[col]) for col in cols_consumo if len(col.split()) >= 3},
                "PROYECCIONES": proyecciones,
                "CONFIGURACION": {
                    "NIVEL_SERVICIO": float(service_level),
                    "DIAS_OPERACION": int(dias_operacion),
                    "MIN_UNIDADES_CAJA": float(min_unidades_caja),
                    "LEAD_TIME_DAYS": int(lead_time_days),
                    "SAFETY_STOCK": float(safety_stock) if safety_stock is not None else None,
                    "SAFETY_STOCK_SOURCE": ss_source,
                    "DIAS_CONSUMO_MENSUAL": int(dias_consumo_mensual),
                    "DIAS_TRANSITO": int(dias_transito),
                    "VERSION_MODELO": "continuous-review-monthly"
                },
                "PEDIDOS_POR_LLEGAR": [
                    {"fecha_arribo": p['fecha_arribo'].strftime('%Y-%m-%d'), "unidades": float(p['unidades'])} for p in pedidos_por_llegar
                ],
                "HOLT_WINTERS_INFO": holt_winters_info
            }

            resultados_completos.append(producto_info)

        return df, resultados_completos

    except Exception as e:
        logger.error(f"Error en cálculos: {str(e)}")
        raise

def es_nan(valor):
    if valor is None:
        return True
    if isinstance(valor, (str, bool, int, dict, list)):
        if isinstance(valor, str) and valor.strip() == "":
            return True
        return False
    if isinstance(valor, float) and (np.isnan(valor) or np.isinf(valor)):
        return True
    if isinstance(valor, (np.ndarray, pd.Series)):
        return np.any(np.isnan(valor)) or np.any(np.isinf(valor))
    if isinstance(valor, pd.DataFrame):
        return valor.isna().any().any()
    return pd.isna(valor)

def corregir_valores_nan(data):
    try:
        if isinstance(data, dict):
            result = {}
            for key, value in data.items():
                if es_nan(value):
                    if key in ["CODIGO", "DESCRIPCION"]:
                        result[key] = "Sin información"
                    elif key.startswith(("CONS_", "STOCK_", "PUNTO_", "DEFICIT", "CAJA", "UNIDAD")):
                        result[key] = 0.0
                    elif isinstance(value, (int, float, np.floating)):
                        result[key] = 0.0
                    elif isinstance(value, (list, np.ndarray), pd.Series):
                        result[key] = [0.0 if es_nan(v) else float(v) for v in value]
                    else:
                        result[key] = "Sin información"
                else:
                    result[key] = corregir_valores_nan(value)
            return result
        elif isinstance(data, list):
            return [corregir_valores_nan(item) for item in data if item is not None]
        elif isinstance(data, (np.ndarray, pd.Series)):
            return [corregir_valores_nan(item) for item in data.tolist()]
        elif isinstance(data, float) and (np.isnan(data) or np.isinf(data)):
            return 0.0
        elif isinstance(data, (bool, int, str)):
            return data
        elif isinstance(data, (datetime, pd.Timestamp)):
            return data.strftime('%Y-%m-%d')
        else:
            return data
    except Exception as e:
        logger.error(f"Error al corregir valores NaN: {str(e)}")
        return data

def guardar_resultados(resultados_completos):
    try:
        output_dir = os.path.join(os.path.dirname(__file__), '../data')
        os.makedirs(output_dir, exist_ok=True)
        
        resultados_validados = corregir_valores_nan(resultados_completos)
        
        output_path = os.path.join(output_dir, 'predicciones_completas.json')
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(resultados_validados, f, indent=4, ensure_ascii=False, default=str)
        logger.info(f"Salida JSON guardada en {output_path}")
        
        output_path_min = os.path.join(output_dir, 'predicciones_completas.min.json')
        with open(output_path_min, 'w', encoding='utf-8') as f:
            json.dump(resultados_validados, f, ensure_ascii=False, default=str)
        logger.info(f"Salida JSON minificada guardada en {output_path_min}")
        
        excel_path = os.path.join(output_dir, 'predicciones_completas.xlsx')
        logger.info(f"Generando archivo Excel en {excel_path}")
        
        proyecciones_data = []
        for producto in resultados_completos:
            codigo = producto.get('CODIGO', 'Sin información')
            descripcion = producto.get('DESCRIPCION', 'Sin información')
            for proyeccion in producto.get('PROYECCIONES', []):
                proyecciones_data.append({
                    'Código': codigo,
                    'Descripción': descripcion,
                    'Período': proyeccion.get('periodo', ''),
                    'Fecha Solicitud': proyeccion.get('fecha_solicitud', ''),
                    'Fecha Fin Período': proyeccion.get('fecha_fin', ''),
                    'Consumo Período': proyeccion.get('consumo_periodo', 0.0),
                    'Consumo Mensual': proyeccion.get('consumo_mensual', 0.0),
                    'Stock Inicial': proyeccion.get('stock_inicial', 0.0),
                    'Stock Proyectado': proyeccion.get('stock_proyectado', 0.0),
                    'Déficit': proyeccion.get('deficit', 0.0),
                    'Cajas a Pedir': proyeccion.get('cajas_a_pedir', 0),
                    'Unidades a Pedir': proyeccion.get('unidades_a_pedir', 0.0),
                    'Pedidos Recibidos': proyeccion.get('pedidos_recibidos', 0.0),
                    'Alerta Stock': proyeccion.get('alerta_stock', False),
                    'Fecha Reposición': proyeccion.get('fecha_reposicion', ''),
                    'Tiempo Cobertura': proyeccion.get('tiempo_cobertura', 0.0),
                    'Predicción Usada': proyeccion.get('prediccion_usada', False)
                })
        
        df_proyecciones = pd.DataFrame(proyecciones_data)
        
        with pd.ExcelWriter(excel_path, engine='openpyxl') as writer:
            df_proyecciones.to_excel(writer, sheet_name='Proyecciones', index=False)
        
        logger.info(f"Archivo Excel guardado exitosamente en {excel_path}")
        
    except Exception as e:
        logger.error(f"Error al guardar resultados: {str(e)}")
        sys.exit(1)

def main():
    try:
        logger.info("=== INICIANDO PROCESO ===")
        
        df, cols_consumo, ultima_fecha_df, fecha_inicio_prediccion = cargar_datos()
        
        series = preparar_series(df, cols_consumo)
        
        cleaner = DataCleaner(min_periods=12, max_zeros_pct=0.5)
        series_limpias = cleaner.clean_and_validate(series)
        
        holt_winters_predictions = generar_predicciones_holt_winters(
            series_limpias, 
            ultima_fecha_df,
            dias_operacion=args.dias_operacion
        )
        
        df, resultados = calcular_predicciones(
            df, cols_consumo, ultima_fecha_df, 
            fecha_inicio_prediccion, args.dias_transito, holt_winters_predictions,
            service_level=args.service_level,
            dias_operacion=args.dias_operacion,
            min_unidades_caja=args.min_unidades_caja,
            lead_time_days=args.lead_time_days,
            safety_stock=args.safety_stock,
            SPANISH_MONTHS=SPANISH_MONTHS,
            logger=logger
        )
        
        guardar_resultados(resultados)
        
        logger.info("=== PROCESO FINALIZADO ===")
        sys.exit(0)
        
    except Exception as e:
        logger.error(f"Error general: {str(e)}")
        sys.exit(1)

if __name__ == '__main__':
    main()