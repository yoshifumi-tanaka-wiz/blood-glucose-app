(function () {
  'use strict';

  let chart = null;
  let lastDays = null;
  const DAY = 86400000;
  const MIN_LABEL_PX = 36;              // 日付ラベル1つに必要な横幅（px）
  const Y_AXIS_W = 40;                  // 縦軸の幅（固定。スクロール時に左に固定表示する）
  const TAIL = 5 * 3600000;             // 右端は翌日5:00まで（就寝前の深夜分）
  const WINDOW_SPAN = 7 * DAY + TAIL;   // 1画面に表示する期間（1週間）
  const LINE_COLOR = '#A9AFB8';

  /** グラフの縦軸範囲：基本80〜160。最小値<90なら最小値-10、最大値>150なら最大値+10 */
  function yRange(values) {
    let min = 80, max = 160;
    if (values.length) {
      const lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
      if (lo < 90) min = lo - 10;
      if (hi > 150) max = hi + 10;
    }
    return { min: min, max: max };
  }

  /** スクロールしても縦軸が見えるよう、縦軸部分を左端の固定キャンバスにコピーする */
  const stickyAxisPlugin = {
    id: 'stickyAxis',
    afterRender(c) {
      const overlay = c.canvas.closest('.chart-wrap').querySelector('.chart-yaxis');
      if (!overlay || !c.width) return;
      const dpr = c.currentDevicePixelRatio || 1;
      const w = Math.ceil((Y_AXIS_W + 2) * dpr);
      // x軸ラベル部分より上だけを固定表示（x軸ラベルは一緒にスクロールさせる）
      const h = Math.floor(c.chartArea.bottom * dpr) + 1;
      if (overlay.width !== w || overlay.height !== h) {
        overlay.width = w;
        overlay.height = h;
        overlay.style.width = (w / dpr) + 'px';
        overlay.style.height = (h / dpr) + 'px';
      }
      const ctx = overlay.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(c.canvas, 0, 0, w, h, 0, 0, w, h);
    },
  };

  /**
   * @param canvas  描画先（.chart-wrap > .chart-scroll > .chart-inner > canvas）
   * @param glucose 記録配列
   * @param days    表示日数
   * @param visible {morning:true,...}
   * @param today   記録日ベースの今日 'yyyy/MM/dd'
   */
  let lastArgs = null;
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (lastArgs && chart) render.apply(null, lastArgs); }, 150);
  });

  function render(canvas, glucose, days, visible, today) {
    lastArgs = [canvas, glucose, days, visible, today];
    const fromYmd = U.addDays(today, -(days - 1));
    const xMin = U.parseYmd(fromYmd).getTime();
    const xMax = U.parseYmd(U.addDays(today, 1)).getTime() + TAIL;

    // 表示する時間帯の記録を、実際の測定日時の順に1本の線で結ぶ
    const shown = glucose
      .filter(r => r.date >= fromYmd && r.date <= today && visible[r.slot])
      .map(r => ({ x: U.actualDate(r.date, r.time).getTime(), y: r.value, rec: r }))
      .sort((a, b) => a.x - b.x);
    const colors = shown.map(p => U.SLOT_COLOR[p.rec.slot]);
    const range = yRange(shown.map(p => p.y));

    // 1週間分が1画面に収まる幅にし、それより長い期間は横スクロール
    const scroll = canvas.closest('.chart-scroll');
    const inner = canvas.parentNode;
    const viewW = scroll.clientWidth;
    if (viewW > 0) {
      const ratio = (xMax - xMin) / WINDOW_SPAN;
      inner.style.width = ratio <= 1 ? '100%' : Math.round(Y_AXIS_W + (viewW - Y_AXIS_W) * ratio) + 'px';
    }

    const datasets = [{
      label: '血糖値',
      data: shown,
      borderColor: LINE_COLOR,
      borderWidth: 1,
      pointBackgroundColor: colors,
      pointBorderColor: colors,
      pointRadius: 4,
      pointHoverRadius: 6,
      tension: 0,
    }];

    // 目盛り：日付ラベルが重ならない間隔（通常は毎日）。今日から逆算して並べる
    const buildTicks = axis => {
      const plotW = axis.chart.chartArea ? axis.chart.chartArea.width : axis.chart.width - Y_AXIS_W;
      const pxPerDay = plotW / ((xMax - xMin) / DAY);
      const step = [1, 2, 3, 7, 14, 28].find(s => s * pxPerDay >= MIN_LABEL_PX) || 28;
      const ticks = [];
      for (let i = 0; i < days; i += step) ticks.push({ value: U.parseYmd(U.addDays(today, -i)).getTime() });
      axis.ticks = ticks.reverse();
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      layout: { padding: { right: 10 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => {
              const r = items[0].raw.rec;
              const d = U.actualDate(r.date, r.time);
              return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + r.time;
            },
            label: item => ' ' + U.SLOT_LABEL[item.raw.rec.slot] + '  ' + item.raw.y + ' mg/dL',
            labelColor: item => {
              const c = U.SLOT_COLOR[item.raw.rec.slot];
              return { borderColor: c, backgroundColor: c };
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: xMin,
          max: xMax,
          afterBuildTicks: buildTicks,
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            font: { size: 11 },
            callback: v => { const d = new Date(v); return (d.getMonth() + 1) + '/' + d.getDate(); },
          },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
        y: {
          min: range.min,
          max: range.max,
          afterFit: axis => { axis.width = Y_AXIS_W; },
          ticks: { font: { size: 11 }, stepSize: (range.max - range.min) > 200 ? 50 : 20, includeBounds: false },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
      },
    };

    if (chart && chart.canvas === canvas) {
      chart.data.datasets = datasets;
      chart.options = options;
      chart.resize();
      chart.update();
    } else {
      if (chart) chart.destroy();
      chart = new Chart(canvas, { type: 'line', data: { datasets: datasets }, options: options, plugins: [stickyAxisPlugin] });
    }
    // 期間を切り替えた時・初回は、最新（右端）を表示
    if (lastDays !== days) {
      scroll.scrollLeft = scroll.scrollWidth;
      lastDays = days;
    }
    return { count: shown.length, range: range };
  }

  window.BGChart = { render, yRange };
})();
