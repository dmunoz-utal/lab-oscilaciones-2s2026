/**
 * Laboratorio de Oscilaciones & Serie de Fourier (Arduino)
 * Procesamiento de archivos .txt, detección de frecuencia de mayor amplitud
 * y ajuste óptimo de Serie de Fourier.
 */

const state = {
  rawT: [],
  rawX: [],
  t: [],        // Tiempo procesado en segundos
  x: [],        // Posición procesada
  fileName: '',
  mode: 'auto', // 'auto' | 'manual'
  r2Target: 0.99,
  manualCount: 5,
  consecutiveN: false,
  f0Mode: 'fundamental', // 'fundamental' | 'window'
  timeUnit: 'auto',
  detrend: false,
  showAllHarmonics: false,
  analysis: null
};

// Elementos del DOM
const els = {
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  fileNameDisplay: document.getElementById('fileNameDisplay'),
  timeUnitSelect: document.getElementById('timeUnitSelect'),
  detrendCheck: document.getElementById('detrendCheck'),
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
  statPoints: document.getElementById('statPoints'),
  statFs: document.getElementById('statFs'),
  statA0: document.getElementById('statA0'),
  statR2: document.getElementById('statR2'),
  statRMSE: document.getElementById('statRMSE'),
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
   1. LECTURA Y PARSEO DEL ARCHIVO .TXT DE ARDUINO
   ========================================================================== */

function parseArduinoTxt(text) {
  const lines = text.split(/\r?\n/);
  const rawT = [];
  const rawX = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // Si el archivo usa coma decimal (ej. "0,020; 1,45"), normalizar si hay ';' o tab
    let normalized = line;
    if (line.includes(';') || (line.includes('\t') && line.includes(','))) {
      normalized = line.replace(/,/g, '.');
    }

    // Separar por coma, punto y coma, tabulación o espacios múltiples
    const parts = normalized.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length >= 2) {
      const tVal = parseFloat(parts[0]);
      const xVal = parseFloat(parts[1]);
      if (Number.isFinite(tVal) && Number.isFinite(xVal)) {
        rawT.push(tVal);
        rawX.push(xVal);
      }
    }
  }

  return { rawT, rawX };
}

function preprocessData() {
  if (state.rawT.length < 4) return false;

  // Ordenar por tiempo ascendente por si el puerto serial desordenó alguna línea
  const pairs = state.rawT.map((t, idx) => ({ t, x: state.rawX[idx] }))
                          .sort((a, b) => a.t - b.t);

  // Detectar unidad de tiempo
  let scale = 1.0;
  const totalSpanRaw = pairs[pairs.length - 1].t - pairs[0].t;
  const avgDtRaw = totalSpanRaw / (pairs.length - 1);

  if (state.timeUnit === 'ms') {
    scale = 1e-3;
  } else if (state.timeUnit === 'us') {
    scale = 1e-6;
  } else if (state.timeUnit === 'auto') {
    // Si el paso promedio entre muestras de Arduino es > 1.5 (ej. millis() da 5, 10, 20 ms)
    if (avgDtRaw > 1.5 && totalSpanRaw > 100) {
      scale = 1e-3;
    }
  }

  const t0 = pairs[0].t * scale;
  state.t = pairs.map(p => p.t * scale - t0); // Iniciar desde t = 0 s para estabilidad numérica

  const meanX = pairs.reduce((acc, p) => acc + p.x, 0) / pairs.length;
  if (state.detrend) {
    state.x = pairs.map(p => p.x - meanX);
  } else {
    state.x = pairs.map(p => p.x);
  }

  return true;
}

/* ==========================================================================
   2. ANÁLISIS ESPECTRAL Y SERIE DE FOURIER
   ========================================================================== */

/**
 * Encuentra la frecuencia de mayor amplitud con alta precisión usando un barrido
 * fino tipo Lomb-Scargle / proyección armónica continua sobre la señal.
 */
function findDominantFrequency(t, xCentered, dt, TWindow) {
  const N = t.length;
  const fMin = 1 / TWindow;
  const fNyquist = 0.5 / dt;
  const maxSearchFreq = Math.min(fNyquist * 0.95, 250 * fMin);

  // Barrido con sobremuestreo 4x en frecuencia para localizar el pico exacto
  const numSteps = Math.min(2500, Math.max(400, N * 2));
  let bestFreq = fMin;
  let maxPower = -1;

  for (let i = 1; i <= numSteps; i++) {
    const f = fMin * 0.5 + (i / numSteps) * (maxSearchFreq - fMin * 0.5);
    const w = 2 * Math.PI * f;
    let sumCos = 0;
    let sumSin = 0;
    for (let k = 0; k < N; k++) {
      const wt = w * t[k];
      sumCos += xCentered[k] * Math.cos(wt);
      sumSin += xCentered[k] * Math.sin(wt);
    }
    const power = sumCos * sumCos + sumSin * sumSin;
    if (power > maxPower) {
      maxPower = power;
      bestFreq = f;
    }
  }

  // Refinamiento local dorado/parabólico alrededor de bestFreq
  const df = (maxSearchFreq - fMin * 0.5) / numSteps;
  let fLow = Math.max(fMin * 0.2, bestFreq - df);
  let fHigh = Math.min(fNyquist, bestFreq + df);

  for (let iter = 0; iter < 25; iter++) {
    const f1 = fLow + (fHigh - fLow) / 3;
    const f2 = fHigh - (fHigh - fLow) / 3;
    const p1 = evalHarmonicPower(t, xCentered, f1);
    const p2 = evalHarmonicPower(t, xCentered, f2);
    if (p1 < p2) {
      fLow = f1;
    } else {
      fHigh = f2;
    }
  }

  return 0.5 * (fLow + fHigh);
}

function evalHarmonicPower(t, xCentered, f) {
  const w = 2 * Math.PI * f;
  let c = 0, s = 0;
  for (let k = 0; k < t.length; k++) {
    const wt = w * t[k];
    c += xCentered[k] * Math.cos(wt);
    s += xCentered[k] * Math.sin(wt);
  }
  return c * c + s * s;
}

/**
 * Calcula los coeficientes de Fourier (a_0, a_n, b_n) y reconstruye la curva.
 */
function computeFourierAnalysis() {
  const t = state.t;
  const x = state.x;
  const M = t.length;
  if (M < 4) return;

  const TWindow = t[M - 1] - t[0];
  const dt = TWindow / (M - 1);
  const fs = 1 / dt;

  // Valor medio (DC): a0/2
  const meanX = x.reduce((s, v) => s + v, 0) / M;
  const a0 = 2 * meanX;
  const xCentered = x.map(v => v - meanX);
  const totalSS = xCentered.reduce((s, v) => s + v * v, 0) || 1e-12;

  // Frecuencia de mayor amplitud global (resonancia experimental)
  const fPeakContinuous = findDominantFrequency(t, xCentered, dt, TWindow);

  // Definir frecuencia base f0 de la Serie de Fourier
  let f0;
  let maxN;
  if (state.f0Mode === 'fundamental') {
    // La serie usa como frecuencia fundamental la frecuencia de oscilación principal
    f0 = fPeakContinuous;
    maxN = Math.min(40, Math.floor((0.48 * fs) / f0));
  } else {
    // Serie de Fourier clásica en el intervalo [0, TWindow]
    f0 = 1 / TWindow;
    maxN = Math.min(80, Math.floor(M / 2) - 1);
  }
  maxN = Math.max(1, maxN);

  const w0 = 2 * Math.PI * f0;

  // Calcular coeficientes a_n y b_n mediante proyección ortogonal / integración trapezoidal
  const harmonics = [];
  let sumEnergyAll = 0;

  for (let n = 1; n <= maxN; n++) {
    const fn = n * f0;
    const wn = n * w0;
    let sumCos = 0;
    let sumSin = 0;

    for (let k = 0; k < M; k++) {
      const angle = wn * t[k];
      sumCos += xCentered[k] * Math.cos(angle);
      sumSin += xCentered[k] * Math.sin(angle);
    }

    const an = (2 / M) * sumCos;
    const bn = (2 / M) * sumSin;
    const Cn = Math.hypot(an, bn);
    // Forma x_n(t) = a_n cos(n w0 t) + b_n sin(n w0 t) = C_n cos(n w0 t - phi_n)
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

  // Normalizar porcentaje de energía por armónico
  const denomEnergy = Math.max(totalSS / M, sumEnergyAll, 1e-12);
  harmonics.forEach(h => {
    h.energyPct = Math.min(100, (h.energy / denomEnergy) * 100);
  });

  // Ordenar por amplitud C_n descendente para encontrar el dominante y los más significativos
  const sortedByAmp = [...harmonics].sort((a, b) => b.Cn - a.Cn);
  const dominantHarmonic = sortedByAmp[0];

  // Actualizar límite del slider manual según maxN
  els.maxHarmonicsSlider.max = maxN;
  if (state.manualCount > maxN) {
    state.manualCount = maxN;
    els.maxHarmonicsSlider.value = maxN;
    els.maxHarmonicsValue.textContent = maxN;
  }

  // Selección de los armónicos "n" utilizados en el ajuste
  const selectedNSet = new Set();

  if (state.mode === 'auto') {
    // Selección automática de los armónicos más significativos hasta alcanzar el umbral R²
    // o hasta que un armónico aporte menos del 0.15% de la energía total
    let cumulativeR2 = 0;
    for (let i = 0; i < sortedByAmp.length; i++) {
      const h = sortedByAmp[i];
      const contribution = h.energy / (totalSS / M);
      if (selectedNSet.size === 0 || (cumulativeR2 < state.r2Target && contribution >= 0.0015)) {
        selectedNSet.add(h.n);
        cumulativeR2 += contribution;
      }
      if (selectedNSet.size >= 15 || cumulativeR2 >= state.r2Target) break;
    }
  } else {
    // Selección manual controlada por el usuario
    const K = Math.min(state.manualCount, maxN);
    if (state.consecutiveN) {
      for (let n = 1; n <= K; n++) selectedNSet.add(n);
    } else {
      for (let i = 0; i < K; i++) selectedNSet.add(sortedByAmp[i].n);
    }
  }

  // Ajustar finamente los coeficientes de los armónicos seleccionados por Mínimos Cuadrados
  // (corrige cualquier pérdida por ventana no entera cuando f0 = f_dominante)
  const selectedList = harmonics
    .filter(h => selectedNSet.has(h.n))
    .sort((a, b) => a.n - b.n);

  refineCoefficientsLeastSquares(t, xCentered, selectedList);

  harmonics.forEach(h => {
    h.used = selectedNSet.has(h.n);
  });

  // Recalcular el dominante después del refinamiento
  const finalSorted = [...harmonics].sort((a, b) => b.Cn - a.Cn);
  const bestHarmonic = finalSorted[0];

  // Evaluar la serie en los puntos experimentales para calcular R² y RMSE
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
  const rmse = Math.sqrt(ssRes / M);

  // Generar malla densa suave para graficar la curva continua de la Serie de Fourier encima
  const denseCount = Math.min(1800, Math.max(500, M * 3));
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
    rmse,
    harmonics,
    selectedList,
    bestHarmonic,
    tDense,
    xFitDense
  };

  renderUI();
}

/**
 * Refina los coeficientes (a_n, b_n) mediante resolución directa de ecuaciones normales
 * sobre los armónicos seleccionados para obtener el mejor ajuste exacto en mínimos cuadrados.
 */
function refineCoefficientsLeastSquares(t, xCentered, selectedList) {
  const K = selectedList.length;
  if (K === 0) return;
  const M = t.length;
  const dim = 2 * K;

  // Matriz normal A (dim x dim) y vector b (dim)
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

  // Simetrizar y regularización ligera de Tikhonov
  for (let r = 0; r < dim; r++) {
    A[r][r] += 1e-9;
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
    selectedList[i].energy = 0.5 * (an * an + bn * bn);
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
   3. RENDERIZADO DE GRÁFICAS, COEFICIENTES Y MÉTRICAS
   ========================================================================== */

function formatNum(val, decimals = 4) {
  if (!Number.isFinite(val)) return '—';
  if (Math.abs(val) < 1e-4 && Math.abs(val) > 0) return val.toExponential(2);
  return val.toFixed(decimals);
}

function renderUI() {
  const res = state.analysis;
  if (!res) return;

  // 1. Métricas de la Frecuencia para la Mayor Amplitud (Resonancia Experimental)
  const dom = res.bestHarmonic;
  els.domFreqHz.textContent = formatNum(dom.fn, 4);
  els.domFreqRad.textContent = formatNum(dom.wn, 4);
  els.domAmpVal.textContent = `${formatNum(dom.Cn, 4)} u`;
  els.domPeriodVal.textContent = `${formatNum(1 / dom.fn, 4)} s`;
  els.domHarmonicN.textContent = `n = ${dom.n} (f₀ = ${formatNum(res.f0, 3)} Hz)`;

  // 2. Barra de Estadísticas Superiores
  els.statPoints.textContent = res.M.toLocaleString();
  els.statFs.textContent = `${formatNum(res.fs, 1)} Hz`;
  els.statA0.textContent = formatNum(res.meanX, 4);
  els.statR2.textContent = `${(res.r2 * 100).toFixed(2)}%`;
  els.statRMSE.textContent = formatNum(res.rmse, 4);

  // 3. Badges de los "n" utilizados en el ajuste
  els.usedNBages.innerHTML = '';
  res.selectedList.forEach(h => {
    const span = document.createElement('span');
    const isDom = h.n === dom.n;
    span.className = `n-badge ${isDom ? 'dominant' : ''}`;
    span.textContent = isDom
      ? `n = ${h.n} (Máx Amp: ${formatNum(h.fn, 2)} Hz)`
      : `n = ${h.n} (${formatNum(h.fn, 2)} Hz)`;
    els.usedNBages.appendChild(span);
  });

  // 4. Ecuación explícita reconstruida
  const terms = [];
  if (Math.abs(res.meanX) > 1e-5) {
    terms.push(formatNum(res.meanX, 4));
  }
  res.selectedList.forEach(h => {
    const wStr = formatNum(h.wn, 3);
    const aStr = `${h.an >= 0 ? '+ ' : '- '}${formatNum(Math.abs(h.an), 4)}·cos(${wStr}·t)`;
    const bStr = `${h.bn >= 0 ? '+ ' : '- '}${formatNum(Math.abs(h.bn), 4)}·sin(${wStr}·t)`;
    terms.push(`${aStr} ${bStr}   [n=${h.n}]`);
  });
  els.explicitEquation.textContent = `x(t) ≈ ${terms.join('\n       ')}`;

  // 5. Tabla de Coeficientes de Fourier
  const rowsToShow = state.showAllHarmonics
    ? res.harmonics
    : res.harmonics.filter(h => h.used || h.n <= 8);

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
      statusHtml = `<span class="status-pill status-ignored">Descartado</span>`;
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

  // 6. Graficar x(t) y Serie de Fourier + Espectro
  renderPlots(res);
}

function renderPlots(res) {
  const dom = res.bestHarmonic;

  // Traza 1: Datos experimentales x(t) del Arduino
  const traceData = {
    x: state.t,
    y: state.x,
    mode: state.t.length > 350 ? 'lines' : 'lines+markers',
    name: 'Datos Arduino x(t)',
    line: { color: '#38bdf8', width: 1.6 },
    marker: { color: '#38bdf8', size: 4.5, opacity: 0.75 }
  };

  // Traza 2: Serie de Fourier ajustada encima en otro color (Naranja vibrante)
  const nListStr = res.selectedList.map(h => h.n).join(', ');
  const traceFourier = {
    x: res.tDense,
    y: res.xFitDense,
    mode: 'lines',
    name: `Serie de Fourier (n = ${nListStr})`,
    line: { color: '#f97316', width: 3 }
  };

  const layoutTime = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(11,15,25,0.65)',
    margin: { t: 20, r: 25, b: 48, l: 58 },
    font: { family: 'Inter, sans-serif', color: '#cbd5e1' },
    xaxis: {
      title: 'Tiempo t (s)',
      gridcolor: '#1e293b',
      zerolinecolor: '#334155'
    },
    yaxis: {
      title: 'Posición / Oscilación x(t)',
      gridcolor: '#1e293b',
      zerolinecolor: '#334155'
    },
    legend: {
      orientation: 'h',
      y: 1.12,
      x: 0
    },
    hovermode: 'x unified'
  };

  Plotly.react('timePlot', [traceData, traceFourier], layoutTime, {
    responsive: true,
    displaylogo: false
  });

  // Gráfica de Espectro de Amplitudes C_n vs Frecuencia f_n
  const colors = res.harmonics.map(h => {
    if (h.n === dom.n) return '#f97316'; // Pico de mayor amplitud
    if (h.used) return '#38bdf8';        // Armónicos incluidos en el ajuste
    return '#475569';                    // Armónicos menores no usados
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
      'a_n = %{customdata[1]:.4f}, b_n = %{customdata[2]:.4f}<br>' +
      'Energía = %{customdata[3]:.2f}%<extra></extra>'
  };

  const layoutSpectrum = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(11,15,25,0.65)',
    margin: { t: 28, r: 25, b: 48, l: 58 },
    font: { family: 'Inter, sans-serif', color: '#cbd5e1' },
    xaxis: {
      title: 'Frecuencia f_n (Hz)',
      gridcolor: '#1e293b'
    },
    yaxis: {
      title: 'Amplitud C_n = √(a_n² + b_n²)',
      gridcolor: '#1e293b'
    },
    annotations: [
      {
        x: dom.fn,
        y: dom.Cn,
        xref: 'x',
        yref: 'y',
        text: `★ Máx Amplitud: f = ${dom.fn.toFixed(3)} Hz (n=${dom.n})`,
        showarrow: true,
        arrowhead: 2,
        ax: 0,
        ay: -28,
        bgcolor: 'rgba(249, 115, 22, 0.9)',
        font: { color: '#0b0f19', size: 11, family: 'JetBrains Mono, monospace' },
        borderpad: 4
      }
    ]
  };

  Plotly.react('spectrumPlot', [traceSpectrum], layoutSpectrum, {
    responsive: true,
    displaylogo: false
  });
}

/* ==========================================================================
   4. GENERADOR DE DATOS DE PRUEBA (FORMATO ARDUINO .TXT)
   ========================================================================== */

function generateSampleArduinoTxt() {
  // Simulación realista de una oscilación medida con Arduino (f_resonancia ≈ 2.40 Hz)
  // con presencia de 2º y 3er armónico no lineal + ruido ligero de sensor ultrasónico/acelerómetro
  const f1 = 2.40; // Hz (Frecuencia dominante / resonancia)
  const w1 = 2 * Math.PI * f1;
  const fs = 100;  // 100 muestras/s (cada 10 ms en Arduino)
  const duration = 4.0; // 4 segundos
  const lines = [
    '# Datos de oscilacion Arduino - Tiempo(s)\tPosicion_x(cm)',
    '# Frecuencia principal experimental ~ 2.40 Hz'
  ];

  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return (seed / 4294967296) - 0.5;
  };

  const totalSamples = Math.floor(duration * fs);
  for (let i = 0; i <= totalSamples; i++) {
    const t = i / fs;
    const x =
      1.25 +                                          // Offset DC (a0/2)
      4.80 * Math.cos(w1 * t) +                       // Armónico fundamental n=1 (mayor amplitud)
      1.60 * Math.sin(w1 * t) +
      0.95 * Math.cos(2 * w1 * t) -                   // Segundo armónico n=2
      0.45 * Math.sin(3 * w1 * t) +                   // Tercer armónico n=3
      0.18 * rand();                                  // Ruido experimental del sensor
    lines.push(`${t.toFixed(4)}\t${x.toFixed(4)}`);
  }

  return lines.join('\n');
}

function loadTextData(content, fileName) {
  const { rawT, rawX } = parseArduinoTxt(content);
  if (rawT.length < 6) {
    alert('No se pudieron detectar suficientes datos numéricos de dos columnas (Tiempo, Posición) en el archivo.');
    return;
  }
  state.rawT = rawT;
  state.rawX = rawX;
  state.fileName = fileName;
  els.fileNameDisplay.textContent = `${fileName} (${rawT.length} muestras)`;

  if (preprocessData()) {
    computeFourierAnalysis();
  }
}

/* ==========================================================================
   5. EVENTOS E INTERACCIÓN DEL USUARIO
   ========================================================================== */

function initEvents() {
  // Renderizar fórmula KaTeX si está disponible
  window.addEventListener('load', () => {
    if (window.katex) {
      window.katex.render(
        String.raw`x_{\text{Fourier}}(t) = \frac{a_0}{2} + \sum_{n \in \mathcal{N}} \left[ a_n \cos(n\omega_0 t) + b_n \sin(n\omega_0 t) \right]`,
        els.fourierFormulaBox,
        { displayMode: true, throwOnError: false }
      );
    }
    // Cargar ejemplo por defecto al iniciar para que la interfaz sea inmediatamente explorable
    const sampleTxt = generateSampleArduinoTxt();
    loadTextData(sampleTxt, 'oscilacion_arduino_ejemplo.txt');
  });

  // Subida por clic o Drag & Drop
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

  // Opciones de preprocesamiento
  els.timeUnitSelect.addEventListener('change', e => {
    state.timeUnit = e.target.value;
    if (preprocessData()) computeFourierAnalysis();
  });

  els.detrendCheck.addEventListener('change', e => {
    state.detrend = e.target.checked;
    if (preprocessData()) computeFourierAnalysis();
  });

  // Cambio entre modo Automático y Manual
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
      state.f0Mode === 'fundamental'
        ? 'Con f₀ = f_dom, n=1 corresponde a la frecuencia principal de oscilación y n=2,3,... a sus sobretonos/armónicos físicos.'
        : 'Con T = ventana completa, f₀ = 1/T y el pico de resonancia aparecerá en el armónico n ≈ f_dom · T.';
    computeFourierAnalysis();
  });

  els.showAllHarmonicsCheck.addEventListener('change', e => {
    state.showAllHarmonics = e.target.checked;
    renderUI();
  });

  // Botones de ejemplo
  els.btnSampleResonance.addEventListener('click', () => {
    const sampleTxt = generateSampleArduinoTxt();
    loadTextData(sampleTxt, 'oscilacion_arduino_ejemplo.txt');
  });

  els.btnDownloadSample.addEventListener('click', () => {
    const sampleTxt = generateSampleArduinoTxt();
    const blob = new Blob([sampleTxt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'datos_oscilacion_arduino.txt';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Copiar ecuación LaTeX
  els.btnCopyEquation.addEventListener('click', () => {
    if (!state.analysis) return;
    const res = state.analysis;
    const latexTerms = [`${res.meanX.toFixed(4)}`];
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

  // Exportar CSV de coeficientes
  els.btnExportCSV.addEventListener('click', () => {
    if (!state.analysis) return;
    const res = state.analysis;
    const header = 'n,usado_en_ajuste,frecuencia_Hz,omega_rad_s,a_n_cos,b_n_sin,amplitud_Cn,fase_rad,energia_pct\n';
    const rows = res.harmonics.map(h =>
      [
        h.n,
        h.used ? 'SI' : 'NO',
        h.fn.toFixed(6),
        h.wn.toFixed(6),
        h.an.toFixed(6),
        h.bn.toFixed(6),
        h.Cn.toFixed(6),
        h.phin.toFixed(6),
        h.energyPct.toFixed(4)
      ].join(',')
    );
    const csvContent = header + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coeficientes_fourier_${state.fileName.replace(/\.[^.]+$/, '')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

initEvents();
