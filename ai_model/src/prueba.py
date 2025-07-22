import pandas as pd
import json
from statsmodels.tsa.holtwinters import ExponentialSmoothing

# Ruta corregida con doble backslash o raw string
archivo = r'ai_model\data\Template Plannink (1).xlsx'

# Leer el Excel desde la fila 3 (header=2)
df = pd.read_excel(archivo, header=2)

# Verifica nombres de columnas
print(df.columns.tolist())

# Filtrar columnas que contienen consumo (las que empiezan con 'CONS')
columnas_consumo = [col for col in df.columns if str(col).startswith('CONS')]

# Lista para guardar predicciones por producto
resultados = []

# Iterar por cada fila (producto)
for _, fila in df.iterrows():
    producto = {
        'codigo': fila['CODIGO'],
        'descripcion': fila['DESCRIPCION'],
        'stockTotal': fila['STOCK  TOTAL'],
        'unidCaja': fila['UNID/CAJA'],
        'consumos': {}
    }

    # Extraer consumos de los últimos 14 meses (últimos 14 elementos)
    consumos = fila[columnas_consumo].tolist()[-14:]

    # Verificar si hay suficientes datos
    if len(consumos) >= 12:
        try:
            # Modelo Holt-Winters (estacionalidad aditiva, 12 meses)
            modelo = ExponentialSmoothing(
                consumos,
                trend='add',
                seasonal='add',
                seasonal_periods=12
            ).fit()

            # Predecir los próximos 3 meses
            predicciones = modelo.forecast(3)
            producto['consumos'] = {
                'mes_1': round(predicciones[0], 2),
                'mes_2': round(predicciones[1], 2),
                'mes_3': round(predicciones[2], 2)
            }
        except Exception as e:
            print(f"⚠️ Error al predecir para el producto {fila['CODIGO']}: {e}")
    else:
        print(f"❌ Datos insuficientes para el producto {fila['CODIGO']}")

    resultados.append(producto)

# Guardar predicciones en un archivo JSON
with open('predicciones_holt_winters.json', 'w') as f:
    json.dump(resultados, f, indent=2)

print("✅ Predicciones guardadas en 'predicciones_holt_winters.json'")
