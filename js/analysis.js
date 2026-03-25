import {
  mean,
  std,
  mad,
  movingAverage,
  rollingMedian,
  getMedianDtMs,
  classifyExpStage
} from './utils.js';

export function computeSmoothedFSR(rows) {
  const fsr = rows.map(r => r.fsr);
  return movingAverage(fsr, 3);
}

export function computeDetrendedDP(rows, params) {
  const dp = rows.map(r => r.dp);
  const smooth = movingAverage(dp, params.dpSmoothWindow);
  const base = rollingMedian(smooth, params.dpBaseWindow);
  return smooth.map((v, i) => v - base[i]);
}

export function detectSwallowEventsOffline(rows, smoothedFSR, params) {
  const {
    fsrBaseWindow,
    fsrSustain,
    fsrMinSwallowMs,
    fsrMaxSwallowMs,
    fsrOnK,
    fsrOffK,
    fsrRefractoryMs
  } = params;

  const events = [];
  if (rows.length < 10) {
    return {
      events,
      baseMean: 0,
      baseSd: 0,
      threshold: 0,
      deviation: [],
      localBase: []
    };
  }

  const localBase = rollingMedian(smoothedFSR, fsrBaseWindow);
  const deviation = smoothedFSR.map((v, i) => v - localBase[i]);

  let inSwallow = false;
  let aboveCount = 0;
  let belowCount = 0;
  let onsetIdx = null;
  let lastAcceptedEndMs = -Infinity;

  for (let i = 0; i < deviation.length; i++) {
    const s = Math.max(0, i - fsrBaseWindow + 1);
    const localDev = deviation.slice(s, i + 1);
    const localNoise = Math.max(mad(localDev), 1.0);

    const onTh = fsrOnK * localNoise;
    const offTh = fsrOffK * localNoise;

    if (!inSwallow) {
      if (rows[i].ms - lastAcceptedEndMs < fsrRefractoryMs) continue;

      if (deviation[i] > onTh) {
        aboveCount++;
        if (aboveCount >= fsrSustain) {
          onsetIdx = Math.max(0, i - fsrSustain + 1);
          inSwallow = true;
          belowCount = 0;
        }
      } else {
        aboveCount = 0;
      }
    } else {
      const durNow = rows[i].ms - rows[onsetIdx].ms;

      if (durNow > fsrMaxSwallowMs) {
        inSwallow = false;
        aboveCount = 0;
        belowCount = 0;
        onsetIdx = null;
        continue;
      }

      if (deviation[i] < offTh) {
        belowCount++;
        if (belowCount >= fsrSustain) {
          const endIdx = i;
          const durationMs = rows[endIdx].ms - rows[onsetIdx].ms;

          if (durationMs >= fsrMinSwallowMs && durationMs <= fsrMaxSwallowMs) {
            events.push({
              onsetIdx,
              endIdx,
              onsetMs: rows[onsetIdx].ms,
              endMs: rows[endIdx].ms,
              durationMs
            });
            lastAcceptedEndMs = rows[endIdx].ms;
          }

          inSwallow = false;
          aboveCount = 0;
          belowCount = 0;
          onsetIdx = null;
        }
      } else {
        belowCount = 0;
      }
    }
  }

  const baseMean = mean(localBase);
  const baseSd = std(deviation);
  const threshold = mean(deviation) + params.fsrOnK * mad(deviation);

  return { events, baseMean, baseSd, threshold, deviation, localBase };
}

function isInsideSwallowExpanded(ms, detectedEvents, params) {
  const startPad = params.swallowPadBeforeMs;
  const endPad = params.swallowPadAfterMs;

  return detectedEvents.some(ev => ms >= (ev.onsetMs - startPad) && ms <= (ev.endMs + endPad));
}

export function buildPhaseTimelineOffline(rows, detrendedDP, detectedEvents, params) {
  const timeline = [];
  const segments = [];

  const { dpEnterTh, dpExitTh, dpMinPhaseMs } = params;
  const dtMs = getMedianDtMs(rows);
  const holdPts = Math.max(1, Math.round(dpMinPhaseMs / dtMs));

  let state = 'A';
  let candidate = null;
  let candidateCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const ms = rows[i].ms;

    if (isInsideSwallowExpanded(ms, detectedEvents, params)) {
      state = 'A';
      candidate = null;
      candidateCount = 0;
      timeline.push({ ms, phase: 'A' });
      continue;
    }

    const x = detrendedDP[i];
    let desired = state;

    if (state === 'A') {
      if (x >= dpEnterTh) desired = 'I';
      else if (x <= -dpEnterTh) desired = 'E';
      else desired = 'A';
    } else if (state === 'I') {
      if (x < dpExitTh) desired = 'A';
      else desired = 'I';
    } else if (state === 'E') {
      if (x > -dpExitTh) desired = 'A';
      else desired = 'E';
    }

    if (desired !== state) {
      if (candidate === desired) {
        candidateCount++;
      } else {
        candidate = desired;
        candidateCount = 1;
      }

      if (candidateCount >= holdPts) {
        state = desired;
        candidate = null;
        candidateCount = 0;
      }
    } else {
      candidate = null;
      candidateCount = 0;
    }

    timeline.push({ ms, phase: state });

    if (state === 'A') continue;

    const lastSeg = segments[segments.length - 1];
    if (!lastSeg || lastSeg.phase !== state) {
      segments.push({ phase: state, startMs: ms, endMs: ms });
    } else {
      lastSeg.endMs = ms;
    }
  }

  return { timeline, segments };
}

function getStablePhaseAroundFromTimeline(timeline, centerMs, side, params) {
  const stablePhaseMs = params.stablePhaseMs;
  let start;
  let end;

  if (side === 'pre') {
    start = centerMs - stablePhaseMs;
    end = centerMs;
  } else {
    start = centerMs;
    end = centerMs + stablePhaseMs;
  }

  const win = timeline.filter(p => p.ms >= start && p.ms <= end && p.phase !== 'A');
  if (!win.length) return 'Unknown';

  let iCount = 0;
  let eCount = 0;

  for (const p of win) {
    if (p.phase === 'I') iCount++;
    if (p.phase === 'E') eCount++;
  }

  if (iCount === eCount) return win[win.length - 1]?.phase ?? 'Unknown';
  return iCount > eCount ? 'I' : 'E';
}

function getPhaseAtOnsetFromTimeline(timeline, onsetMs) {
  const pre = timeline.filter(p => p.ms <= onsetMs && p.phase !== 'A').slice(-5);
  if (!pre.length) return 'Unknown';
  return pre[pre.length - 1].phase;
}

function getLastExpirationSegmentBefore(segments, ms) {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.phase === 'E' && seg.startMs <= ms) return seg;
  }
  return null;
}

function getMeanCycleDuration(segments) {
  const inspirationStarts = segments
    .filter(s => s.phase === 'I')
    .map(s => s.startMs);

  if (inspirationStarts.length < 2) return null;

  const cycles = [];
  for (let i = 1; i < inspirationStarts.length; i++) {
    cycles.push(inspirationStarts[i] - inspirationStarts[i - 1]);
  }

  return mean(cycles);
}

export function analyzeAllData(rows, params) {
  if (!rows.length) {
    return {
      swallowEvents: [],
      phaseTimeline: [],
      stableSegments: [],
      stats: { baseMean: null, baseSd: null, threshold: null },
      meanCycle: null
    };
  }

  const smoothedFSR = computeSmoothedFSR(rows);
  const detrendedDP = computeDetrendedDP(rows, params);

  const detected = detectSwallowEventsOffline(rows, smoothedFSR, params);
  const detectedEvents = detected.events || [];

  const built = buildPhaseTimelineOffline(rows, detrendedDP, detectedEvents, params);
  const phaseTimeline = built.timeline;
  const stableSegments = built.segments;

  const swallowEvents = detectedEvents.map((ev, idx) => {
    const prePhase = getStablePhaseAroundFromTimeline(phaseTimeline, ev.onsetMs, 'pre', params);
    const postPhase = getStablePhaseAroundFromTimeline(phaseTimeline, ev.endMs, 'post', params);
    const onsetPhase = getPhaseAtOnsetFromTimeline(phaseTimeline, ev.onsetMs);
    const expSeg = getLastExpirationSegmentBefore(stableSegments, ev.onsetMs);

    let expDelta = null;
    let expStage = '-';

    if (prePhase === 'E' && expSeg) {
      expDelta = ev.onsetMs - expSeg.startMs;
      expStage = classifyExpStage(ev.onsetMs, expSeg);
    }

    return {
      index: idx + 1,
      onsetMs: ev.onsetMs,
      endMs: ev.endMs,
      durationMs: ev.durationMs,
      prePhase,
      postPhase,
      pattern: `${prePhase}-S-${postPhase}`,
      onsetRespPhase: onsetPhase,
      expStartToOnsetMs: expDelta,
      expStage
    };
  });

  const meanCycle = getMeanCycleDuration(stableSegments);

  return {
    swallowEvents,
    phaseTimeline,
    stableSegments,
    stats: {
      baseMean: detected.baseMean,
      baseSd: detected.baseSd,
      threshold: detected.threshold
    },
    meanCycle
  };
}

export function buildSummaryText(rows, swallowEvents, stats, meanCycle) {
  const durations = swallowEvents.map(ev => ev.durationMs);
  const meanDuration = durations.length ? mean(durations) : null;

  const patternCounts = {};
  swallowEvents.forEach(ev => {
    patternCounts[ev.pattern] = (patternCounts[ev.pattern] || 0) + 1;
  });

  const patternText = Object.keys(patternCounts).length
    ? Object.entries(patternCounts).map(([k, v]) => `${k}: ${v}`).join('\n')
    : '없음';

  const eventText = swallowEvents.length
    ? swallowEvents.map(ev => [
        `[Event ${ev.index}]`,
        `onset: ${ev.onsetMs} ms`,
        `end: ${ev.endMs} ms`,
        `duration: ${ev.durationMs} ms`,
        `pre-phase: ${ev.prePhase}`,
        `post-phase: ${ev.postPhase}`,
        `pattern: ${ev.pattern}`,
        `at onset: ${ev.onsetRespPhase}`,
        `exp start → onset: ${ev.expStartToOnsetMs ?? '-'} ms`,
        `exp phase stage: ${ev.expStage}`
      ].join('\n')).join('\n\n')
    : '검출된 swallow event 없음';

  return (
    `[요약]\n` +
    `총 데이터 포인트: ${rows.length}\n` +
    `FSR baseline mean: ${stats.baseMean != null ? stats.baseMean.toFixed(2) : '-'}\n` +
    `FSR deviation SD: ${stats.baseSd != null ? stats.baseSd.toFixed(2) : '-'}\n` +
    `FSR threshold(summary): ${Number.isFinite(stats.threshold) ? stats.threshold.toFixed(2) : '-'}\n` +
    `총 swallow 수: ${swallowEvents.length}\n` +
    `평균 swallow duration: ${meanDuration ? meanDuration.toFixed(1) + ' ms' : '-'}\n` +
    `평균 호흡 주기: ${meanCycle ? meanCycle.toFixed(1) + ' ms' : '-'}\n\n` +
    `[Pattern counts]\n${patternText}\n\n` +
    `[Event details]\n${eventText}`
  );
}
