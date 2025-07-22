import pandas as pd
import numpy as np
import json
import os
import sys
import re
import argparse
import logging
from datetime import datetime
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
from scipy.optimize import minimize
import warnings
warnings.filterwarnings('ignore')

# Configurar logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Constantes
SPANISH_MONTHS = {
    1: 'ENE', 2: 'FEB', 3: 'MAR', 4: 'ABR', 5: 'MAY', 6: 'JUN',
    7: 'JUL', 8: 'AGO', 9: 'SEP', 10: 'OCT', 11: 'NOV', 12: 'DIC'
}

@dataclass
class HoltWintersParams:
    """Parámetros del modelo Holt-Winters"""
    alpha: float
    beta: float
    gamma: float
    seasonal_periods: int
    trend: str = 'add'  # 'add' o 'mul'
    seasonal: str = 'add'  # 'add' o 'mul'

@dataclass
class SerieData:
    """Datos de una serie temporal"""
    codigo: str
    descripcion: str
    valores: List[float]
    fechas: List[datetime]
    es_valida: bool = True
    razon_invalida: str = ""

@dataclass
class Prediccion:
    """Resultado de predicción para un SKU"""
    codigo: str
    descripcion: str
    modelo_usado: str
    parametros: Dict
    predicciones: List[Dict]
    metricas: Dict
    serie_historica: List[Dict]

class DataCleaner:
    """Clase para limpiar y validar datos de series temporales"""
    
    def __init__(self, min_periods: int = 24, max_zeros_pct: float = 0.3, 
                 outlier_threshold: float = 3.0):
        self.min_periods = min_periods
        self.max_zeros_pct = max_zeros_pct
        self.outlier_threshold = outlier_threshold
    
    def clean_and_validate_series(self, series_data: List[SerieData]) -> List[SerieData]:
        """Limpia y valida todas las series de datos"""
        cleaned_series = []
        
        for serie in series_data:
            if self._validate_series(serie):
                cleaned_serie = self._clean_series(serie)
                cleaned_series.append(cleaned_serie)
            else:
                serie.es_valida = False
                cleaned_series.append(serie)
        
        logger.info(f"Series válidas: {sum(1 for s in cleaned_series if s.es_valida)}/{len(cleaned_series)}")
        return cleaned_series
    
    def _validate_series(self, serie: SerieData) -> bool:
        """Valida si una serie es apta para predicción"""
        valores = np.array(serie.valores)
        
        # Verificar longitud mínima
        if len(valores) < self.min_periods:
            serie.razon_invalida = f"Insuficientes períodos ({len(valores)} < {self.min_periods})"
            return False
        
        # Verificar porcentaje de ceros
        zeros_pct = np.sum(valores == 0) / len(valores)
        if zeros_pct > self.max_zeros_pct:
            serie.razon_invalida = f"Demasiados ceros ({zeros_pct:.2%} > {self.max_zeros_pct:.2%})"
            return False
        
        # Verificar si hay valores positivos
        if np.all(valores <= 0):
            serie.razon_invalida = "Todos los valores son cero o negativos"
            return False
        
        # Verificar variabilidad mínima
        if np.std(valores) == 0:
            serie.razon_invalida = "Serie constante (sin variabilidad)"
            return False
        
        return True
    
    def _clean_series(self, serie: SerieData) -> SerieData:
        """Limpia una serie individual"""
        valores = np.array(serie.valores)
        
        # Reemplazar valores negativos con 0
        valores = np.maximum(valores, 0)
        
        # Detectar y tratar outliers
        valores = self._treat_outliers(valores)
        
        # Interpolar valores faltantes (NaN)
        valores = self._interpolate_missing(valores)
        
        serie.valores = valores.tolist()
        return serie
    
    def _treat_outliers(self, valores: np.ndarray) -> np.ndarray:
        """Trata valores atípicos usando el método IQR"""
        # Calcular solo con valores positivos
        positive_values = valores[valores > 0]
        if len(positive_values) < 4:
            return valores
        
        Q1 = np.percentile(positive_values, 25)
        Q3 = np.percentile(positive_values, 75)
        IQR = Q3 - Q1
        
        lower_bound = Q1 - self.outlier_threshold * IQR
        upper_bound = Q3 + self.outlier_threshold * IQR
        
        # Reemplazar outliers con la mediana
        median_val = np.median(positive_values)
        valores_clean = valores.copy()
        valores_clean[(valores < lower_bound) | (valores > upper_bound)] = median_val
        
        return valores_clean
    
    def _interpolate_missing(self, valores: np.ndarray) -> np.ndarray:
        """Interpola valores faltantes"""
        if np.isnan(valores).any():
            # Interpolación lineal
            valid_indices = ~np.isnan(valores)
            if np.sum(valid_indices) > 1:
                valores = np.interp(
                    np.arange(len(valores)),
                    np.arange(len(valores))[valid_indices],
                    valores[valid_indices]
                )
            else:
                # Si hay muy pocos valores válidos, usar la media
                mean_val = np.nanmean(valores)
                valores = np.full_like(valores, mean_val)
        
        return valores

class HoltWintersPredictor:
    """Implementación del modelo Holt-Winters"""
    
    def __init__(self, seasonal_periods: int = 12):
        self.seasonal_periods = seasonal_periods
    
    def optimize_parameters(self, data: np.ndarray, seasonal_type: str = 'add') -> HoltWintersParams:
        """Optimiza los parámetros del modelo Holt-Winters"""
        
        def objective(params):
            alpha, beta, gamma = params
            try:
                _, error = self._fit_model(data, alpha, beta, gamma, seasonal_type)
                return error
            except:
                return np.inf
        
        # Múltiples inicializaciones para encontrar el mejor ajuste
        best_params = None
        best_error = np.inf
        
        initial_guesses = [
            [0.3, 0.1, 0.1],
            [0.1, 0.1, 0.1],
            [0.5, 0.2, 0.2],
            [0.7, 0.3, 0.3]
        ]
        
        bounds = [(0.01, 0.99), (0.01, 0.99), (0.01, 0.99)]
        
        for guess in initial_guesses:
            try:
                result = minimize(objective, guess, bounds=bounds, method='L-BFGS-B')
                if result.success and result.fun < best_error:
                    best_error = result.fun
                    best_params = result.x
            except:
                continue
        
        if best_params is None:
            # Parámetros por defecto si la optimización falla
            best_params = [0.3, 0.1, 0.1]
        
        return HoltWintersParams(
            alpha=best_params[0],
            beta=best_params[1],
            gamma=best_params[2],
            seasonal_periods=self.seasonal_periods,
            seasonal=seasonal_type
        )
    
    def _fit_model(self, data: np.ndarray, alpha: float, beta: float, gamma: float, 
                   seasonal_type: str = 'add') -> Tuple[Dict, float]:
        """Ajusta el modelo Holt-Winters y devuelve componentes y error"""
        n = len(data)
        m = self.seasonal_periods
        
        if n < 2 * m:
            raise ValueError(f"Se necesitan al menos {2*m} observaciones para {m} períodos estacionales")
        
        # Inicialización
        level = np.zeros(n)
        trend = np.zeros(n)
        seasonal = np.zeros(n)
        
        # Inicialización del nivel (promedio del primer ciclo)
        level[0] = np.mean(data[:m])
        
        # Inicialización de la tendencia
        if n >= 2 * m:
            trend[0] = (np.mean(data[m:2*m]) - np.mean(data[:m])) / m
        else:
            trend[0] = 0
        
        # Inicialización de la estacionalidad
        for i in range(m):
            if seasonal_type == 'add':
                seasonal[i] = data[i] - level[0]
            else:  # multiplicative
                seasonal[i] = data[i] / level[0] if level[0] != 0 else 1
        
        # Ajuste del modelo
        fitted_values = np.zeros(n)
        errors = np.zeros(n)
        
        for t in range(n):
            if t == 0:
                if seasonal_type == 'add':
                    fitted_values[t] = level[0] + trend[0] + seasonal[0]
                else:
                    fitted_values[t] = (level[0] + trend[0]) * seasonal[0]
            else:
                # Actualización de componentes
                if seasonal_type == 'add':
                    level[t] = alpha * (data[t] - seasonal[t - m]) + (1 - alpha) * (level[t-1] + trend[t-1])
                    fitted_values[t] = level[t-1] + trend[t-1] + seasonal[t - m]
                else:
                    if seasonal[t - m] != 0:
                        level[t] = alpha * (data[t] / seasonal[t - m]) + (1 - alpha) * (level[t-1] + trend[t-1])
                    else:
                        level[t] = alpha * data[t] + (1 - alpha) * (level[t-1] + trend[t-1])
                    fitted_values[t] = (level[t-1] + trend[t-1]) * seasonal[t - m]
                
                trend[t] = beta * (level[t] - level[t-1]) + (1 - beta) * trend[t-1]
                
                if seasonal_type == 'add':
                    seasonal[t] = gamma * (data[t] - level[t]) + (1 - gamma) * seasonal[t - m]
                else:
                    if level[t] != 0:
                        seasonal[t] = gamma * (data[t] / level[t]) + (1 - gamma) * seasonal[t - m]
                    else:
                        seasonal[t] = seasonal[t - m]
            
            errors[t] = data[t] - fitted_values[t]
        
        # Calcular error cuadrático medio
        mse = np.mean(errors**2)
        
        components = {
            'level': level,
            'trend': trend,
            'seasonal': seasonal,
            'fitted': fitted_values,
            'errors': errors
        }
        
        return components, mse
    
    def predict(self, data: np.ndarray, params: HoltWintersParams, 
                periods: int = 12) -> Dict:
        """Realiza predicciones usando Holt-Winters"""
        
        # Ajustar el modelo
        components, mse = self._fit_model(
            data, params.alpha, params.beta, params.gamma, params.seasonal
        )
        
        n = len(data)
        m = params.seasonal_periods
        
        # Obtener último nivel, tendencia y componentes estacionales
        last_level = components['level'][-1]
        last_trend = components['trend'][-1]
        last_seasonal = components['seasonal'][-m:]
        
        # Generar predicciones
        predictions = []
        for h in range(1, periods + 1):
            if params.seasonal == 'add':
                pred = last_level + h * last_trend + last_seasonal[(h-1) % m]
            else:  # multiplicative
                pred = (last_level + h * last_trend) * last_seasonal[(h-1) % m]
            
            predictions.append(max(0, pred))  # Asegurar que no sea negativo
        
        # Calcular métricas
        fitted_values = components['fitted']
        mae = np.mean(np.abs(components['errors']))
        rmse = np.sqrt(mse)
        mape = np.mean(np.abs(components['errors'] / np.maximum(data, 1e-10))) * 100
        
        return {
            'predictions': predictions,
            'fitted_values': fitted_values.tolist(),
            'components': {
                'level': components['level'].tolist(),
                'trend': components['trend'].tolist(),
                'seasonal': components['seasonal'].tolist()
            },
            'metrics': {
                'mae': mae,
                'rmse': rmse,
                'mape': mape,
                'mse': mse
            }
        }

def normalizar_nombre_columna(col):
    """Normaliza nombres de columnas para ignorar espacios, mayúsculas y variaciones."""
    col = re.sub(r'\s+', ' ', col.strip().upper().replace("\n", " ").replace("/", ""))
    return col

def encontrar_columna(df, nombres_posibles):
    """Busca una columna en el DataFrame que coincida con cualquiera de los nombres posibles."""
    df_cols_normalized = {normalizar_nombre_columna(col): col for col in df.columns}
    for nombre in nombres_posibles:
        nombre_normalized = normalizar_nombre_columna(nombre)
        if nombre_normalized in df_cols_normalized:
            return df_cols_normalized[nombre_normalized]
    return None

def parsear_fecha_excel(fecha_celda):
    """Intenta parsear la fecha desde diferentes formatos posibles en Excel."""
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
    """Identifica dinámicamente todas las columnas de consumo disponibles en el DataFrame."""
    cols_consumo = [col for col in df.columns if col.startswith("CONS ")]
    
    if not cols_consumo:
        raise ValueError("No se encontraron columnas de consumo en el archivo")
    
    fechas_consumo = []
    for col in cols_consumo:
        try:
            partes = col.split()
            if len(partes) >= 3:
                mes_abr = partes[1]
                año = int(partes[2])
                
                mes_num = next((num for num, abr in SPANISH_MONTHS.items() if abr.upper() == mes_abr.upper()), None)
                
                if mes_num:
                    fecha = datetime(año, mes_num, 1)
                    fechas_consumo.append((col, fecha))
        except Exception:
            pass
    
    fechas_consumo.sort(key=lambda x: x[1])
    cols_ordenadas = [item[0] for item in fechas_consumo]
    ultima_fecha = fechas_consumo[-1][1] if fechas_consumo else None
    
    logger.info(f"Se detectaron {len(cols_ordenadas)} columnas de consumo. Última fecha: {ultima_fecha.strftime('%Y-%m-%d') if ultima_fecha else 'No determinada'}")
    
    return cols_ordenadas, ultima_fecha

def cargar_datos(excel_path: str):
    """Carga y procesa los datos del archivo Excel"""
    try:
        logger.info(f"Cargando archivo Excel: {os.path.abspath(excel_path)}")
        if not os.path.exists(excel_path):
            raise FileNotFoundError(f"Archivo no encontrado: {excel_path}")
        
        # Leer las primeras filas para obtener la fecha
        fecha_df = pd.read_excel(excel_path, header=None, nrows=2)
        fecha_celda = fecha_df.iloc[1, 0]
        fecha_inicio_prediccion = parsear_fecha_excel(fecha_celda) or datetime(2025, 2, 14)
        
        # Leer el resto del archivo
        df = pd.read_excel(excel_path, skiprows=2)
        df.columns = [col.strip().replace("\n", " ") for col in df.columns]
        cols_to_drop = [col for col in df.columns if "Unnamed" in col]
        if cols_to_drop:
            df = df.drop(columns=cols_to_drop)
        
        # Identificar columnas de consumo
        cols_consumo, ultima_fecha = identificar_columnas_consumo(df)
        
        # Definir nombres posibles para las columnas básicas
        columnas_basicas = {
            "CODIGO": ["CODIGO", "CÓDIGO", "CODE"],
            "DESCRIPCION": ["DESCRIPCION", "DESCRIPCIÓN", "DESCRIPTION"],
            "UNID/CAJA": ["UNID/CAJA", "UNIDAD/CAJA", "UNIDADES/CAJA", "UNID CAJA", "UNIDAD CAJA"],
            "STOCK TOTAL": ["STOCK TOTAL", "STOCK  TOTAL", "STOCK   TOTAL", "STOCK_TOTAL", "STOCK"],
            "UNIDADES EN TRANSITO": ["UNIDADES EN TRANSITO", "UNIDADES EN TRÁNSITO", "UNIDADES TRANSITO"]
        }
        
        # Mapear nombres reales de columnas
        columnas_encontradas = {}
        missing_cols = []
        for key, posibles in columnas_basicas.items():
            col_encontrada = encontrar_columna(df, posibles)
            if col_encontrada:
                columnas_encontradas[key] = col_encontrada
            else:
                missing_cols.append(key)
        
        if missing_cols:
            logger.warning(f"Columnas básicas faltantes: {missing_cols}")
        
        # Renombrar columnas a nombres estándar
        rename_dict = {v: k for k, v in columnas_encontradas.items()}
        df = df.rename(columns=rename_dict)
        
        # Rellenar valores nulos en CODIGO y DESCRIPCION
        if 'CODIGO' in df.columns:
            df["CODIGO"] = df["CODIGO"].fillna("Sin información")
        if 'DESCRIPCION' in df.columns:
            df["DESCRIPCION"] = df["DESCRIPCION"].fillna("Sin información")
        
        return df, cols_consumo, ultima_fecha, fecha_inicio_prediccion
    except Exception as e:
        logger.error(f"Error en carga de datos: {str(e)}")
        sys.exit(1)

def preparar_series_temporales(df: pd.DataFrame, cols_consumo: List[str]) -> List[SerieData]:
    """Prepara las series temporales de cada SKU"""
    series_data = []
    
    for idx, row in df.iterrows():
        codigo = row.get('CODIGO', f'SKU_{idx}')
        descripcion = row.get('DESCRIPCION', 'Sin descripción')
        
        # Extraer valores de consumo
        valores = []
        for col in cols_consumo:
            valor = row[col]
            if pd.isna(valor):
                valores.append(0)
            else:
                valores.append(float(valor))
        
        # Crear fechas correspondientes
        fechas = []
        for col in cols_consumo:
            try:
                partes = col.split()
                if len(partes) >= 3:
                    mes_abr = partes[1]
                    año = int(partes[2])
                    mes_num = next((num for num, abr in SPANISH_MONTHS.items() if abr.upper() == mes_abr.upper()), 1)
                    fechas.append(datetime(año, mes_num, 1))
                else:
                    fechas.append(datetime(2024, 1, 1))  # Fecha por defecto
            except:
                fechas.append(datetime(2024, 1, 1))
        
        serie = SerieData(
            codigo=str(codigo),
            descripcion=str(descripcion),
            valores=valores,
            fechas=fechas
        )
        
        series_data.append(serie)
    
    return series_data

def determinar_tipo_estacional(valores: np.ndarray) -> str:
    """Determina si usar modelo aditivo o multiplicativo"""
    if len(valores) < 24:  # Necesitamos al menos 2 años de datos
        return 'add'
    
    # Calcular tendencia usando ventana móvil
    window = 12
    trend = pd.Series(valores).rolling(window=window, center=True).mean().dropna()
    
    if len(trend) < 12:
        return 'add'
    
    # Calcular estacionalidad
    seasonal_var = []
    for i in range(12):
        seasonal_values = []
        for j in range(i, len(valores), 12):
            if j < len(trend):
                seasonal_values.append(valores[j])
        
        if len(seasonal_values) > 1:
            seasonal_var.append(np.var(seasonal_values))
    
    if not seasonal_var:
        return 'add'
    
    # Si la varianza estacional aumenta con el nivel, usar multiplicativo
    correlation = np.corrcoef(trend[:len(seasonal_var)], seasonal_var)[0, 1]
    
    return 'mul' if correlation > 0.3 else 'add'

def generar_fechas_prediccion(ultima_fecha: datetime, periodos: int) -> List[datetime]:
    """Genera las fechas para las predicciones"""
    fechas = []
    fecha_actual = ultima_fecha
    
    for i in range(periodos):
        # Incrementar mes
        if fecha_actual.month == 12:
            fecha_actual = fecha_actual.replace(year=fecha_actual.year + 1, month=1)
        else:
            fecha_actual = fecha_actual.replace(month=fecha_actual.month + 1)
        fechas.append(fecha_actual)
    
    return fechas

def main():
    parser = argparse.ArgumentParser(description='Predictor de consumo usando Holt-Winters')
    parser.add_argument('--excel', type=str, 
                       default=os.path.join(os.path.dirname(__file__), '../data/Template Plannink (1).xlsx'),
                       help='Ruta al archivo Excel con los datos')
    parser.add_argument('--output', type=str, 
                       default='predicciones_holt_winters.json',
                       help='Archivo de salida para las predicciones')
    parser.add_argument('--periodos', type=int, default=12,
                       help='Número de períodos a predecir')
    parser.add_argument('--min-periods', type=int, default=24,
                       help='Mínimo número de períodos históricos requeridos')
    
    args = parser.parse_args()
    
    # Cargar datos
    logger.info("Iniciando proceso de predicción...")
    df, cols_consumo, ultima_fecha, fecha_inicio = cargar_datos(args.excel)
    
    # Preparar series temporales
    logger.info("Preparando series temporales...")
    series_data = preparar_series_temporales(df, cols_consumo)
    
    # Limpiar y validar datos
    logger.info("Limpiando y validando datos...")
    cleaner = DataCleaner(min_periods=args.min_periods)
    series_limpias = cleaner.clean_and_validate_series(series_data)
    
    # Filtrar solo series válidas
    series_validas = [s for s in series_limpias if s.es_valida]
    logger.info(f"Series válidas para predicción: {len(series_validas)}")
    
    # Realizar predicciones
    logger.info("Realizando predicciones con Holt-Winters...")
    predictor = HoltWintersPredictor(seasonal_periods=12)
    
    resultados = []
    fechas_prediccion = generar_fechas_prediccion(ultima_fecha, args.periodos)
    
    for i, serie in enumerate(series_validas):
        try:
            logger.info(f"Procesando SKU {i+1}/{len(series_validas)}: {serie.codigo}")
            
            # Convertir a numpy array
            data = np.array(serie.valores)
            
            # Determinar tipo de modelo
            seasonal_type = determinar_tipo_estacional(data)
            
            # Optimizar parámetros
            params = predictor.optimize_parameters(data, seasonal_type)
            
            # Realizar predicción
            resultado = predictor.predict(data, params, args.periodos)
            
            # Preparar datos históricos
            serie_historica = []
            for j, (fecha, valor) in enumerate(zip(serie.fechas, serie.valores)):
                serie_historica.append({
                    'fecha': fecha.strftime('%Y-%m-%d'),
                    'valor_real': valor,
                    'valor_ajustado': resultado['fitted_values'][j] if j < len(resultado['fitted_values']) else None
                })
            
            # Preparar predicciones
            predicciones_formato = []
            for k, (fecha_pred, valor_pred) in enumerate(zip(fechas_prediccion, resultado['predictions'])):
                predicciones_formato.append({
                    'fecha': fecha_pred.strftime('%Y-%m-%d'),
                    'periodo': k + 1,
                    'valor_predicho': round(valor_pred, 2)
                })
            
            # Crear objeto de predicción
            prediccion = Prediccion(
                codigo=serie.codigo,
                descripcion=serie.descripcion,
                modelo_usado=f"Holt-Winters {seasonal_type.upper()}",
                parametros={
                    'alpha': round(params.alpha, 4),
                    'beta': round(params.beta, 4),
                    'gamma': round(params.gamma, 4),
                    'seasonal_periods': params.seasonal_periods,
                    'seasonal_type': seasonal_type
                },
                predicciones=predicciones_formato,
                metricas={
                    'mae': round(resultado['metrics']['mae'], 2),
                    'rmse': round(resultado['metrics']['rmse'], 2),
                    'mape': round(resultado['metrics']['mape'], 2),
                    'mse': round(resultado['metrics']['mse'], 2)
                },
                serie_historica=serie_historica
            )
            
            resultados.append(prediccion.__dict__)
            
        except Exception as e:
            logger.error(f"Error procesando SKU {serie.codigo}: {str(e)}")
            continue
    
    # Preparar resumen
    resumen = {
        'metadata': {
            'fecha_generacion': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'archivo_origen': args.excel,
            'total_skus_procesados': len(series_data),
            'skus_validos': len(series_validas),
            'skus_con_prediccion': len(resultados),
            'periodos_prediccion': args.periodos,
            'ultima_fecha_historica': ultima_fecha.strftime('%Y-%m-%d'),
            'primera_fecha_prediccion': fechas_prediccion[0].strftime('%Y-%m-%d') if fechas_prediccion else None
        },
        'parametros_limpieza': {
            'min_periods': args.min_periods,
            'max_zeros_pct': cleaner.max_zeros_pct,
            'outlier_threshold': cleaner.outlier_threshold
        },
        'predicciones': resultados
    }
    
    # Guardar resultados
    logger.info(f"Guardando resultados en {args.output}...")
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(resumen, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Proceso completado. Se generaron predicciones para {len(resultados)} SKUs.")
    
    # Mostrar estadísticas finales
    if resultados:
        maes = [r['metricas']['mae'] for r in resultados]
        rmses = [r['metricas']['rmse'] for r in resultados]
        mapes = [r['metricas']['mape'] for r in resultados]
        
        logger.info("=== ESTADÍSTICAS FINALES ===")
        logger.info(f"MAE promedio: {np.mean(maes):.2f}")
        logger.info(f"RMSE promedio: {np.mean(rmses):.2f}")
        logger.info(f"MAPE promedio: {np.mean(mapes):.2f}%")
        
        # Contar tipos de modelos usados
        modelos_usados = {}
        for r in resultados:
            modelo = r['parametros']['seasonal_type']
            modelos_usados[modelo] = modelos_usados.get(modelo, 0) + 1
        
        logger.info("Modelos utilizados:")
        for modelo, count in modelos_usados.items():
            logger.info(f"  - {modelo.upper()}: {count} SKUs")
    
    # Generar reporte de SKUs no válidos si hay alguno
    series_invalidas = [s for s in series_limpias if not s.es_valida]
    if series_invalidas:
        logger.info(f"\n=== SKUs NO VÁLIDOS ({len(series_invalidas)}) ===")
        for serie in series_invalidas[:10]:  # Mostrar solo los primeros 10
            logger.info(f"  - {serie.codigo}: {serie.razon_invalida}")
        if len(series_invalidas) > 10:
            logger.info(f"  ... y {len(series_invalidas) - 10} más")
    
    print(f"\n✅ Predicciones guardadas en: {args.output}")
    print(f"📊 SKUs procesados: {len(resultados)}/{len(series_data)}")
    
    return resumen

if __name__ == "__main__":
    main()