import pandas as pd

# Carga el archivo de Excel (ajusta la ruta a tu archivo)
file_path = "../data/Template Plannink (1).xlsx"  # Reemplaza con la ruta de tu archivo
df = pd.read_excel(file_path, header=None)  # Leemos sin asumir encabezados

# Extrae la fecha de la celda A2 (fila 1, columna 0 en pandas)
fecha = df.iloc[1, 0]  # A2 es fila 1, columna 0
print("Fecha extraída:", fecha)

# Establece la tercera fila (índice 2) como los nombres de las columnas
columnas = df.iloc[2].tolist()  # Fila 3 (índice 2) como lista
print("Nombres de las columnas a partir de la tercera fila:", columnas)

# Opcional: Si necesitas trabajar con el DataFrame usando esas columnas
df.columns = columnas  # Asigna los nombres de las columnas
df = df.drop([0, 1, 2])  # Elimina las primeras tres filas (ya no las necesitas)
df = df.reset_index(drop=True)  # Resetea los índices
print("\nDataFrame con las columnas asignadas:\n", df.head())