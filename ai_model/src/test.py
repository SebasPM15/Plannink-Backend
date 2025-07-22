import pandas as pd
import numpy as np
import json
import os
import re
import argparse
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
from scipy.optimize import minimize
import plotly.graph_objs as go
from plotly.subplots import make_subplots
import warnings
warnings.filterwarnings('ignore')

# Configuración de logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Constantes
SPANISH_MONTHS = {
    1: 'ENE', 2: 'FEB', 3: 'MAR', 4: 'ABR', 5: 'MAY', 6: 'JUN',
    7: 'JUL', 8: 'AGO', 9: 'SEP', 10: 'OCT', 11: 'NOV', 12: 'DIC'
}

@dataclass
class HoltWintersParams:
    alpha: float = 0.4
    beta: float = 0.05
    gamma: float = 0.3
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

@dataclass
class PrediccionResult:
    codigo: str
    descripcion: str
    modelo_usado: str
    parametros: Dict
    predicciones: List[Dict]
    metricas: Dict
    serie_historica: List[Dict]
    comparacion_historico: List[Dict]

class DataCleaner:
    def __init__(self, min_periods=12, max_zeros_pct=0.3, outlier_threshold=1.5):
        self.min_periods = min_periods
        self.max_zeros_pct = max_zeros_pct
        self.outlier_threshold = outlier_threshold
    
    def clean_and_validate(self, series: List[SerieData]) -> List[SerieData]:
        cleaned_series = []
        valid_count = 0
        
        for serie in series:
            if self._validate(serie):
                cleaned = self._clean(serie)
                cleaned_series.append(cleaned)
                valid_count += 1
            else:
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
        elif np.std(vals) == 0:
            serie.razon_invalida = "Sin variabilidad"
            valid = False
            
        serie.es_valida = valid
        return valid
    
    def _clean(self, serie: SerieData) -> SerieData:
        vals = np.array(serie.valores)
        
        # 1. Reemplazar negativos con 0
        vals = np.maximum(vals, 0)
        
        # 2. Manejar ceros con interpolación
        zero_mask = vals == 0
        if zero_mask.any():
            vals[zero_mask] = np.nan
            vals = pd.Series(vals).interpolate(method='linear').ffill().bfill().values
        
        # 3. Manejar outliers con IQR mejorado
        q1, q3 = np.percentile(vals[vals > 0], [25, 75]) if np.any(vals > 0) else (0, 0)
        iqr = q3 - q1
        if iqr > 0:
            lower, upper = q1 - self.outlier_threshold*iqr, q3 + self.outlier_threshold*iqr
            outlier_mask = (vals < lower) | (vals > upper)
            if outlier_mask.any():
                median = np.median(vals[~outlier_mask])
                vals[outlier_mask] = median
        
        serie.valores = vals.tolist()
        return serie

class HoltWintersOptimized:
    def __init__(self, seasonal_periods=12):
        self.seasonal_periods = seasonal_periods
    
    def fit_predict(self, data: List[float], forecast_periods=12) -> Dict:
        """Versión optimizada con parámetros fijos y mejor manejo de ciclicidad"""
        data_array = np.array(data)
        seasonal_type = self._determine_seasonality(data_array)
        
        # Usar parámetros fijos en lugar de optimización
        params = HoltWintersParams(seasonal=seasonal_type)
        model = self._fit_model(data_array, params)
        predictions = self._generate_predictions(model, forecast_periods)
        
        # Cálculo robusto de métricas
        fitted = model['fitted']
        errors = data_array - fitted
        safe_actual = np.where(data_array == 0, 1e-10, data_array)  # Evitar división por cero
        
        metrics = {
            'mae': np.mean(np.abs(errors)),
            'rmse': np.sqrt(np.mean(errors**2)),
            'mape': np.mean(np.abs(errors / safe_actual)) * 100,
            'mse': np.mean(errors**2)
        }
        
        return {
            'predictions': predictions,
            'fitted': fitted.tolist(),
            'params': params.__dict__,
            'metrics': metrics,
            'seasonal_type': seasonal_type
        }
    
    def _determine_seasonality(self, data: np.ndarray) -> str:
        """Determina estacionalidad mejorada con análisis de autocorrelación"""
        if len(data) < 12:
            return 'add'
        
        # Análisis de autocorrelación para detectar estacionalidad
        autocorr = np.correlate(data - np.mean(data), data - np.mean(data), mode='full')
        autocorr = autocorr[len(autocorr)//2:]
        seasonal_lags = autocorr[self.seasonal_periods::self.seasonal_periods]
        
        # Si hay al menos 2 picos significativos en los lags estacionales
        significant_peaks = sum(seasonal_lags > 0.5 * autocorr[0])
        if significant_peaks >= 2:
            # Decidir entre aditivo o multiplicativo basado en la variación
            seasonal_variation = np.std(data.reshape(-1, self.seasonal_periods), axis=0)
            cv = np.mean(seasonal_variation) / np.mean(data)
            return 'mul' if cv > 0.15 else 'add'
        
        return 'add'
    
    def _fit_model(self, data: np.ndarray, params: HoltWintersParams) -> Dict:
        """Implementación optimizada del modelo con parámetros fijos"""
        alpha, beta, gamma = params.alpha, params.beta, params.gamma
        seasonal_type = params.seasonal
        n = len(data)
        m = self.seasonal_periods
        
        level, trend, seasonal, fitted = np.zeros(n), np.zeros(n), np.zeros(n), np.zeros(n)
        
        # Inicialización mejorada
        level[0] = np.mean(data[:m]) if n >= m else data[0]
        trend[0] = (np.mean(data[m:min(2*m, n)]) - np.mean(data[:m])) / m if n >= 2*m else 0
        
        if seasonal_type == 'add':
            seasonal[:m] = data[:m] - level[0]
        else:
            seasonal[:m] = np.where(level[0] != 0, data[:m] / level[0], 1)
        
        # Ajuste del modelo con parámetros fijos
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
        """Generación de predicciones con protección contra valores extremos"""
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
            
            # Suavizar predicciones extremas
            pred = max(0, pred)
            if h > 1:
                # Aplicar suavizado exponencial entre predicciones consecutivas
                pred = 0.8 * pred + 0.2 * predictions[-1]
            
            predictions.append(pred)
        
        return predictions

def normalizar_nombre_columna(col: str) -> str:
    return re.sub(r'\s+', ' ', col.strip().upper().replace("\n", " ").replace("/", ""))

def encontrar_columna(df: pd.DataFrame, nombres_posibles: List[str]) -> Optional[str]:
    normalized = {normalizar_nombre_columna(c): c for c in df.columns}
    for nombre in nombres_posibles:
        if (norm := normalizar_nombre_columna(nombre)) in normalized:
            return normalized[norm]
    return None

def parsear_fecha_excel(fecha_celda) -> Optional[datetime]:
    try:
        if isinstance(fecha_celda, (datetime, pd.Timestamp)):
            return fecha_celda
        
        fecha_str = str(fecha_celda).strip().lower()
        meses = {'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6,
                 'jul': 7, 'ago': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dic': 12}
        
        if '/' in fecha_str:
            parts = fecha_str.split('/')
            if len(parts) == 3:
                dia, mes, anio = parts
                month_num = meses.get(mes[:3]) or (int(mes) if mes.isdigit() else None)
                if month_num:
                    year = 2000 + int(anio) if len(anio) == 2 else int(anio)
                    return datetime(year, month_num, int(dia))
        
        return pd.to_datetime(fecha_str, errors='coerce')
    except:
        return None

def identificar_columnas_consumo(df: pd.DataFrame) -> Tuple[List[str], Optional[datetime]]:
    cols_consumo = [c for c in df.columns if c.upper().startswith("CONS ")]
    if not cols_consumo:
        raise ValueError("No se encontraron columnas de consumo")
    
    fechas = []
    for col in cols_consumo:
        parts = col.split()
        if len(parts) >= 3:
            month_abr = parts[1].upper()
            year = int(parts[2])
            month = next((k for k, v in SPANISH_MONTHS.items() if v == month_abr), None)
            if month:
                fechas.append((col, datetime(year, month, 1)))
    
    fechas.sort(key=lambda x: x[1])
    return [f[0] for f in fechas], fechas[-1][1] if fechas else None

def cargar_datos(excel_path: str) -> Tuple[pd.DataFrame, List[str], datetime, datetime]:
    try:
        logger.info(f"Cargando archivo: {os.path.abspath(excel_path)}")
        
        # Leer fecha de predicción
        fecha_df = pd.read_excel(excel_path, header=None, nrows=2)
        fecha_prediccion = parsear_fecha_excel(fecha_df.iloc[1, 0]) or datetime.now()
        
        # Leer datos principales
        df = pd.read_excel(excel_path, skiprows=2)
        df.columns = [c.strip().replace("\n", " ") for c in df.columns]
        df = df.drop(columns=[c for c in df.columns if "Unnamed" in c], errors='ignore')
        
        # Identificar columnas
        cols_consumo, ultima_fecha = identificar_columnas_consumo(df)
        
        # Mapear columnas estándar
        column_map = {
            "CODIGO": ["CODIGO", "CÓDIGO", "CODE"],
            "DESCRIPCION": ["DESCRIPCION", "DESCRIPCIÓN", "DESCRIPTION"],
            "UNID/CAJA": ["UNID/CAJA", "UNIDAD/CAJA", "UNIDADES/CAJA"],
            "STOCK TOTAL": ["STOCK TOTAL", "STOCK_TOTAL", "STOCK"],
            "UNIDADES EN TRANSITO": ["UNIDADES EN TRANSITO", "UNIDADES EN TRÁNSITO"]
        }
        
        rename_cols = {}
        for std_col, posibles in column_map.items():
            if found := encontrar_columna(df, posibles):
                rename_cols[found] = std_col
        
        df = df.rename(columns=rename_cols)
        df["CODIGO"] = df["CODIGO"].fillna("").astype(str)
        df["DESCRIPCION"] = df["DESCRIPCION"].fillna("").astype(str)
        
        return df, cols_consumo, ultima_fecha, fecha_prediccion
    except Exception as e:
        logger.error(f"Error cargando datos: {str(e)}")
        raise

def preparar_series(df: pd.DataFrame, cols_consumo: List[str]) -> List[SerieData]:
    series = []
    for _, row in df.iterrows():
        codigo = row.get('CODIGO', '')
        descripcion = row.get('DESCRIPCION', '')
        
        valores = []
        fechas = []
        for col in cols_consumo:
            # Extraer valor
            valor = row[col]
            valores.append(float(valor) if not pd.isna(valor) else 0)
            
            # Extraer fecha
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
    return series

def generar_comparacion_historico(historico: List[Dict], predicciones: List[Dict]) -> List[Dict]:
    comparacion = []
    for pred in predicciones:
        pred_date = datetime.strptime(pred['fecha'], '%Y-%m-%d')
        mes = pred_date.month
        
        # Filtrar histórico por mes
        historico_mes = [h for h in historico if datetime.strptime(h['fecha'], '%Y-%m-%d').month == mes]
        
        if historico_mes:
            avg_historico = np.mean([h['valor_real'] for h in historico_mes])
            pred_value = pred['valor_predicho']
            diff = pred_value - avg_historico
            pct_diff = (diff / avg_historico) * 100 if avg_historico != 0 else 0
            
            comparacion.append({
                'fecha': pred['fecha'],
                'valor_predicho': round(pred_value, 2),
                'promedio_historico': round(avg_historico, 2),
                'diferencia': round(diff, 2),
                'diferencia_porcentual': round(pct_diff, 2)
            })
    
    return comparacion

def generar_grafico_interactivo(serie: SerieData, resultado: Dict, output_dir: str):
    try:
        # Preparar datos
        fechas_hist = [datetime.strptime(h['fecha'], '%Y-%m-%d') for h in resultado['serie_historica']]
        real = [h['valor_real'] for h in resultado['serie_historica']]
        ajustado = [h['valor_ajustado'] for h in resultado['serie_historica']]
        
        fechas_pred = [datetime.strptime(p['fecha'], '%Y-%m-%d') for p in resultado['predicciones']]
        predicho = [p['valor_predicho'] for p in resultado['predicciones']]
        
        # Crear figura
        fig = make_subplots()
        
        # Añadir trazas
        fig.add_trace(go.Scatter(
            x=fechas_hist, y=real,
            mode='lines+markers',
            name='Real',
            line=dict(color='blue', width=2)
        ))
        
        fig.add_trace(go.Scatter(
            x=fechas_hist, y=ajustado,
            mode='lines',
            name='Ajustado',
            line=dict(color='green', dash='dash', width=1.5)
        ))
        
        fig.add_trace(go.Scatter(
            x=fechas_pred, y=predicho,
            mode='lines+markers',
            name='Predicción',
            line=dict(color='red', width=2)
        ))
        
        # Configurar layout
        fig.update_layout(
            title=f"Consumo - {serie.codigo}: {serie.descripcion}",
            xaxis_title='Fecha',
            yaxis_title='Consumo',
            hovermode='x unified',
            template='plotly_white',
            legend=dict(orientation='h', yanchor='bottom', y=1.02, xanchor='right', x=1)
        )
        
        # Guardar
        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, f"forecast_{serie.codigo}.html")
        fig.write_html(filepath)
        return filepath
    except Exception as e:
        logger.error(f"Error generando gráfico para {serie.codigo}: {str(e)}")
        return None

def main():
    parser = argparse.ArgumentParser(description='Modelo Holt-Winters Optimizado')
    parser.add_argument('--excel', type=str, 
                       default=os.path.join(os.path.dirname(__file__), '../data/Template Plannink (1).xlsx'),
                       help='Ruta al archivo Excel con los datos')
    parser.add_argument('--output', type=str, default='resultados', help='Directorio de salida')
    parser.add_argument('--periodos', type=int, default=12, help='Meses a predecir')
    parser.add_argument('--min-periods', type=int, default=12, help='Mínimo períodos históricos')
    
    args = parser.parse_args()
    
    try:
        # 1. Cargar y preparar datos
        df, cols_consumo, ultima_fecha, fecha_prediccion = cargar_datos(args.excel)
        series = preparar_series(df, cols_consumo)
        
        # 2. Limpieza y validación
        cleaner = DataCleaner(min_periods=args.min_periods)
        series_limpias = cleaner.clean_and_validate(series)
        series_validas = [s for s in series_limpias if s.es_valida]
        logger.info(f"Procesando {len(series_validas)} series válidas")
        
        # 3. Configurar predictor
        predictor = HoltWintersOptimized()
        resultados = []
        
        # 4. Procesar cada SKU
        for serie in series_validas:
            try:
                logger.info(f"Procesando SKU: {serie.codigo}")
                
                # Modelado y predicción
                result = predictor.fit_predict(serie.valores, args.periodos)
                
                # Formatear resultados
                historico = [{
                    'fecha': fecha.strftime('%Y-%m-%d'),
                    'valor_real': valor,
                    'valor_ajustado': result['fitted'][i]
                } for i, (fecha, valor) in enumerate(zip(serie.fechas, serie.valores))]
                
                fechas_prediccion = [ultima_fecha + timedelta(days=30*(i+1)) for i in range(args.periodos)]
                predicciones = [{
                    'fecha': fecha.strftime('%Y-%m-%d'),
                    'valor_predicho': round(pred, 2)
                } for fecha, pred in zip(fechas_prediccion, result['predictions'])]
                
                comparacion = generar_comparacion_historico(historico, predicciones)
                
                # Generar gráfico
                plot_path = generar_grafico_interactivo(serie, {
                    'serie_historica': historico,
                    'predicciones': predicciones
                }, args.output)
                
                # Guardar resultados
                resultados.append(PrediccionResult(
                    codigo=serie.codigo,
                    descripcion=serie.descripcion,
                    modelo_usado=f"Holt-Winters {result['seasonal_type'].upper()}",
                    parametros=result['params'],
                    predicciones=predicciones,
                    metricas={k: round(v, 2) for k, v in result['metrics'].items()},
                    serie_historica=historico,
                    comparacion_historico=comparacion
                ).__dict__)
                
            except Exception as e:
                logger.error(f"Error procesando SKU {serie.codigo}: {str(e)}")
                continue
        
        # 5. Guardar resultados finales
        resumen = {
            'metadata': {
                'fecha_ejecucion': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'archivo_origen': args.excel,
                'total_skus': len(series),
                'skus_validos': len(series_validas),
                'skus_procesados': len(resultados),
                'periodos_prediccion': args.periodos,
                'ultima_fecha_historica': ultima_fecha.strftime('%Y-%m-%d'),
                'fecha_prediccion': fecha_prediccion.strftime('%Y-%m-%d')
            },
            'resultados': resultados
        }
        
        os.makedirs(args.output, exist_ok=True)
        json_path = os.path.join(args.output, 'predicciones.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(resumen, f, indent=2, ensure_ascii=False)
        
        # 6. Mostrar resumen
        if resultados:
            mape_values = [r['metricas']['mape'] for r in resultados]
            mae_values = [r['metricas']['mae'] for r in resultados]
            
            logger.info(f"\nRESUMEN FINAL:")
            logger.info(f"SKUs procesados: {len(resultados)}")
            logger.info(f"MAPE promedio: {np.mean(mape_values):.2f}%")
            logger.info(f"MAE promedio: {np.mean(mae_values):.2f}")
            
            modelos = {}
            for r in resultados:
                model_type = r['parametros']['seasonal']
                modelos[model_type] = modelos.get(model_type, 0) + 1
            
            for model_type, count in modelos.items():
                logger.info(f"  - Modelo {model_type.upper()}: {count} SKUs")
        
        print(f"\n✅ Proceso completado")
        print(f"📊 Resultados guardados en: {json_path}")
        print(f"📈 Gráficos interactivos en: {args.output}")
        
    except Exception as e:
        logger.error(f"Error en el proceso principal: {str(e)}")
        raise

if __name__ == "__main__":
    main()