# Laboratorio de Oscilaciones & Serie de Fourier (Arduino)

Aplicación web interactiva para analizar datos experimentales de oscilaciones $x(t)$ obtenidos con **Arduino**, determinar la **Serie de Fourier** de mejor ajuste, superponerla gráficamente en otro color y extraer la **frecuencia de mayor amplitud** para compararla con la frecuencia de resonancia teórica del sistema.

## Características Principales

1. **Lectura de archivos `.txt` / `.csv` de Arduino**:
   - Autodetección de separadores (espacio, tabulación, coma o punto y coma) y encabezados.
   - Conversión automática o seleccionable de unidades de tiempo (`s`, `ms` de `millis()`, o `µs` de `micros()`).
2. **Gráfica superpuesta $x(t)$ vs Serie de Fourier**:
   - Curva experimental $x(t)$ en azul y serie de Fourier ajustada encima en color naranja.
   - Zoom interactivo, paneo y exportación de imagen PNG con Plotly.js.
3. **Ajuste de Serie de Fourier y selección de armónicos ($n$)**:
   - **Modo Automático (Mejor Ajuste)**: Selecciona los armónicos $n$ más significativos por umbral de energía / $R^2$ y refina sus coeficientes por Mínimos Cuadrados.
   - **Modo Manual**: Control deslizante para elegir la cantidad de armónicos $N$ (los de mayor amplitud o consecutivos $n = 1 \dots N$).
4. **Coeficientes de Fourier y valores de $n$ utilizados**:
   - Muestra explícitamente los $n$ seleccionados, la ecuación reconstruida lista para copiar en LaTeX y una tabla completa con $a_0/2$, $a_n$, $b_n$, amplitud $C_n = \sqrt{a_n^2 + b_n^2}$, fase $\varphi_n$ y porcentaje de energía.
   - Exportación de todos los coeficientes a `.csv`.
5. **Determinación de la Frecuencia para la Mayor Amplitud (Resonancia Experimental)**:
   - Calcula con alta precisión la frecuencia dominante $f_{\text{max}}$ (en $\text{Hz}$) y $\omega_{\text{max}}$ (en $\text{rad/s}$) junto con el espectro de amplitudes $C_n$.

---

## Formato del archivo `.txt` desde Arduino

Tu sketch de Arduino puede imprimir dos columnas (`tiempo` y `posicion`) por el Monitor Serial o guardarlas en una tarjeta SD:

```text
# Tiempo(s)   Posicion(cm)
0.0000        6.0512
0.0100        5.9840
0.0200        5.6911
0.0300        5.1904
...
```

---

## Cómo conectar con GitHub y desplegar en Vercel

El proyecto ya tiene un repositorio Git inicializado y configurado con `vercel.json`.

### 1. Subir a GitHub
1. Crea un nuevo repositorio vacío en [github.com/new](https://github.com/new) (por ejemplo, `arduino-fourier-analyzer`).
2. En la terminal dentro de esta carpeta, ejecuta:
   ```bash
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/arduino-fourier-analyzer.git
   git push -u origin main
   ```

### 2. Desplegar en Vercel
1. Entra a [vercel.com](https://vercel.com/) e inicia sesión con tu cuenta de **GitHub**.
2. Haz clic en **"Add New..." → "Project"**.
3. Selecciona tu repositorio `arduino-fourier-analyzer` y haz clic en **"Import"**.
4. Haz clic directamente en **"Deploy"** (no requiere configuración adicional; Vercel detectará automáticamente la aplicación y `vercel.json`).
5. Cada vez que hagas `git push` a GitHub, Vercel actualizará la aplicación automáticamente.
