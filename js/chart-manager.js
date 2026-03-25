export function createSignalChart(canvasEl, getRows, getSwallowEvents) {
  const swallowShadesPlugin = {
    id: 'swallowShadesPlugin',
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const rows = getRows();
      const swallowEvents = getSwallowEvents();

      if (!chartArea || !scales.x || !rows.length || !swallowEvents.length) return;

      const xScale = scales.x;
      const labels = chart.data.labels;
      if (!labels.length) return;

      const visibleT = labels.map(v => parseFloat(v));
      const minT = visibleT[0];
      const maxT = visibleT[visibleT.length - 1];

      ctx.save();

      swallowEvents.forEach(ev => {
        const t0 = (ev.onsetMs - rows[0].ms) / 1000;
        const t1 = (ev.endMs - rows[0].ms) / 1000;

        if (t1 < minT || t0 > maxT) return;

        const x0 = xScale.getPixelForValue(t0.toFixed(2));
        const x1 = xScale.getPixelForValue(t1.toFixed(2));

        ctx.fillStyle = 'rgba(120,120,120,0.12)';
        ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
      });

      ctx.restore();
    }
  };

  const ctx = canvasEl.getContext('2d');

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'DP_Pa',
          data: [],
          borderColor: '#1f77b4',
          tension: 0.25,
          pointRadius: 0,
          yAxisID: 'y'
        },
        {
          label: 'FSR_raw',
          data: [],
          borderColor: '#ff7f0e',
          tension: 0.25,
          pointRadius: 0,
          yAxisID: 'y2'
        }
      ]
    },
    options: {
      animation: false,
      responsive: true,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          title: { display: true, text: 'Time (s)' }
        },
        y: {
          title: { display: true, text: 'DP (Pa)' }
        },
        y2: {
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'FSR' }
        }
      },
      plugins: {
        legend: { display: true },
        zoom: {
          pan: {
            enabled: true,
            mode: 'x'
          },
          zoom: {
            wheel: {
              enabled: true
            },
            pinch: {
              enabled: true
            },
            mode: 'x'
          }
        }
      }
    },
    plugins: [swallowShadesPlugin]
  });
}

export function addPointToChart(chart, rows, ms, dp, fsr) {
  const t0 = rows[0].ms;
  const t = (ms - t0) / 1000.0;

  chart.data.labels.push(t.toFixed(2));
  chart.data.datasets[0].data.push(dp);
  chart.data.datasets[1].data.push(fsr);

  const MAX = 2000;
  if (chart.data.labels.length > MAX) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
    chart.data.datasets[1].data.shift();
  }

  chart.update('none');
}

export function resetChart(chart) {
  chart.data.labels = [];
  chart.data.datasets[0].data = [];
  chart.data.datasets[1].data = [];
  chart.update();
}

export function resetZoom(chart) {
  if (chart?.resetZoom) chart.resetZoom();
}
