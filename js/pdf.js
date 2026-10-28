(function () {
  'use strict';

  const ROWS_PER_PAGE = 18;
  const PAGE_W = 1123; // A4横 96dpi
  const PAGE_H = 794;

  function insulinText(ins) {
    const unit = v => (v === '' || v == null ? '-' : v);
    let s = 'インスリン変更：' + (ins.changed ? '有' : '無');
    const any = ['morning', 'noon', 'evening', 'night'].some(k => ins[k] !== '' && ins[k] != null);
    if (ins.changed || any) {
      s += '　朝：' + unit(ins.morning) + '　昼：' + unit(ins.noon) + '　夕：' + unit(ins.evening) + '　就寝前：' + unit(ins.night);
    }
    return s;
  }

  function bp(max, min) {
    if (max == null && min == null) return '';
    return (max == null ? '-' : max) + '/' + (min == null ? '-' : min);
  }

  /** 出力する行データを作る */
  function buildRows(data, from, to, includeEmpty) {
    const g = {}, d = {};
    data.glucose.forEach(r => { (g[r.date] = g[r.date] || {})[r.slot] = r.value; });
    data.daily.forEach(r => { d[r.date] = r; });
    const rows = [];
    for (let day = from; day <= to; day = U.addDays(day, 1)) {
      const gv = g[day] || {};
      const dv = d[day] || {};
      const row = {
        date: day,
        morning: gv.morning, noon: gv.noon, evening: gv.evening, night: gv.night,
        weight: dv.weight, walk: dv.walk,
        bpM: bp(dv.bp_max_morning, dv.bp_min_morning),
        bpE: bp(dv.bp_max_evening, dv.bp_min_evening),
        note: dv.note || '',
      };
      const hasAny = [row.morning, row.noon, row.evening, row.night, row.weight, row.walk].some(v => v != null) || row.bpM || row.bpE || row.note;
      if (includeEmpty || hasAny) rows.push(row);
    }
    return rows;
  }

  /** ページのDOMを作る */
  function buildPages(rows, opt) {
    const v = x => (x == null ? '' : U.esc(x));
    const pages = [];
    const total = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    for (let p = 0; p < total; p++) {
      const chunk = rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.innerHTML =
        '<div class="pdf-head">' +
          '<span>(' + (p + 1) + 'ページ目)</span>' +
          '<span>' + U.esc(opt.printedAt) + ' 印刷</span>' +
          '<span>氏名： ' + U.esc(opt.name) + '</span>' +
        '</div>' +
        '<div class="pdf-insulin">' + U.esc(insulinText(opt.insulin)) + '</div>' +
        '<table class="pdf-table"><thead><tr>' +
          '<th class="c-date">日付</th><th>朝前</th><th>昼前</th><th>夕前</th><th>就寝前</th>' +
          '<th>体重</th><th class="sep">歩数</th><th class="c-bp">血圧（朝）</th><th class="c-bp">血圧（夕）</th><th class="c-note">備考</th>' +
        '</tr></thead><tbody>' +
        chunk.map(r =>
          '<tr><td class="c-date">' + r.date + '</td>' +
          '<td>' + v(r.morning) + '</td><td>' + v(r.noon) + '</td><td>' + v(r.evening) + '</td><td>' + v(r.night) + '</td>' +
          '<td>' + v(r.weight) + '</td><td class="sep">' + v(r.walk) + '</td>' +
          '<td>' + U.esc(r.bpM) + '</td><td>' + U.esc(r.bpE) + '</td>' +
          '<td class="c-note"><div>' + U.esc(r.note) + '</div></td></tr>'
        ).join('') +
        '</tbody></table>';
      pages.push(el);
    }
    return pages;
  }

  /** ページDOMを画像化してPDFに */
  async function makePdf(pages, filename, onProgress) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    const stage = document.getElementById('pdf-stage');
    stage.innerHTML = '';
    for (let i = 0; i < pages.length; i++) {
      if (onProgress) onProgress(i + 1, pages.length);
      const node = pages[i].cloneNode(true);
      stage.appendChild(node);
      const canvas = await html2canvas(node, { scale: 2.5, backgroundColor: '#ffffff', width: PAGE_W, height: PAGE_H, windowWidth: PAGE_W, logging: false });
      stage.removeChild(node);
      if (i > 0) doc.addPage('a4', 'landscape');
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210, undefined, 'FAST');
    }
    doc.setProperties({ title: filename.replace(/\.pdf$/, '') });
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  window.BGPdf = { buildRows, buildPages, makePdf, insulinText, ROWS_PER_PAGE };
})();
