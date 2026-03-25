import { analyzeAllData, buildSummaryText } from './analysis.js';
import { createSignalChart, addPointToChart, resetChart, resetZoom } from './chart-manager.js';
import { SerialManager } from './serial-manager.js';

// ===== DOM =====
const statusEl = document.getElementById('status');
const btnConnect = document.getElementById('connect');
const btnStart = document.getElementById('start');
const btnStop = document.getElementById('stop');
const btnSave = document.getElementById('save');
const btnSaveEvents = document.getElementById('saveEvents');
const btnClear = document.getElementById('clear');
const btnResetZoom = document.getElementById('resetZoom');

const mSwallowCount = document.getElementById('mSwallowCount');
const mCurrentPhase = document.getElementById('mCurrentPhase');
const mFsrThreshold = document.getElementById('mFsrThreshold');
const mCycleMean = document.getElementById('mCycleMean');
const liveExplain = document.getElementById('liveExplain');
const eventTableBody = document.getElementById('eventTableBody');
const summaryText = document.getElementById('summaryText');
const chartCanvas = document.getElementById('chart');

// ===== State =====
let rows = [];
let swallowEvents = [];
let phaseTimeline = [];
let stableSegments = [];
let lastAnalysisStats = {
  baseMean: null,
  baseSd: null,
  threshold: null
};
let lastMeanCycle = null;

// ===== Params =====
function getParams() {
  return {
    fsrBaseWindow: parseInt(document.getElementById('fsrBaseWindow').value, 10),
    fsrSustain: parseInt(document.getElementById('fsrSustain').value, 10),
    fsrMinSwallowMs: parseInt(document.getElementById('fsrMinSwallowMs').value, 10),
    fsrMaxSwallowMs: parseInt(document.getElementById('fsrMaxSwallowMs').value, 10),
    fsrOnK: parseFloat(document.getElementById('fsrOnK').value),
    fsrOffK: parseFloat(document.getElementById('fsrOffK').value),
    fsrRefractoryMs: parseInt(document.getElementById('fsrRefractoryMs').value, 10),

    dpSmoothWindow: parseInt(document.getElementById('dpSmoothWindow').value, 10),
    dpBaseWindow: parseInt(document.getElementById('dpBaseWindow').value, 10),
    dpEnterTh: parseFloat(document.getElementById('dpEnterTh').value),
    dpExitTh: parseFloat(document.getElementById('dpExitTh').value),
    dpMinPhaseMs: parseInt(document.getElementById('dpMinPhaseMs').value, 10),

    stablePhaseMs: parseInt(document.getElementById('stablePhaseMs').value, 10),
    swallowPadBeforeMs: parseInt(document.getElementById('swallowPadBeforeMs').value, 10),
    swallowPadAfterMs: parseInt(document.getElementById('swallowPadAfterMs').value, 10)
  };
}

// ===== Chart =====
const chart = createSignalChart(
  chartCanvas,
  () => rows,
  () => swallowEvents
);

// ===== UI =====
function setUI(connected) {
  btnStart.disabled = !connected;
  btnStop.disabled = !connected;
  btnSave.disabled = !connected;
  btnSaveEvents.disabled = !connected;
  btnClear.disabled = !connected;
  btnResetZoom.disabled = !connected;
}

function renderEvents() {
  eventTableBody.innerHTML = swallowEvents.map(ev => `
    <tr>
      <td>${ev.index}</td>
      <td>${ev.onsetMs}</td>
      <td>${ev.endMs}</td>
      <td>${ev.durationMs}</td>
      <td>${ev.prePhase}</td>
      <td>${ev.postPhase}</td>
      <td>${ev.pattern}</td>
      <td>${ev.onsetRespPhase}</td>
      <td>${ev.expStartToOnsetMs ?? '-'}</td>
      <td>${ev.expStage}</td>
    </tr>
  `).join('');
}

function updateSummaryCards() {
  mSwallowCount.textContent = String(swallowEvents.length);
  mCycleMean.textContent = lastMeanCycle ? `${lastMeanCycle.toFixed(0)} ms` : '-';
  mFsrThreshold.textContent = Number.isFinite(lastAnalysisStats.threshold)
    ? lastAnalysisStats.threshold.toFixed(1)
    : '-';

  const lastPhase = phaseTimeline.length ? phaseTimeline[phaseTimeline.length - 1].phase : 'A';
  mCurrentPhase.textContent =
    lastPhase === 'I' ? 'Inspiration'
    : lastPhase === 'E' ? 'Expiration'
    : 'Apnea';
}

function resetAll() {
  rows = [];
  swallowEvents = [];
  phaseTimeline = [];
  stableSegments = [];
  lastAnalysisStats = { baseMean: null, baseSd: null, threshold: null };
  lastMeanCycle = null;

  resetChart(chart);
  renderEvents();

  mSwallowCount.textContent = '0';
  mCurrentPhase.textContent = '-';
  mFsrThreshold.textContent = '-';
  mCycleMean.textContent = '-';
  liveExplain.textContent = '버퍼를 초기화했습니다.';
  summaryText.textContent = 'Stop을 누르면 요약 결과가 여기에 표시됩니다.';
}

function analyzeAndRender() {
  const result = analyzeAllData(rows, getParams());

  swallowEvents = result.swallowEvents;
  phaseTimeline = result.phaseTimeline;
  stableSegments = result.stableSegments;
  lastAnalysisStats = result.stats;
  lastMeanCycle = result.meanCycle;

  renderEvents();
  updateSummaryCards();

  summaryText.textContent = buildSummaryText(
    rows,
    swallowEvents,
    lastAnalysisStats,
    lastMeanCycle
  );

  liveExplain.textContent = swallowEvents.length
    ? `Stop 후 일괄 분석 완료: swallow ${swallowEvents.length}개 검출, baseline=${(lastAnalysisStats.baseMean ?? 0).toFixed(1)}, deviation SD=${(lastAnalysisStats.baseSd ?? 0).toFixed(1)}`
    : 'Stop 후 전체 분석 완료: swallow event를 찾지 못했습니다.';

  chart.update();
}

// ===== Serial =====
const serial = new SerialManager({
  onData: ({ ms, dp, fsr }) => {
    rows.push({ ms, dp, fsr });
    addPointToChart(chart, rows, ms, dp, fsr);
  },
  onStatus: (status) => {
    statusEl.textContent = `Status: ${status}`;
  }
});

// ===== Button Events =====
btnConnect.onclick = async () => {
  try {
    await serial.connect();
    setUI(true);
    liveExplain.textContent = '연결 완료. Start를 누르면 raw 데이터 수집을 시작합니다.';
  } catch (e) {
    console.error(e);
    alert(e.message || '연결 실패');
  }
};

btnStart.onclick = async () => {
  resetAll();
  await serial.start();
  liveExplain.textContent = 'raw 데이터 수집 중입니다. Stop을 누르면 전체 분석을 시작합니다.';
};

btnStop.onclick = async () => {
  await serial.stop();
  analyzeAndRender();
};

btnClear.onclick = () => {
  resetAll();
};

btnResetZoom.onclick = () => {
  resetZoom(chart);
};

btnSave.onclick = () => {
  if (!rows.length) return;

  let csv = 'ms,dp_pa,fsr_raw\n';
  csv += rows.map(r => `${r.ms},${r.dp},${r.fsr}`).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `breath_raw_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

btnSaveEvents.onclick = () => {
  if (!swallowEvents.length) return;

  let csv = 'index,onset_ms,end_ms,duration_ms,pre_phase,post_phase,pattern,onset_resp_phase,exp_start_to_onset_ms,exp_stage\n';
  csv += swallowEvents.map(ev => [
    ev.index,
    ev.onsetMs,
    ev.endMs,
    ev.durationMs,
    ev.prePhase,
    ev.postPhase,
    ev.pattern,
    ev.onsetRespPhase,
    ev.expStartToOnsetMs ?? '',
    ev.expStage
  ].join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `swallow_events_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
