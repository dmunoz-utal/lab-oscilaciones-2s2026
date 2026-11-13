/**
 * Laboratorio de Oscilaciones & Serie de Fourier (Arduino / CoolTerm)
 * - Lee archivos .txt de CoolTerm (ignora encabezados Key = Value y separa formatos "t.a" como "0.052.1.6082").
 * - Calcula la posición x(t) a partir de la aceleración a(t) antes del ajuste armónico.
 * - Determina la Serie de Fourier de mejor ajuste, la grafica encima en otro color,
 *   entrega los coeficientes (a_n, b_n, C_n), los "n" utilizados y la frecuencia de mayor amplitud.
 */

const state = {
  rawT: [],
  rawVal: [],      // Valor leído del archivo (Aceleración a(t) o Posición x(t))
  t: [],           // Tiempo procesado en segundos (s)
  accel: [],       // Aceleración procesada a(t)
  vel: [],         // Velocidad integrada v(t)
  x: [],           // Posición calculada x(t) para analizar con Fourier
  meanRawAccel: 0,
  fileName: '',
  signalType: 'acceleration',       // 'acceleration' | 'position'
  integrationMethod: 'trapezoidal_detrend', // 'trapezoidal_detrend' | 'harmonic'
  mode: 'auto',                     // 'auto' | 'manual'
  r2Target: 0.95,
  manualCount: 6,
  consecutiveN: false,
  f0Mode: 'window',                 // 'window' | 'fundamental'
  timeUnit: 'auto',
  showAllHarmonics: false,
  analysis: null
};

// Referencias del DOM
const els = {
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  fileNameDisplay: document.getElementById('fileNameDisplay'),
  inputSignalTypeSelect: document.getElementById('inputSignalTypeSelect'),
  integrationMethodGroup: document.getElementById('integrationMethodGroup'),
  integrationMethodSelect: document.getElementById('integrationMethodSelect'),
  timeUnitSelect: document.getElementById('timeUnitSelect'),
  modeAutoBtn: document.getElementById('modeAutoBtn'),
  modeManualBtn: document.getElementById('modeManualBtn'),
  autoControls: document.getElementById('autoControls'),
  manualControls: document.getElementById('manualControls'),
  fitModeBadge: document.getElementById('fitModeBadge'),
  r2TargetSlider: document.getElementById('r2TargetSlider'),
  r2TargetValue: document.getElementById('r2TargetValue'),
  maxHarmonicsSlider: document.getElementById('maxHarmonicsSlider'),
  maxHarmonicsValue: document.getElementById('maxHarmonicsValue'),
  consecutiveNCheck: document.getElementById('consecutiveNCheck'),
  f0ModeSelect: document.getElementById('f0ModeSelect'),
  f0Explanation: document.getElementById('f0Explanation'),
  domFreqHz: document.getElementById('domFreqHz'),
  domFreqRad: document.getElementById('domFreqRad'),
  domAmpVal: document.getElementById('domAmpVal'),
  domPeriodVal: document.getElementById('domPeriodVal'),
  domHarmonicN: document.getElementById('domHarmonicN'),
  domAccelFreq: document.getElementById('domAccelFreq'),
  statPoints: document.getElementById('statPoints'),
  statFs: document.getElementById('statFs'),
  statMeanAccel: document.getElementById('statMeanAccel'),
  statR2: document.getElementById('statR2'),
  statUsedCount: document.getElementById('statUsedCount'),
  rawAccelCard: document.getElementById('rawAccelCard'),
  usedNBages: document.getElementById('usedNBages'),
  explicitEquation: document.getElementById('explicitEquation'),
  coeffTableBody: document.getElementById('coeffTableBody'),
  showAllHarmonicsCheck: document.getElementById('showAllHarmonicsCheck'),
  btnSampleResonance: document.getElementById('btnSampleResonance'),
  btnDownloadSample: document.getElementById('btnDownloadSample'),
  btnCopyEquation: document.getElementById('btnCopyEquation'),
  btnExportCSV: document.getElementById('btnExportCSV'),
  fourierFormulaBox: document.getElementById('fourierFormulaBox')
};

/* ==========================================================================
   1. PARSEO DE ARCHIVOS .TXT (FORMATO COOLTERM Y ESTÁNDAR DE ARDUINO)
   ========================================================================== */

/**
 * Lee archivos .txt de Arduino / CoolTerm:
 * - Ignora encabezados de configuración tipo "Port = COM3", "BaudRate = 115200", etc.
 * - Soporta el formato concatenado con punto de CoolTerm/Arduino:
 *   Ejemplo: "0.052.1.6082" -> t = 0.052, a = 1.6082
 *   Ejemplo: "10.025.-1.5792" -> t = 10.025, a = -1.5792
 * - Soporta también columnas separadas por coma, espacio, punto y coma o tabulación.
 */
function parseArduinoTxt(text) {
  const lines = text.split(/\r?\n/);
  const rawT = [];
  const rawVal = [];

  // Regex para formato unido por punto: Ej. "0.000.1.1333" o "12.345.-0.9876"
  const dotConcatRegex = /^([+-]?\d+\.\d+)\.([+-]?\d+(?:\.\d+)?)$/;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    // Ignorar líneas de configuración de CoolTerm (ej. "Port = COM3", "WindowPosition = 10,130,700,481")
    if (line.includes('=') || /^[A-Za-z]/.test(line)) continue;

    // Caso 1: Formato concatenado con punto "t.val" (ej. 0.052.1.6082)
    const matchDot = line.match(dotConcatRegex);
    if (matchDot) {
      const tVal = parseFloat(matchDot[1]);
      const yVal = parseFloat(matchDot[2]);
      if (Number.isFinite(tVal) && Number.isFinite(yVal)) {
        rawT.push(tVal);
        rawVal.push(yVal);
        continue;
      }
    }

    // Caso 2: Separadores clásicos (espacio, tabulación, coma, punto y coma)
    let normalized = line;
    if (line.includes(';') || (line.includes('\t') && line.includes(','))) {
      normalized = line.replace(/,/g, '.');
    }

    const parts = normalized.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length >= 2) {
      const tVal = parseFloat(parts[0]);
      const yVal = parseFloat(parts[1]);
      if (Number.isFinite(tVal) && Number.isFinite(yVal)) {
        rawT.push(tVal);
        rawVal.push(yVal);
      }
    }
  }

  return { rawT, rawVal };
}

/* ==========================================================================
   2. CÁLCULO DE POSICIÓN x(t) A PARTIR DE LA ACELERACIÓN a(t)
   ========================================================================== */

/**
 * Elimina la tendencia lineal (offset + pendiente) de un arreglo y(t) por mínimos cuadrados.
 * Esencial al integrar datos reales de acelerómetros de Arduino para evitar deriva parabólica.
 */
function removeLinearTrend(t, y) {
  const n = t.length;
  if (n < 2) return [...y];
  let sumT = 0, sumY = 0, sumTT = 0, sumTY = 0;
  for (let i = 0; i < n; i++) {
    sumT += t[i];
    sumY += y[i];
    sumTT += t[i] * t[i];
    sumTY += t[i] * y[i];
  }
  const denom = n * sumTT - sumT * sumT;
  if (Math.abs(denom) < 1e-12) {
    const mean = sumY / n;
    return y.map(v => v - mean);
  }
  const slope = (n * sumTY - sumT * sumY) / denom;
  const intercept = (sumY - slope * sumT) / n;
  return y.map((v, i) => v - (slope * t[i] + intercept));
}

/**
 * Integra numéricamente mediante la regla del trapecio: z(t_i) = \int_0^{t_i} y(t) dt
 */
function cumulativeTrapezoid(t, y) {
  const n = t.length;
  const integral = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const dt = t[i] - t[i - 1];
    integral[i] = integral[i - 1] + 0.5 * (y[i] + y[i - 1]) * dt;
  }
  return integral;
}

/**
 * Preprocesa el tiempo y calcula la Posición x(t) a partir de la Aceleración a(t)
 * antes de ejecutar el análisis de Serie de Fourier.
 */
function preprocessAndComputePosition() {
  if (state.rawT.length < 4) return false;

  // Ordenar muestras por tiempo ascendente y eliminar duplicados exactos de timestamp
  const sorted = state.rawT
    .map((t, idx) => ({ t, val: state.rawVal[idx] }))
    .sort((a, b) => a.t - b.t);

  const pairs = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].t > pairs[pairs.length - 1].t) {
      pairs.push(sorted[i]);
    }
  }
  if (pairs.length < 4) return false;

  // Escala de unidad de tiempo
  let scale = 1.0;
  const totalSpanRaw = pairs[pairs.length - 1].t - pairs[0].t;
  const avgDtRaw = totalSpanRaw / (pairs.length - 1);

  if (state.timeUnit === 'ms') {
    scale = 1e-3;
  } else if (state.timeUnit === 'us') {
    scale = 1e-6;
  } else if (state.timeUnit === 'auto') {
    if (avgDtRaw > 1.5 && totalSpanRaw > 100) {
      scale = 1e-3;
    }
  }

  const t0 = pairs[0].t * scale;
  const t = pairs.map(p => p.t * scale - t0);
  const rawSignal = pairs.map(p => p.val);
  const N = t.length;

  state.t = t;
  state.meanRawAccel = rawSignal.reduce((s, v) => s + v, 0) / N;

  if (state.signalType === 'position') {
    // Si el archivo ya era posición directamente
    state.accel = rawSignal;
    state.vel = new Array(N).fill(0);
    state.x = [...rawSignal];
    return true;
  }

  // El archivo contiene Tiempo y Aceleración a(t)
  state.accel = rawSignal;

  // 1. Centrar la aceleración dinámica (quitar gravedad/offset constante y deriva lenta del sensor)
  const accelDynamic = removeLinearTrend(t, rawSignal);

  if (state.integrationMethod === 'trapezoidal_detrend') {
    // Paso A: Primera integración -> Velocidad v(t) = \int a_din(t) dt
    const vRaw = cumulativeTrapezoid(t, accelDynamic);
    // Eliminar velocidad media y deriva lineal de v(t)
    const vClean = removeLinearTrend(t, vRaw);
    state.vel = vClean;

    // Paso B: Segunda integración -> Posición x(t) = \int v(t) dt
    const xRaw = cumulativeTrapezoid(t, vClean);
    // Eliminar deriva remanente para obtener la oscilación pura alrededor del equilibrio x = 0
    const xClean = removeLinearTrend(t, xRaw);
    state.x = xClean;
  } else {
    // Integración armónica espectral directa: como a_n(t) = -\omega_n^2 x_n(t) => x_n(t) = -a_n(t) / \omega_n^2
    const TWindow = t[N - 1] - t[0];
    const f0 = 1 / TWindow;
    const w0 = 2 * Math.PI * f0;
    const maxK = Math.min(80, Math.floor(N / 2) - 1);

    const vSynth = new Array(N).fill(0);
    const xSynth = new Array(N).fill(0);

    for (let k = 1; k <= maxK; k++) {
      const wk = k * w0;
      let sumC = 0, sumS = 0;
      for (let i = 0; i < N; i++) {
        const dt = i === 0 ? (t[1] - t[0]) : (i === N - 1 ? (t[N - 1] - t[N - 2]) : 0.5 * (t[i + 1] - t[i - 1]));
        const ang = wk * t[i];
        sumC += accelDynamic[i] * Math.cos(ang) * dt;
        sumS += accelDynamic[i] * Math.sin(ang) * dt;
      }
      const ak = (2 / TWindow) * sumC;
      const bk = (2 / TWindow) * sumS;

      for (let i = 0; i < N; i++) {
        const ang = wk * t[i];
        // v(t) = \int a(t) dt => (a_k/wk) sin(wk t) - (b_k/wk) cos(wk t)
        vSynth[i] += (ak / wk) * Math.sin(ang) - (bk / wk) * Math.cos(ang);
        // x(t) = -a(t) / wk^2
        xSynth[i] += -(ak / (wk * wk)) * Math.cos(ang) - (bk / (wk * wk)) * Math.sin(ang);
      }
    }
    state.vel = vSynth;
    state.x = xSynth;
  }

  return true;
}

/* ==========================================================================
   3. ANÁLISIS ESPECTRAL Y SERIE DE FOURIER SOBRE x(t)
   ========================================================================== */

/**
 * Encuentra la frecuencia de mayor amplitud mediante proyección armónica continua
 * (adecuada incluso cuando el muestreo de Arduino en CoolTerm tiene pequeños saltos de dt).
 */
function findDominantFrequency(t, yCentered, dtAvg, TWindow) {
  const N = t.length;
  const fMin = 1 / TWindow;
  const fNyquist = 0.5 / dtAvg;
  const maxSearchFreq = Math.min(fNyquist * 0.9, 120 * fMin);

  const numSteps = Math.min(2000, Math.max(500, N * 3));
  let bestFreq = fMin;
  let maxPower = -1;

  for (let i = 1; i <= numSteps; i++) {
    const f = fMin * 0.5 + (i / numSteps) * (maxSearchFreq - fMin * 0.5);
    const p = evalHarmonicPower(t, yCentered, f);
    if (p > maxPower) {
      maxPower = p;
      bestFreq = f;
    }
  }

  // Refinamiento fino alrededor del máximo
  const df = (maxSearchFreq - fMin * 0.5) / numSteps;
  let fLow = Math.max(fMin * 0.25, bestFreq - df);
  let fHigh = Math.min(fNyquist, bestFreq + df);

  for (let iter = 0; iter < 22; iter++) {
    const f1 = fLow + (fHigh - fLow) / 3;
    const f2 = fHigh - (fHigh - fLow) / 3;
    if (evalHarmonicPower(t, yCentered, f1) < evalHarmonicPower(t, yCentered, f2)) {
      fLow = f1;
    } else {
      fHigh = f2;
    }
  }

  return 0.5 * (fLow + fHigh);
}

function evalHarmonicPower(t, yCentered, f) {
  const w = 2 * Math.PI * f;
  let c = 0, s = 0;
  for (let k = 0; k < t.length; k++) {
    const wt = w * t[k];
    c += yCentered[k] * Math.cos(wt);
    s += yCentered[k] * Math.sin(wt);
  }
  return c * c + s * s;
}

/**
 * Calcula los coeficientes de Fourier de x(t), selecciona los armónicos "n" de mejor ajuste,
 * y determina la frecuencia de mayor amplitud de la oscilación.
 */
function computeFourierAnalysis() {
  const t = state.t;
  const x = state.x;
  const M = t.length;
  if (M < 4) return;

  const TWindow = t[M - 1] - t[0];
  const dtAvg = TWindow / (M - 1);
  const fs = 1 / dtAvg;

  // Valor medio de x(t)
  const meanX = x.reduce((s, v) => s + v, 0) / M;
  const a0 = 2 * meanX;
  const xCentered = x.map(v => v - meanX);
  const totalSS = xCentered.reduce((s, v) => s + v * v, 0) || 1e-12;

  // Frecuencia dominante en x(t) y en la aceleración original a(t)
  const fPeakPos = findDominantFrequency(t, xCentered, dtAvg, TWindow);
  const accelCentered = removeLinearTrend(t, state.accel);
  const fPeakAccel = findDominantFrequency(t, accelCentered, dtAvg, TWindow);

  // Definir frecuencia base f0 de la Serie de Fourier
  let f0;
  let maxN;
  if (state.f0Mode === 'fundamental') {
    f0 = fPeakPos;
    maxN = Math.min(40, Math.floor((0.45 * fs) / f0));
  } else {
    f0 = 1 / TWindow;
    maxN = Math.min(75, Math.floor(M / 2) - 2);
  }
  maxN = Math.max(1, maxN);
  const w0 = 2 * Math.PI * f0;

  // Pesos de integración trapezoidal para manejar pasos de tiempo no uniformes de Arduino
  const weights = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    if (i === 0) weights[i] = 0.5 * (t[1] - t[0]);
    else if (i === M - 1) weights[i] = 0.5 * (t[M - 1] - t[M - 2]);
    else weights[i] = 0.5 * (t[i + 1] - t[i - 1]);
  }

  // Calcular todos los armónicos candidatos n = 1 ... maxN
  const harmonics = [];
  let sumEnergyAll = 0;

  for (let n = 1; n <= maxN; n++) {
    const fn = n * f0;
    const wn = n * w0;
    let sumCos = 0;
    let sumSin = 0;

    for (let k = 0; k < M; k++) {
      const angle = wn * t[k];
      const w = weights[k];
      sumCos += xCentered[k] * Math.cos(angle) * w;
      sumSin += xCentered[k] * Math.sin(angle) * w;
    }

    const an = (2 / TWindow) * sumCos;
    const bn = (2 / TWindow) * sumSin;
    const Cn = Math.hypot(an, bn);
    const phin = Math.atan2(bn, an);
    const energy = 0.5 * (an * an + bn * bn);
    sumEnergyAll += energy;

    harmonics.push({
      n,
      fn,
      wn,
      an,
      bn,
      Cn,
      phin,
      energy,
      used: false
    });
  }

  const denomEnergy = Math.max(sumEnergyAll, 1e-12);
  harmonics.forEach(h => {
    h.energyPct = (h.energy / denomEnergy) * 100;
  });

  // Ordenar por amplitud C_n descendente
  const sortedByAmp = [...harmonics].sort((a, b) => b.Cn - a.Cn);

  // Actualizar rango del slider manual
  els.maxHarmonicsSlider.max = maxN;
  if (state.manualCount > maxN) {
    state.manualCount = maxN;
    els.maxHarmonicsSlider.value = maxN;
    els.maxHarmonicsValue.textContent = maxN;
  }

  // Selección de los armónicos "n" para el mejor ajuste de la serie
  const selectedNSet = new Set();

  if (state.mode === 'auto') {
    let cumEnergy = 0;
    for (let i = 0; i < sortedByAmp.length; i++) {
      const h = sortedByAmp[i];
      selectedNSet.add(h.n);
      cumEnergy += h.energy / denomEnergy;
      if (cumEnergy >= state.r2Target || selectedNSet.size >= 22) break;
    }
  } else {
    const K = Math.min(state.manualCount, maxN);
    if (state.consecutiveN) {
      for (let n = 1; n <= K; n++) selectedNSet.add(n);
    } else {
      for (let i = 0; i < K; i++) selectedNSet.add(sortedByAmp[i].n);
    }
  }

  const selectedList = harmonics
    .filter(h => selectedNSet.has(h.n))
    .sort((a, b) => a.n - b.n);

  // Ajuste exacto por Mínimos Cuadrados sobre la malla temporal no uniforme del Arduino
  refineCoefficientsLeastSquares(t, xCentered, selectedList);

  // Actualizar porcentajes de energía tras el refinamiento
  let totalRefinedEnergy = harmonics.reduce((s, h) => s + 0.5 * (h.an * h.an + h.bn * h.bn), 0) || 1e-12;
  harmonics.forEach(h => {
    h.used = selectedNSet.has(h.n);
    h.energy = 0.5 * (h.an * h.an + h.bn * h.bn);
    h.energyPct = (h.energy / totalRefinedEnergy) * 100;
  });

  // El armónico con mayor amplitud C_n
  const finalSorted = [...harmonics].sort((a, b) => b.Cn - a.Cn);
  const bestHarmonic = finalSorted[0];

  // Evaluar R² de la serie ajustada respecto a x(t)
  let ssRes = 0;
  for (let k = 0; k < M; k++) {
    let yHat = meanX;
    for (const h of selectedList) {
      const angle = h.wn * t[k];
      yHat += h.an * Math.cos(angle) + h.bn * Math.sin(angle);
    }
    const err = x[k] - yHat;
    ssRes += err * err;
  }

  const r2 = Math.max(0, Math.min(1, 1 - ssRes / totalSS));

  // Generar curva continua de alta resolución para graficar la Serie de Fourier encima de x(t)
  const denseCount = Math.min(1800, Math.max(600, M * 4));
  const tDense = [];
  const xFitDense = [];
  for (let i = 0; i < denseCount; i++) {
    const tk = t[0] + (i / (denseCount - 1)) * TWindow;
    let yVal = meanX;
    for (const h of selectedList) {
      const angle = h.wn * tk;
      yVal += h.an * Math.cos(angle) + h.bn * Math.sin(angle);
    }
    tDense.push(tk);
    xFitDense.push(yVal);
  }

  state.analysis = {
    M,
    fs,
    TWindow,
    a0,
    meanX,
    f0,
    w0,
    r2,
    fPeakPos,
    fPeakAccel,
    harmonics,
    selectedList,
    bestHarmonic,
    tDense,
    xFitDense
  };

  renderUI();
}

/**
 * Refina los coeficientes (a_n, b_n) de los armónicos seleccionados resolviendo
 * el sistema lineal de mínimos cuadrados en los tiempos exactos medidos por Arduino.
 */
function refineCoefficientsLeastSquares(t, xCentered, selectedList) {
  const K = selectedList.length;
  if (K === 0) return;
  const M = t.length;
  const dim = 2 * K;

  const A = Array.from({ length: dim }, () => new Float64Array(dim));
  const b = new Float64Array(dim);
  const basis = new Float64Array(dim);

  for (let m = 0; m < M; m++) {
    const tm = t[m];
    const ym = xCentered[m];
    for (let i = 0; i < K; i++) {
      const angle = selectedList[i].wn * tm;
      basis[2 * i] = Math.cos(angle);
      basis[2 * i + 1] = Math.sin(angle);
    }
    for (let r = 0; r < dim; r++) {
      const br = basis[r];
      b[r] += br * ym;
      for (let c = r; c < dim; c++) {
        A[r][c] += br * basis[c];
      }
    }
  }

  for (let r = 0; r < dim; r++) {
    A[r][r] += 1e-8;
    for (let c = 0; c < r; c++) {
      A[r][c] = A[c][r];
    }
  }

  const sol = solveLinearSystem(A, b);
  if (!sol) return;

  for (let i = 0; i < K; i++) {
    const an = sol[2 * i];
    const bn = sol[2 * i + 1];
    selectedList[i].an = an;
    selectedList[i].bn = bn;
    selectedList[i].Cn = Math.hypot(an, bn);
    selectedList[i].phin = Math.atan2(bn, an);
  }
}

function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let k = 0; k < n; k++) {
    let iMax = k;
    let maxVal = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(M[i][k]) > maxVal) {
        maxVal = Math.abs(M[i][k]);
        iMax = i;
      }
    }
    if (maxVal < 1e-12) return null;
    if (iMax !== k) {
      const temp = M[k];
      M[k] = M[iMax];
      M[iMax] = temp;
    }
    for (let i = k + 1; i < n; i++) {
      const factor = M[i][k] / M[k][k];
      for (let j = k; j <= n; j++) {
        M[i][j] -= factor * M[k][j];
      }
    }
  }

  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * x[j];
    }
    x[i] = sum / M[i][i];
  }
  return x;
}

/* ==========================================================================
   4. RENDERIZADO DE INTERFAZ, GRÁFICAS Y TABLA DE COEFICIENTES
   ========================================================================== */

function formatNum(val, decimals = 4) {
  if (!Number.isFinite(val)) return '—';
  if (Math.abs(val) < 1e-4 && Math.abs(val) > 0) return val.toExponential(2);
  return val.toFixed(decimals);
}

function renderUI() {
  const res = state.analysis;
  if (!res) return;

  const dom = res.bestHarmonic;

  // 1. Tarjeta de Frecuencia para la Mayor Amplitud (Resonancia Experimental)
  els.domFreqHz.textContent = formatNum(dom.fn, 4);
  els.domFreqRad.textContent = formatNum(dom.wn, 4);
  els.domAmpVal.textContent = `${formatNum(dom.Cn, 4)} u`;
  els.domPeriodVal.textContent = `${formatNum(1 / dom.fn, 3)} s`;
  els.domHarmonicN.textContent = `n = ${dom.n} (f_n = ${formatNum(dom.fn, 4)} Hz)`;
  els.domAccelFreq.textContent = `${formatNum(res.fPeakAccel, 4)} Hz (${formatNum(2 * Math.PI * res.fPeakAccel, 3)} rad/s)`;

  // 2. Barra de Estadísticas
  els.statPoints.textContent = res.M.toLocaleString();
  els.statFs.textContent = `${formatNum(res.fs, 1)} Hz`;
  els.statMeanAccel.textContent = formatNum(state.meanRawAccel, 4);
  els.statR2.textContent = `${(res.r2 * 100).toFixed(2)}%`;
  els.statUsedCount.textContent = `${res.selectedList.length} de ${res.harmonics.length}`;

  // Mostrar/ocultar tarjeta de aceleración según el tipo de entrada
  if (state.signalType === 'acceleration') {
    els.rawAccelCard.classList.remove('hidden');
    els.integrationMethodGroup.classList.remove('hidden');
  } else {
    els.rawAccelCard.classList.add('hidden');
    els.integrationMethodGroup.classList.add('hidden');
  }

  // 3. Los "n" utilizados en el mejor ajuste
  els.usedNBages.innerHTML = '';
  res.selectedList.forEach(h => {
    const span = document.createElement('span');
    const isDom = h.n === dom.n;
    span.className = `n-badge ${isDom ? 'dominant' : ''}`;
    span.textContent = isDom
      ? `n = ${h.n} ★ (Máx Amp: ${formatNum(h.fn, 3)} Hz)`
      : `n = ${h.n} (${formatNum(h.fn, 3)} Hz)`;
    els.usedNBages.appendChild(span);
  });

  // 4. Ecuación explícita de la Serie de Fourier
  const terms = [];
  if (Math.abs(res.meanX) > 1e-5) {
    terms.push(formatNum(res.meanX, 4));
  }
  res.selectedList.forEach(h => {
    const wStr = formatNum(h.wn, 3);
    const aStr = `${h.an >= 0 ? '+ ' : '- '}${formatNum(Math.abs(h.an), 4)}·cos(${wStr}·t)`;
    const bStr = `${h.bn >= 0 ? '+ ' : '- '}${formatNum(Math.abs(h.bn), 4)}·sin(${wStr}·t)`;
    terms.push(`${aStr} ${bStr}   [n=${h.n}, f=${formatNum(h.fn, 3)} Hz]`);
  });
  els.explicitEquation.textContent = `x(t) ≈ ${terms.join('\n       ')}`;

  // 5. Tabla de Coeficientes de Fourier
  const rowsToShow = state.showAllHarmonics
    ? res.harmonics
    : res.harmonics.filter(h => h.used || h.n <= 10);

  els.coeffTableBody.innerHTML = '';
  rowsToShow.forEach(h => {
    const tr = document.createElement('tr');
    const isDom = h.n === dom.n;
    if (isDom) tr.classList.add('row-dominant');
    if (!h.used) tr.classList.add('row-unused');

    let statusHtml = '';
    if (isDom) {
      statusHtml = `<span class="status-pill status-max">★ Mayor Amplitud</span>`;
    } else if (h.used) {
      statusHtml = `<span class="status-pill status-used">✓ En Ajuste</span>`;
    } else {
      statusHtml = `<span class="status-pill status-ignored">No usado</span>`;
    }

    tr.innerHTML = `
      <td>${statusHtml}</td>
      <td><strong>n = ${h.n}</strong></td>
      <td>${formatNum(h.fn, 4)}</td>
      <td>${formatNum(h.wn, 4)}</td>
      <td>${formatNum(h.an, 5)}</td>
      <td>${formatNum(h.bn, 5)}</td>
      <td><strong>${formatNum(h.Cn, 5)}</strong></td>
      <td>${formatNum(h.phin, 4)}</td>
      <td>${h.energyPct.toFixed(2)}%</td>
    `;
    els.coeffTableBody.appendChild(tr);
  });

  // 6. Actualizar las gráficas
  renderPlots(res);
}

/* ==========================================================================
   ZOOM INTERACTIVO PARA LAS GRÁFICAS
   ========================================================================== */

const plotZoomState = {};

function getPlotAxisRanges(plotId) {
  const gd = document.getElementById(plotId);
  if (!gd) return null;
  const layout = gd._fullLayout || gd.layout;
  if (!layout || !layout.xaxis || !layout.yaxis) return null;
  const ranges = {
    x: [layout.xaxis.range[0], layout.xaxis.range[1]],
    y: [layout.yaxis.range[0], layout.yaxis.range[1]]
  };
  if (layout.yaxis2) {
    ranges.y2 = [layout.yaxis2.range[0], layout.yaxis2.range[1]];
  }
  return ranges;
}

function zoomPlot(plotId, factor) {
  const gd = document.getElementById(plotId);
  if (!gd) return;
  const ranges = getPlotAxisRanges(plotId);
  if (!ranges || isNaN(ranges.x[0]) || isNaN(ranges.x[1])) return;

  const x0 = ranges.x[0], x1 = ranges.x[1];
  const xMid = (x0 + x1) / 2;
  const xSpan = (x1 - x0) * factor;
  const newRangeX = [xMid - xSpan / 2, xMid + xSpan / 2];

  const updateObj = {
    'xaxis.range': newRangeX,
    'xaxis.autorange': false
  };

  if (!isNaN(ranges.y[0]) && !isNaN(ranges.y[1])) {
    const y0 = ranges.y[0], y1 = ranges.y[1];
    const yMid = (y0 + y1) / 2;
    const ySpan = (y1 - y0) * factor;
    updateObj['yaxis.range'] = [yMid - ySpan / 2, yMid + ySpan / 2];
    updateObj['yaxis.autorange'] = false;
  }

  if (ranges.y2 && !isNaN(ranges.y2[0]) && !isNaN(ranges.y2[1])) {
    const y20 = ranges.y2[0], y21 = ranges.y2[1];
    const y2Mid = (y20 + y21) / 2;
    const y2Span = (y21 - y20) * factor;
    updateObj['yaxis2.range'] = [y2Mid - y2Span / 2, y2Mid + y2Span / 2];
    updateObj['yaxis2.autorange'] = false;
  }

  plotZoomState[plotId] = plotZoomState[plotId] || {};
  Object.assign(plotZoomState[plotId], updateObj);

  Plotly.relayout(plotId, updateObj);
}

function resetPlotZoom(plotId) {
  delete plotZoomState[plotId];
  const updateObj = {
    'xaxis.autorange': true,
    'yaxis.autorange': true
  };
  const gd = document.getElementById(plotId);
  if (gd && (gd._fullLayout || gd.layout)?.yaxis2) {
    updateObj['yaxis2.autorange'] = true;
  }
  Plotly.relayout(plotId, updateObj);
}

function attachZoomListener(plotId) {
  const gd = document.getElementById(plotId);
  if (!gd || gd._hasZoomListener) return;
  gd._hasZoomListener = true;
  gd.on('plotly_relayout', function(eventData) {
    if (!eventData) return;
    if (eventData['xaxis.range[0]'] !== undefined && eventData['xaxis.range[1]'] !== undefined) {
      plotZoomState[plotId] = plotZoomState[plotId] || {};
      plotZoomState[plotId]['xaxis.range'] = [eventData['xaxis.range[0]'], eventData['xaxis.range[1]']];
      plotZoomState[plotId]['xaxis.autorange'] = false;
      if (eventData['yaxis.range[0]'] !== undefined && eventData['yaxis.range[1]'] !== undefined) {
        plotZoomState[plotId]['yaxis.range'] = [eventData['yaxis.range[0]'], eventData['yaxis.range[1]']];
        plotZoomState[plotId]['yaxis.autorange'] = false;
      }
      if (eventData['yaxis2.range[0]'] !== undefined && eventData['yaxis2.range[1]'] !== undefined) {
        plotZoomState[plotId]['yaxis2.range'] = [eventData['yaxis2.range[0]'], eventData['yaxis2.range[1]']];
        plotZoomState[plotId]['yaxis2.autorange'] = false;
      }
    } else if (eventData['xaxis.autorange'] === true) {
      delete plotZoomState[plotId];
    }
  });
}

window.zoomPlot = zoomPlot;
window.resetPlotZoom = resetPlotZoom;

function renderPlots(res) {
  const dom = res.bestHarmonic;

  // --- GRÁFICA 1: Posición calculada x(t) y Serie de Fourier encima en otro color ---
  const tracePos = {
    x: state.t,
    y: state.x,
    mode: 'lines+markers',
    name: 'Posición calculada x(t)',
    line: { color: '#38bdf8', width: 1.8 },
    marker: { color: '#38bdf8', size: 4.5, opacity: 0.8 }
  };

  const nListStr = res.selectedList.map(h => h.n).join(', ');
  const traceFourier = {
    x: res.tDense,
    y: res.xFitDense,
    mode: 'lines',
    name: `Serie de Fourier ajustada (n = ${nListStr})`,
    line: { color: '#f97316', width: 3.2 }
  };

  const layoutTime = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(11,15,25,0.65)',
    margin: { t: 22, r: 25, b: 46, l: 60 },
    font: { family: 'Inter, sans-serif', color: '#cbd5e1' },
    xaxis: {
      title: 'Tiempo t (s)',
      gridcolor: '#1e293b',
      zerolinecolor: '#334155'
    },
    yaxis: {
      title: 'Posición x(t)',
      gridcolor: '#1e293b',
      zerolinecolor: '#334155'
    },
    legend: { orientation: 'h', y: 1.12, x: 0 },
    hovermode: 'x unified'
  };

  if (plotZoomState['timePlot']) {
    layoutTime.xaxis.range = plotZoomState['timePlot']['xaxis.range'];
    layoutTime.xaxis.autorange = false;
    if (plotZoomState['timePlot']['yaxis.range']) {
      layoutTime.yaxis.range = plotZoomState['timePlot']['yaxis.range'];
      layoutTime.yaxis.autorange = false;
    }
  }

  Plotly.react('timePlot', [tracePos, traceFourier], layoutTime, {
    responsive: true,
    displaylogo: false
  });
  attachZoomListener('timePlot');

  // --- GRÁFICA 2: Aceleración original a(t) y Velocidad integrada v(t) ---
  if (state.signalType === 'acceleration') {
    const traceAccel = {
      x: state.t,
      y: state.accel,
      mode: 'lines+markers',
      name: 'Aceleración leída a(t)',
      line: { color: '#a855f7', width: 1.5 },
      marker: { color: '#a855f7', size: 3.5 }
    };

    const traceVel = {
      x: state.t,
      y: state.vel,
      mode: 'lines',
      name: 'Velocidad integrada v(t)',
      yaxis: 'y2',
      line: { color: '#10b981', width: 1.8, dash: 'dot' }
    };

    const layoutAccel = {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(11,15,25,0.65)',
      margin: { t: 20, r: 60, b: 44, l: 60 },
      font: { family: 'Inter, sans-serif', color: '#cbd5e1' },
      xaxis: {
        title: 'Tiempo t (s)',
        gridcolor: '#1e293b'
      },
      yaxis: {
        title: 'Aceleración a(t)',
        titlefont: { color: '#c084fc' },
        tickfont: { color: '#c084fc' },
        gridcolor: '#1e293b'
      },
      yaxis2: {
        title: 'Velocidad v(t)',
        titlefont: { color: '#34d399' },
        tickfont: { color: '#34d399' },
        overlaying: 'y',
        side: 'right'
      },
      legend: { orientation: 'h', y: 1.15, x: 0 },
      hovermode: 'x unified'
    };

    if (plotZoomState['accelPlot']) {
      layoutAccel.xaxis.range = plotZoomState['accelPlot']['xaxis.range'];
      layoutAccel.xaxis.autorange = false;
      if (plotZoomState['accelPlot']['yaxis.range']) {
        layoutAccel.yaxis.range = plotZoomState['accelPlot']['yaxis.range'];
        layoutAccel.yaxis.autorange = false;
      }
      if (plotZoomState['accelPlot']['yaxis2.range']) {
        layoutAccel.yaxis2.range = plotZoomState['accelPlot']['yaxis2.range'];
        layoutAccel.yaxis2.autorange = false;
      }
    }

    Plotly.react('accelPlot', [traceAccel, traceVel], layoutAccel, {
      responsive: true,
      displaylogo: false
    });
    attachZoomListener('accelPlot');
  }

  // --- GRÁFICA 3: Espectro de Amplitudes C_n vs Frecuencia f_n ---
  const colors = res.harmonics.map(h => {
    if (h.n === dom.n) return '#f97316';
    if (h.used) return '#38bdf8';
    return '#475569';
  });

  const traceSpectrum = {
    x: res.harmonics.map(h => h.fn),
    y: res.harmonics.map(h => h.Cn),
    customdata: res.harmonics.map(h => [h.n, h.an, h.bn, h.energyPct]),
    type: 'bar',
    marker: {
      color: colors,
      line: { width: 1, color: 'rgba(255,255,255,0.2)' }
    },
    hovertemplate:
      '<b>Armónico n = %{customdata[0]}</b><br>' +
      'Frecuencia f_n = %{x:.4f} Hz<br>' +
      'Amplitud C_n = %{y:.5f}<br>' +
      'a_n = %{customdata[1]:.5f}, b_n = %{customdata[2]:.5f}<br>' +
      'Energía = %{customdata[3]:.2f}%<extra></extra>'
  };

  const layoutSpectrum = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(11,15,25,0.65)',
    margin: { t: 28, r: 25, b: 46, l: 60 },
    font: { family: 'Inter, sans-serif', color: '#cbd5e1' },
    xaxis: {
      title: 'Frecuencia f_n (Hz)',
      gridcolor: '#1e293b'
    },
    yaxis: {
      title: 'Amplitud en Posición C_n',
      gridcolor: '#1e293b'
    },
    annotations: [
      {
        x: dom.fn,
        y: dom.Cn,
        xref: 'x',
        yref: 'y',
        text: `★ Mayor Amplitud: f = ${dom.fn.toFixed(4)} Hz (n=${dom.n})`,
        showarrow: true,
        arrowhead: 2,
        ax: 20,
        ay: -28,
        bgcolor: 'rgba(249, 115, 22, 0.92)',
        font: { color: '#0b0f19', size: 11, family: 'JetBrains Mono, monospace' },
        borderpad: 4
      }
    ]
  };

  if (plotZoomState['spectrumPlot']) {
    layoutSpectrum.xaxis.range = plotZoomState['spectrumPlot']['xaxis.range'];
    layoutSpectrum.xaxis.autorange = false;
    if (plotZoomState['spectrumPlot']['yaxis.range']) {
      layoutSpectrum.yaxis.range = plotZoomState['spectrumPlot']['yaxis.range'];
      layoutSpectrum.yaxis.autorange = false;
    }
  }

  Plotly.react('spectrumPlot', [traceSpectrum], layoutSpectrum, {
    responsive: true,
    displaylogo: false
  });
  attachZoomListener('spectrumPlot');
}

/* ==========================================================================
   5. DATOS REALES DEL USUARIO (ARCHIVO COOLTERM DE ARDUINO)
   ========================================================================== */

const USER_COOLTERM_DATA = `Port = COM3
BaudRate = 115200
DataBits = 8
Parity = N
StopBits = 1
WindowPosition = 10,130,700,481

0.000.1.1333
0.052.1.6082
0.108.1.6082
0.177.1.0111
0.229.1.7260
0.281.0.8639
0.333.2.0816
0.386.1.6082
0.514.1.6082
0.565.1.4560
0.617.1.3307
0.669.1.7255
0.722.1.9377
0.774.1.6308
0.826.1.0437
0.878.1.5187
0.931.1.2151
0.984.1.2699
1.036.1.2363
1.088.1.3972
1.140.1.4753
1.193.1.4449
1.245.1.6794
1.297.1.4963
1.349.1.2643
1.401.1.3786
1.454.1.6082
1.537.1.5039
1.589.2.2327
1.642.1.6298
1.694.1.6082
1.748.1.6082
1.814.1.7804
1.866.1.1876
1.919.2.7945
1.972.1.6082
2.061.1.6082
2.165.1.4278
2.218.3.0422
2.270.1.5304
2.322.1.6082
2.454.1.5392
2.506.1.5486
2.559.2.2869
2.611.2.4821
2.663.1.6082
2.738.1.4285
2.790.1.7316
2.842.1.2855
2.894.1.7831
2.947.2.9367
2.999.1.6434
3.051.1.4617
3.103.1.4282
3.156.1.9774
3.208.2.2858
3.260.1.4449
3.312.2.7770
3.365.2.3844
3.418.1.5230
3.470.1.5229
3.522.1.8941
3.574.2.1314
3.627.2.2206
3.679.1.8592
3.731.2.1283
3.783.1.6957
3.836.1.7497
3.888.1.3838
3.940.1.6493
3.993.2.5278
4.045.1.7146
4.098.2.5645
4.150.2.4651
4.202.1.8672
4.254.1.7239
4.307.1.5420
4.359.1.7632
4.411.2.7113
4.463.1.4260
4.515.2.4813
4.568.1.6082
4.621.1.7030
4.673.1.4832
4.725.1.1157
4.778.1.1966
4.830.2.3296
4.882.1.5559
4.934.3.3145
4.988.2.0389
5.040.1.8447
5.092.1.1322
5.144.2.0400
5.196.2.3795
5.249.3.6566
5.301.7243
5.301.1.7243
5.353.1.7912
5.405.2.1662
5.458.1.4874
5.510.2.3112
5.562.3.0553
5.614.1.8801
5.667.1.1366
5.720.2.1274
5.772.2.2201
5.824.4.1444
5.876.3.2302
5.929.1.4642
5.981.1.3866
6.033.1.4160
6.085.1.6082
6.137.1.8570
6.190.0.6396
6.242.0.5917
6.294.0.6032
6.346.1.3634
6.399.1.9453
6.451.1.6181
6.503.1.9524
6.555.2.9441
6.607.1.6082
6.674.2.6504
6.726.2.8766
6.778.1.6082
6.830.0.7311
6.882.1.7554
6.935.3.3135
6.987.3.6783
7.040.2.9885
7.092.2.7559
7.144.1.4294
7.196.2.4277
7.248.1.9666
7.301.1.3549
7.353.1.6082
7.409.3.2929
7.461.3.3379
7.514.2.0172
7.566.2.4102
7.618.1.8407
7.670.1.7921
7.723.0.9536
7.776.0.9366
7.828.0.5495
7.880.1.1533
7.933.1.0183
7.985.0.9950
8.037.0.9763
8.089.0.7812
8.141.0.8973
8.194.1.1827
8.246.1.1081
8.298.1.0424
8.350.0.9912
8.404.1.9298
8.456.0.8987
8.508.1.4816
8.560.3.3588
8.612.3.7668
8.665.2.8534
8.717.3.9718
8.769.2.5226
8.821.2.5167
8.874.1.5680
8.926.2.0615
8.978.3.1641
9.030.3.1900
9.084.2.6801
9.136.3.1954
9.188.1.4324
9.240.2.8372
9.292.1.4688
9.345.2.9534
9.397.3.5066
9.449.3.3196
9.501.1.6170
9.554.1.3486
9.606.2.7988
9.658.2.3953
9.710.1.5982
9.762.2.3696
9.816.2.8535
9.868.1.6170
9.920.2.1408
9.972.1.2092
10.025.1.5792
10.077.2.5259
10.129.3.1320
10.181.3.5990
10.233.3.1959
10.287.2.8255
10.339.2.7404
10.391.2.2949
10.443.2.5041
10.496.2.7018
10.548.2.8402
10.600.3.0987
10.652.2.5399
10.706.2.6247
10.758.1.6605
10.810.1.2609
10.862.2.7086
10.914.3.0890
10.967.3.8068
11.019.3.0223
11.072.2.8073
11.124.1.2987
11.177.1.7186
11.229.1.9235
11.281.2.1743
11.333.2.4230
11.386.2.6178
11.439.2.9157
11.491.2.2967
11.543.1.9772
11.595.1.3513
11.648.0.8318
11.700.2.4560
11.753.2.4796
11.805.2.8808
11.858.3.2298
11.910.2.3709
11.962.1.7205
12.014.0.9350
12.066.2.6846
12.119.1.7954
12.172.1.9555
12.224.2.1943
12.276.2.3219
12.329.2.9579
12.381.2.0337
12.433.2.0864
12.485.1.3519
12.538.0.8945
12.591.2.0818
12.643.2.0550
12.695.1.6082
12.817.2.4933
12.869.2.1648
12.921.1.8433
12.975.1.4279
13.027.1.1966
13.079.1.4949
13.131.1.5788
13.184.1.1329
13.236.1.4790
13.288.1.8420
13.341.1.6050
13.394.1.2019
13.446.1.4660
13.498.1.2695
13.550.1.2432
13.602.0.9065
13.655.1.0134
13.708.1.0853
13.760.1.1484
13.812.1.0046
13.865.0.7682`;

function loadTextData(content, fileName) {
  const { rawT, rawVal } = parseArduinoTxt(content);
  if (rawT.length < 6) {
    alert(
      'No se pudieron extraer suficientes muestras numéricas del archivo. Verifica que contenga pares de Tiempo y Aceleración/Posición.'
    );
    return;
  }
  state.rawT = rawT;
  state.rawVal = rawVal;
  state.fileName = fileName;
  els.fileNameDisplay.textContent = `${fileName} (${rawT.length} muestras válidas)`;

  // Restablecer zoom al cargar un nuevo archivo
  for (const k of Object.keys(plotZoomState)) {
    delete plotZoomState[k];
  }

  if (preprocessAndComputePosition()) {
    computeFourierAnalysis();
  }
}

/* ==========================================================================
   6. EVENTOS DE INTERACCIÓN
   ========================================================================== */

function initEvents() {
  window.addEventListener('load', () => {
    if (window.katex) {
      window.katex.render(
        String.raw`x_{\text{Fourier}}(t) = \frac{a_0}{2} + \sum_{n \in \mathcal{N}} \left[ a_n \cos(n\omega_0 t) + b_n \sin(n\omega_0 t) \right]`,
        els.fourierFormulaBox,
        { displayMode: true, throwOnError: false }
      );
    }
    // Cargar de inmediato los datos reales de CoolTerm enviados por el usuario
    loadTextData(USER_COOLTERM_DATA, 'datos_coolterm_arduino.txt');
  });

  // Subida de archivos por clic o arrastrar
  els.dropZone.addEventListener('click', () => els.fileInput.click());

  els.dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    els.dropZone.classList.add('drag-over');
  });

  els.dropZone.addEventListener('dragleave', () => {
    els.dropZone.classList.remove('drag-over');
  });

  els.dropZone.addEventListener('drop', e => {
    e.preventDefault();
    els.dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) readUploadedFile(file);
  });

  els.fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) readUploadedFile(file);
  });

  function readUploadedFile(file) {
    const reader = new FileReader();
    reader.onload = ev => {
      loadTextData(ev.target.result, file.name);
    };
    reader.readAsText(file);
  }

  // Selector de variable medida (Aceleración -> Posición vs Posición directa)
  els.inputSignalTypeSelect.addEventListener('change', e => {
    state.signalType = e.target.value;
    if (preprocessAndComputePosition()) computeFourierAnalysis();
  });

  // Selector de método de integración
  els.integrationMethodSelect.addEventListener('change', e => {
    state.integrationMethod = e.target.value;
    if (preprocessAndComputePosition()) computeFourierAnalysis();
  });

  els.timeUnitSelect.addEventListener('change', e => {
    state.timeUnit = e.target.value;
    if (preprocessAndComputePosition()) computeFourierAnalysis();
  });

  // Modo Automático vs Manual
  els.modeAutoBtn.addEventListener('click', () => {
    state.mode = 'auto';
    els.modeAutoBtn.classList.add('active');
    els.modeManualBtn.classList.remove('active');
    els.autoControls.classList.remove('hidden');
    els.manualControls.classList.add('hidden');
    els.fitModeBadge.textContent = 'Óptimo Automático';
    computeFourierAnalysis();
  });

  els.modeManualBtn.addEventListener('click', () => {
    state.mode = 'manual';
    els.modeManualBtn.classList.add('active');
    els.modeAutoBtn.classList.remove('active');
    els.manualControls.classList.remove('hidden');
    els.autoControls.classList.add('hidden');
    els.fitModeBadge.textContent = 'Ajuste Manual';
    computeFourierAnalysis();
  });

  // Sliders
  els.r2TargetSlider.addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    state.r2Target = val / 100;
    els.r2TargetValue.textContent = `${val.toFixed(1)}%`;
    computeFourierAnalysis();
  });

  els.maxHarmonicsSlider.addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    state.manualCount = val;
    els.maxHarmonicsValue.textContent = val;
    computeFourierAnalysis();
  });

  els.consecutiveNCheck.addEventListener('change', e => {
    state.consecutiveN = e.target.checked;
    computeFourierAnalysis();
  });

  els.f0ModeSelect.addEventListener('change', e => {
    state.f0Mode = e.target.value;
    els.f0Explanation.textContent =
      state.f0Mode === 'window'
        ? 'Con f₀ = 1/T, la Serie de Fourier representa toda la evolución temporal x(t) con sus armónicos n sobre el intervalo medido.'
        : 'Con f₀ = f_max, n=1 corresponde a la frecuencia dominante y n=2,3,... a sus sobretonos.';
    computeFourierAnalysis();
  });

  els.showAllHarmonicsCheck.addEventListener('change', e => {
    state.showAllHarmonics = e.target.checked;
    renderUI();
  });

  // Botones de datos de ejemplo (datos reales de CoolTerm)
  els.btnSampleResonance.addEventListener('click', () => {
    loadTextData(USER_COOLTERM_DATA, 'datos_coolterm_arduino.txt');
  });

  els.btnDownloadSample.addEventListener('click', () => {
    const blob = new Blob([USER_COOLTERM_DATA], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'datos_coolterm_arduino.txt';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Copiar ecuación LaTeX
  els.btnCopyEquation.addEventListener('click', () => {
    if (!state.analysis) return;
    const res = state.analysis;
    const latexTerms = [];
    if (Math.abs(res.meanX) > 1e-5) {
      latexTerms.push(`${res.meanX.toFixed(4)}`);
    }
    res.selectedList.forEach(h => {
      const signA = h.an >= 0 ? '+' : '-';
      const signB = h.bn >= 0 ? '+' : '-';
      latexTerms.push(
        `${signA} ${Math.abs(h.an).toFixed(4)}\\cos(${h.wn.toFixed(3)}t) ${signB} ${Math.abs(h.bn).toFixed(4)}\\sin(${h.wn.toFixed(3)}t)`
      );
    });
    const latexStr = `x(t) = ${latexTerms.join(' ')}`;
    navigator.clipboard.writeText(latexStr).then(() => {
      const orig = els.btnCopyEquation.textContent;
      els.btnCopyEquation.textContent = '¡Copiado al portapapeles!';
      setTimeout(() => (els.btnCopyEquation.textContent = orig), 1800);
    });
  });

  // Exportar CSV con coeficientes y también serie temporal (t, a, v, x)
  els.btnExportCSV.addEventListener('click', () => {
    if (!state.analysis) return;
    const res = state.analysis;
    let csv = '# TABLA 1: COEFICIENTES DE FOURIER DE LA POSICION x(t)\n';
    csv += 'n,usado_en_ajuste,frecuencia_Hz,omega_rad_s,a_n_cos,b_n_sin,amplitud_Cn,fase_rad,energia_pct\n';
    res.harmonics.forEach(h => {
      csv += [
        h.n,
        h.used ? 'SI' : 'NO',
        h.fn.toFixed(6),
        h.wn.toFixed(6),
        h.an.toFixed(6),
        h.bn.toFixed(6),
        h.Cn.toFixed(6),
        h.phin.toFixed(6),
        h.energyPct.toFixed(4)
      ].join(',') + '\n';
    });

    csv += '\n# TABLA 2: DATOS TEMPORALES PROCESADOS (TIEMPO, ACELERACION, VELOCIDAD, POSICION)\n';
    csv += 'tiempo_s,aceleracion_a,velocidad_v,posicion_calculada_x\n';
    for (let i = 0; i < state.t.length; i++) {
      csv += [
        state.t[i].toFixed(4),
        state.accel[i].toFixed(5),
        state.vel[i].toFixed(5),
        state.x[i].toFixed(6)
      ].join(',') + '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analisis_fourier_posicion_${state.fileName.replace(/\.[^.]+$/, '')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

initEvents();
