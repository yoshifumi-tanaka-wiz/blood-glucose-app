(function () {
  'use strict';

  let chart = null;
  const DAY = 86400000;

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

  /**
   * @param canvas  描画先
   * @param glucose 記録配列
   * @param days    表示日数
   * @param visible {morning:true,...}
   * @param today   記録日ベースの今日 'yyyy/MM/dd'
   */
  function render(canvas, glucose, days, visible, today) {
    const fromYmd = U.addDays(today, -(days - 1));
    const xMin = U.parseYmd(fromYmd).getTime();
    const xMax = U.parseYmd(U.addDays(today, 1)).getTime() + 5 * 3600000; // 翌日5:00まで（就寝前の深夜分）

    const inRange = glucose.filter(r => r.date >= fromYmd && r.date <= today);
    const shown = inRange.filter(r => visible[r.slot]);
    const range = yRange(shown.map(r => r.value));

    const datasets = U.SLOTS.map(slot => ({
      label: U.SLOT_LABEL[slot],
      slot: slot,
      hidden: !visible[slot],
      data: inRange.filter(r => r.slot === slot)
        .map(r => ({ x: U.actualDate(r.date, r.time).getTime(), y: r.value, rec: r }))
        .sort((a, b) => a.x - b.x),
      borderColor: U.SLOT_COLOR[slot],
      backgroundColor: U.SLOT_COLOR[slot],
      borderWidth: 2,
      pointRadius: days <= 14 ? 3.5 : 2.5,
      pointHoverRadius: 6,
      tension: 0,
      spanGaps: true,
    }));

    // 目盛り：1〜2週間は毎日、それ以上は7日ごと（今日から逆算して揃える）
    const step = days <= 14 ? 1 : 7;
    const ticks = [];
    for (let i = 0; i < days; i += step) ticks.push(U.parseYmd(U.addDays(today, -i)).getTime());
    ticks.sort((a, b) => a - b);

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      layout: { padding: { right: 6 } },
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
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: xMin,
          max: xMax,
          afterBuildTicks: axis => { axis.ticks = ticks.map(v => ({ value: v })); },
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
          ticks: { font: { size: 11 }, stepSize: (range.max - range.min) > 200 ? 50 : 20, includeBounds: false },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
      },
    };

    if (chart && chart.canvas === canvas) {
      chart.data.datasets = datasets;
      chart.options = options;
      chart.update();
    } else {
      if (chart) chart.destroy();
      chart = new Chart(canvas, { type: 'line', data: { datasets: datasets }, options: options });
    }
    return { count: shown.length, range: range };
  }

  window.BGChart = { render, yRange };
})();
