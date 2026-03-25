export function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mad(arr) {
  if (!arr.length) return 0;
  const m = median(arr);
  const dev = arr.map(v => Math.abs(v - m));
  return median(dev) * 1.4826;
}

export function movingAverage(data, windowSize) {
  if (!data.length) return [];
  const out = new Array(data.length);
  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= windowSize) sum -= data[i - windowSize];
    out[i] = sum / Math.min(i + 1, windowSize);
  }

  return out;
}

export function rollingMedian(data, windowSize) {
  const out = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(0, i - windowSize + 1);
    out[i] = median(data.slice(s, i + 1));
  }
  return out;
}

export function getMedianDtMs(rows) {
  if (rows.length < 3) return 50;
  const dts = [];
  for (let i = 1; i < rows.length; i++) {
    dts.push(rows[i].ms - rows[i - 1].ms);
  }
  return median(dts);
}

export function classifyExpStage(onsetMs, expSeg) {
  if (!expSeg) return '-';
  const dur = expSeg.endMs - expSeg.startMs;
  if (dur <= 0) return '-';

  const dt = onsetMs - expSeg.startMs;
  const ratio = dt / dur;

  if (ratio < 0.33) return 'Early';
  if (ratio < 0.66) return 'Mid';
  return 'Late';
}
