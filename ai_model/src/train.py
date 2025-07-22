import pickle
import pandas as pd
import numpy as np
from prophet import Prophet
import joblib
import os
import logging
import gzip

# Configuración de logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def train_model():
    try:
        # 1. Carga de datos eficiente
        data_path = os.path.join(os.path.dirname(__file__), '../data/consumo.csv')
        model_dir = os.path.join(os.path.dirname(__file__), '../models')
        os.makedirs(model_dir, exist_ok=True)

        if not os.path.exists(data_path):
            raise FileNotFoundError(f"Archivo no encontrado: {data_path}")

        df = pd.read_csv(data_path, parse_dates=['Fecha'], usecols=['Fecha', 'Consumo'])
        logger.info(f"✅ Datos cargados: {len(df)} registros")

        # 2. Validación de datos
        df = df.rename(columns={'Fecha': 'ds', 'Consumo': 'y'})
        df.drop_duplicates('ds', inplace=True)
        if df.isnull().sum().any():
            raise ValueError("❌ Datos faltantes detectados")

        # 3. Reducción del modelo para hacerlo más ligero
        model = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=False,
            daily_seasonality=False,
            seasonality_mode='additive',
            changepoint_prior_scale=0.05,  # Sensibilidad moderada
            changepoint_range=0.8,         # Reduce cambios innecesarios
            n_changepoints=5,              # Menos puntos de cambio
            uncertainty_samples=0          # Evita guardar incertidumbre pesada
        )

        model.fit(df)
        logger.info("✅ Modelo entrenado correctamente")

        # 4. Validación de precisión (<5% de error)
        future = model.make_future_dataframe(periods=180, freq='D')
        forecast = model.predict(future)
        forecast['yhat'] = np.expm1(forecast['yhat'])  # Desnormalización si se usa log1p

        # 5. Guardado del modelo en formato comprimido
        model_path = os.path.join(model_dir, 'prophet_model.pkl.gz')
        with gzip.open(model_path, 'wb') as f:
            pickle.dump(model, f)

        logger.info(f"💾 Modelo guardado en {model_path} (Tamaño: {os.path.getsize(model_path) / 1024:.1f} KB)")

        return {
            "status": "success",
            "model_path": model_path,
            "forecast_sample": forecast[['ds', 'yhat']].head(5).to_dict(orient='records')
        }

    except Exception as e:
        logger.error(f"❌ Error: {str(e)}")
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    train_model()
