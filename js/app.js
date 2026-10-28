(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const CACHE_KEY = 'bg_cache';
  const PREF_KEY = 'bg_prefs';
  const OLD_INS_KEY = 'bg_insulin'; // 旧バージョンで端末に保存していたインスリン値（起動時に削除）
  const DEFAULT_TIME = { morning: '07:00', noon: '12:00', evening: '18:00', night: '22:00' };

  const prefs = Object.assign({ days: 7, visible: { morning: true, noon: true, evening: true, night: true } }, U.store.get(PREF_KEY, {}));

  const S = {
    data: null,          // { glucose:[], daily:[], canImport }（端末にキャッシュする）
    exportSettings: null, // { name, insulin }（氏名を含むため端末には保存しない）
    exportFilled: false,
    loadedFrom: null,    // 取得済みの最古の記録日
    view: null,
    params: {},
    entry: { id: null, slot: 'morning', slotTouched: false },
    recShown: 14,
    busy: false,
  };

  // ====================== 共通 ======================
  function today() { return U.logicalDate(new Date()); }
  function nowSlot() { return U.slotOfTime(U.fmtTime(new Date())); }

  function saveCache() {
    if (!S.data) return;
    // 氏名などの個人情報は端末（localStorage）に残さない
    const data = { glucose: S.data.glucose, daily: S.data.daily, canImport: S.data.canImport };
    U.store.set(CACHE_KEY, { data: data, loadedFrom: S.loadedFrom, at: Date.now() });
  }

  function loading(on) { $('loading').hidden = !on; }

  function findGlucose(date, slot) {
    return S.data.glucose.find(r => r.date === date && r.slot === slot);
  }

  function upsertGlucose(rec) {
    const i = S.data.glucose.findIndex(r => r.id === rec.id);
    if (i >= 0) S.data.glucose[i] = rec; else S.data.glucose.push(rec);
    S.data.canImport = false;
    saveCache();
  }

  function mergeRange(res) {
    const ids = new Set(S.data.glucose.map(r => r.id));
    res.glucose.forEach(r => { if (!ids.has(r.id)) S.data.glucose.push(r); });
    const dates = new Set(S.data.daily.map(r => r.date));
    res.daily.forEach(r => { if (!dates.has(r.date)) S.data.daily.push(r); });
  }

  async function ensureLoaded(fromYmd) {
    if (S.loadedFrom && fromYmd >= S.loadedFrom) return;
    const to = U.addDays(S.loadedFrom || today(), -1);
    const res = await API.call('getRange', { from: fromYmd, to: to });
    mergeRange(res);
    S.loadedFrom = fromYmd;
    saveCache();
  }

  function errToast(e) {
    U.toast(e && e.message ? e.message : 'エラーが発生しました', 'error');
  }

  async function withButton(btn, fn) {
    if (S.busy) return;
    S.busy = true;
    const label = btn.textContent;
    btn.disabled = true;
    btn.classList.add('is-busy');
    try { return await fn(); } finally {
      S.busy = false;
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.textContent = label;
    }
  }

  // ====================== 認証・起動 ======================
  function showLogin() {
    S.data = null;
    S.exportSettings = null;
    S.exportFilled = false;
    $('topbar').hidden = true;
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-login'; });
    setTimeout(() => $('login-pass').focus(), 50);
  }

  async function refresh(silent) {
    if (!silent) loading(true);
    try {
      const r = await API.call('init');
      S.data = { glucose: r.glucose, daily: r.daily, canImport: r.canImport };
      S.exportSettings = r.exportSettings || null;
      S.loadedFrom = r.from;
      saveCache();
      route();
    } catch (e) {
      if (e.code !== 'AUTH') errToast(e);
    } finally {
      loading(false);
    }
  }

  function boot() {
    bindEvents();
    U.store.del(OLD_INS_KEY);
    if (!API.hasToken()) { showLogin(); return; }
    const cache = U.store.get(CACHE_KEY, null);
    if (cache && cache.data) {
      S.data = { glucose: cache.data.glucose, daily: cache.data.daily, canImport: cache.data.canImport };
      saveCache(); // 旧キャッシュに含まれていた氏名を消す
      S.loadedFrom = cache.loadedFrom;
      route();
      refresh(true);
    } else {
      refresh(false);
    }
  }

  // ====================== ルーティング ======================
  const VIEWS = {
    home: { title: '血糖値記録', back: false, render: renderHome },
    entry: { title: '時間を変更して入力', back: true, render: renderEntry },
    daily: { title: '備考欄の入力', back: true, render: renderDaily },
    export: { title: 'データの出力', back: true, render: renderExport },
    import: { title: '過去データの取り込み', back: true, render: renderImport },
  };

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, qs] = h.split('?');
    const params = {};
    (qs || '').split('&').filter(Boolean).forEach(p => {
      const [k, v] = p.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return { name: VIEWS[name] ? name : 'home', params: params };
  }

  function route() {
    if (!API.hasToken()) { showLogin(); return; }
    if (!S.data) return;
    const { name, params } = parseHash();
    const v = VIEWS[name];
    const changed = S.view !== name;
    S.view = name;
    S.params = params;
    $('topbar').hidden = false;
    $('page-title').textContent = v.title;
    $('btn-back').hidden = !v.back;
    document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== 'view-' + name; });
    document.body.dataset.view = name;
    v.render(changed);
    if (changed) window.scrollTo(0, 0);
  }

  // ====================== ホーム ======================
  function renderHome() {
    const t = today();
    const slot = nowSlot();
    $('quick-slot').textContent = U.md(t) + '（' + U.weekday(t) + '） ' + U.SLOT_LABEL[slot];
    $('quick-slot').style.setProperty('--c', U.SLOT_COLOR[slot]);
    const done = findGlucose(t, slot);
    const msg = $('quick-msg');
    if (done) {
      msg.innerHTML = U.SLOT_LABEL[slot] + 'は記録済みです（' + done.value + '）。<a href="#/entry?id=' + encodeURIComponent(done.id) + '">修正する</a>';
      msg.hidden = false;
    } else {
      msg.hidden = true;
    }

    $('today-chips').innerHTML = U.SLOTS.map(s => {
      const r = findGlucose(t, s);
      const href = r ? '#/entry?id=' + encodeURIComponent(r.id) : '#/entry?date=' + t + '&slot=' + s;
      return '<a class="chip' + (r ? ' has' : '') + (s === slot ? ' now' : '') + '" href="' + href + '" style="--c:' + U.SLOT_COLOR[s] + '">' +
        '<span class="chip-l">' + U.SLOT_LABEL[s] + '</span><span class="chip-v">' + (r ? r.value : '—') + '</span></a>';
    }).join('');

    $('import-link').hidden = !S.data.canImport;

    document.querySelectorAll('#period-seg button').forEach(b => {
      b.classList.toggle('on', Number(b.dataset.days) === prefs.days);
    });
    $('slot-toggles').innerHTML = U.SLOTS.map(s =>
      '<button class="toggle' + (prefs.visible[s] ? ' on' : '') + '" data-slot="' + s + '" aria-pressed="' + !!prefs.visible[s] + '" style="--c:' + U.SLOT_COLOR[s] + '">' +
      '<i></i>' + U.SLOT_LABEL[s] + '</button>').join('');
    drawChart();
  }

  function drawChart() {
    const res = BGChart.render($('chart'), S.data.glucose, prefs.days, prefs.visible, today());
    $('chart-empty').hidden = res.count > 0;
  }

  async function submitQuick(ev) {
    ev.preventDefault();
    const input = $('quick-value');
    const v = U.parseGlucose(input.value);
    if (v === null) { U.toast('血糖値は20〜600の整数で入力してください', 'error'); input.focus(); return; }
    await withButton($('quick-btn'), async () => {
      try {
        const r = await API.call('quickGlucose', { value: v });
        upsertGlucose(r.record);
        input.value = '';
        input.blur();
        U.toast(U.SLOT_LABEL[r.record.slot] + ' ' + r.record.value + ' mg/dL を記録しました', 'ok');
        renderHome();
      } catch (e) { errToast(e); }
    });
  }

  // ====================== 入力・修正 ======================
  function renderEntry(changed) {
    const p = S.params;
    const t = today();
    let rec = p.id ? S.data.glucose.find(r => r.id === p.id) : null;
    if (p.id && !rec) { U.toast('記録が見つかりません', 'error'); }
    S.entry.id = rec ? rec.id : null;
    S.entry.slotTouched = false;

    if (rec) {
      $('entry-date').value = U.toInputDate(rec.date);
      $('entry-time').value = rec.time;
      S.entry.slot = rec.slot;
      $('entry-value').value = rec.value;
    } else {
      const date = p.date || t;
      const slot = p.slot || nowSlot();
      $('entry-date').value = U.toInputDate(date);
      $('entry-time').value = (date === t && slot === nowSlot()) ? U.fmtTime(new Date()) : DEFAULT_TIME[slot];
      S.entry.slot = slot;
      $('entry-value').value = '';
    }
    $('entry-title').textContent = rec ? '記録の修正' : '血糖値の入力';
    $('entry-delete').hidden = !rec;
    $('entry-cancel').hidden = !rec;
    $('entry-save').textContent = rec ? '修正を保存' : '保存';
    renderSlotSeg();
    updateEntryHint();
    renderRecTable();
  }

  function renderSlotSeg() {
    $('entry-slot').innerHTML = U.SLOTS.map(s =>
      '<button type="button" data-slot="' + s + '" class="' + (S.entry.slot === s ? 'on' : '') + '" style="--c:' + U.SLOT_COLOR[s] + '">' + U.SLOT_LABEL[s] + '</button>'
    ).join('');
  }

  function updateEntryHint() {
    const date = U.fromInputDate($('entry-date').value);
    const time = $('entry-time').value;
    const el = $('entry-actual');
    if (!date || !time) { el.textContent = ''; return; }
    const a = U.actualDate(date, time);
    let html = '実際の測定日時：' + (a.getMonth() + 1) + '/' + a.getDate() + '（' + U.weekday(U.fmtDate(a)) + '） ' + time;
    if (U.fmtDate(a) !== date) html += '<br><span class="note">0:00〜5:00の記録は前日（' + U.md(date) + '）分として管理されます</span>';
    const dup = findGlucose(date, S.entry.slot);
    if (dup && dup.id !== S.entry.id) {
      html += '<br><span class="warn">' + U.md(date) + 'の' + U.SLOT_LABEL[S.entry.slot] + 'は記録済みです（' + dup.value + '）。' +
        '<a href="#/entry?id=' + encodeURIComponent(dup.id) + '">そちらを修正する</a></span>';
    }
    el.innerHTML = html;
  }

  function renderRecTable() {
    const t = today();
    const rows = [];
    const byKey = {};
    S.data.glucose.forEach(r => { byKey[r.date + '|' + r.slot] = r; });
    for (let i = 0; i < S.recShown; i++) {
      const d = U.addDays(t, -i);
      const cells = U.SLOTS.map(s => {
        const r = byKey[d + '|' + s];
        if (r) {
          const cls = 'v' + (r.value >= 180 ? ' hi' : r.value < 70 ? ' lo' : '') + (r.id === S.entry.id ? ' editing' : '');
          return '<td><a class="' + cls + '" href="#/entry?id=' + encodeURIComponent(r.id) + '"><b>' + r.value + '</b><small>' + r.time + '</small></a></td>';
        }
        if (S.loadedFrom && d < S.loadedFrom) return '<td><span class="v unknown">?</span></td>';
        return '<td><a class="v empty" href="#/entry?date=' + d + '&slot=' + s + '">＋</a></td>';
      }).join('');
      const wd = U.weekday(d);
      rows.push('<tr><th class="' + (wd === '日' ? 'sun' : wd === '土' ? 'sat' : '') + '">' + U.md(d) + '<small>（' + wd + '）</small></th>' + cells + '</tr>');
    }
    $('rec-table').tBodies[0].innerHTML = rows.join('');
  }

  async function loadMoreRecords() {
    await withButton($('rec-more'), async () => {
      S.recShown += 14;
      const oldest = U.addDays(today(), -(S.recShown - 1));
      try { await ensureLoaded(oldest); } catch (e) { errToast(e); }
      renderRecTable();
    });
  }

  async function submitEntry(ev) {
    ev.preventDefault();
    const date = U.fromInputDate($('entry-date').value);
    const time = $('entry-time').value;
    const value = U.parseGlucose($('entry-value').value);
    if (!date) return U.toast('日付を入力してください', 'error');
    if (!/^\d{2}:\d{2}$/.test(time)) return U.toast('時刻を入力してください', 'error');
    if (value === null) { $('entry-value').focus(); return U.toast('血糖値は20〜600の整数で入力してください', 'error'); }
    await withButton($('entry-save'), async () => {
      try {
        const r = await API.call('saveGlucose', { id: S.entry.id || '', date: date, time: time, slot: S.entry.slot, value: value });
        upsertGlucose(r.record);
        U.toast(U.md(date) + ' ' + U.SLOT_LABEL[r.record.slot] + ' ' + r.record.value + ' を保存しました', 'ok');
        if (S.entry.id) {
          location.hash = '#/entry';
        } else {
          $('entry-value').value = '';
          updateEntryHint();
          renderRecTable();
        }
      } catch (e) { errToast(e); }
    });
  }

  async function deleteEntry() {
    const rec = S.data.glucose.find(r => r.id === S.entry.id);
    if (!rec) return;
    if (!window.confirm(U.md(rec.date) + ' ' + U.SLOT_LABEL[rec.slot] + '（' + rec.value + '）を削除しますか？')) return;
    await withButton($('entry-delete'), async () => {
      try {
        await API.call('deleteGlucose', { id: rec.id });
        S.data.glucose = S.data.glucose.filter(r => r.id !== rec.id);
        saveCache();
        U.toast('削除しました', 'ok');
        location.hash = '#/entry';
      } catch (e) { errToast(e); }
    });
  }

  // ====================== 毎日のデータ ======================
  const DAILY_INPUTS = {
    walk: 'd-walk', bp_max_morning: 'd-bpmaxm', bp_min_morning: 'd-bpminm',
    bp_max_evening: 'd-bpmaxe', bp_min_evening: 'd-bpmine', weight: 'd-weight', note: 'd-note',
  };

  async function renderDaily() {
    const date = S.params.date && /^\d{4}\/\d{2}\/\d{2}$/.test(S.params.date) ? S.params.date : today();
    $('daily-date').value = U.toInputDate(date);
    $('daily-next').disabled = date >= today();
    if (S.loadedFrom && date < S.loadedFrom) {
      loading(true);
      try { await ensureLoaded(date); } catch (e) { errToast(e); } finally { loading(false); }
    }
    const rec = S.data.daily.find(r => r.date === date) || {};
    Object.keys(DAILY_INPUTS).forEach(k => { $(DAILY_INPUTS[k]).value = rec[k] == null ? '' : rec[k]; });
    $('daily-clear').hidden = !S.data.daily.some(r => r.date === date);
    $('daily-glucose').innerHTML =
      '<span class="dg-date">' + U.md(date) + '（' + U.weekday(date) + '）の血糖値</span>' +
      U.SLOTS.map(s => {
        const r = findGlucose(date, s);
        return '<span class="dg" style="--c:' + U.SLOT_COLOR[s] + '">' + U.SLOT_LABEL[s] + ' <b>' + (r ? r.value : '—') + '</b></span>';
      }).join('');
  }

  function dailyDate() { return U.fromInputDate($('daily-date').value) || today(); }

  function readDailyForm() {
    const v = {};
    const err = [];
    const int = (k, label, min, max) => {
      const s = U.normalize($(DAILY_INPUTS[k]).value);
      if (s === '') { v[k] = ''; return; }
      if (!/^\d+$/.test(s) || +s < min || +s > max) err.push(label + 'は' + min + '〜' + max + 'の整数で入力してください');
      v[k] = s;
    };
    int('walk', '歩数', 0, 200000);
    int('bp_max_morning', '朝の最大血圧', 30, 300);
    int('bp_min_morning', '朝の最小血圧', 30, 300);
    int('bp_max_evening', '夕方の最大血圧', 30, 300);
    int('bp_min_evening', '夕方の最小血圧', 30, 300);
    const w = U.normalize($('d-weight').value);
    if (w !== '' && (!isFinite(Number(w)) || +w < 10 || +w > 300)) err.push('体重は10〜300で入力してください');
    v.weight = w;
    v.note = $('d-note').value.trim();
    return { values: v, error: err[0] };
  }

  async function submitDaily(ev) {
    ev.preventDefault();
    const f = readDailyForm();
    if (f.error) return U.toast(f.error, 'error');
    const date = dailyDate();
    await withButton($('daily-save'), async () => {
      try {
        const r = await API.call('saveDaily', { date: date, values: f.values });
        S.data.daily = S.data.daily.filter(x => x.date !== date);
        if (r.record) {
          const rec = { date: date };
          Object.keys(DAILY_INPUTS).forEach(k => { rec[k] = r.record[k] === '' ? null : r.record[k]; });
          S.data.daily.push(rec);
        }
        S.data.canImport = S.data.canImport && !r.record;
        saveCache();
        U.toast(U.md(date) + ' のデータを' + (r.record ? '保存' : '削除') + 'しました', 'ok');
        renderDaily();
      } catch (e) { errToast(e); }
    });
  }

  async function clearDaily() {
    const date = dailyDate();
    if (!window.confirm(U.md(date) + ' の歩数・血圧・体重・備考を削除しますか？（血糖値は削除されません）')) return;
    await withButton($('daily-clear'), async () => {
      try {
        await API.call('deleteDaily', { date: date });
        S.data.daily = S.data.daily.filter(x => x.date !== date);
        saveCache();
        U.toast('削除しました', 'ok');
        renderDaily();
      } catch (e) { errToast(e); }
    });
  }

  function moveDaily(n) {
    const d = U.addDays(dailyDate(), n);
    if (d > today()) return;
    location.hash = '#/daily?date=' + d;
  }

  // ====================== PDF出力 ======================
  let exChanged = false;

  function renderExport(changed) {
    if (changed) {
      const t = today();
      $('ex-to').value = U.toInputDate(t);
      $('ex-from').value = U.toInputDate(U.addDays(t, -13));
      $('ex-name').value = '';
      ['morning', 'noon', 'evening', 'night'].forEach(k => { $('ins-' + k).value = ''; });
      exChanged = false; // インスリン変更は毎回「無」から
      renderExChanged();
      $('ex-status').textContent = '';
      $('ex-previewbox').innerHTML = '<p class="hint">「プレビュー」を押すと表示されます。</p>';
      S.exportFilled = false;
    }
    fillExportSettings();
  }

  /** 前回PDFを作成した時の氏名・インスリン単位数を入れる（サーバーから取得できた時点で1回だけ） */
  function fillExportSettings() {
    if (S.exportFilled || !S.exportSettings) return;
    const es = S.exportSettings;
    const ids = ['ex-name', 'ins-morning', 'ins-noon', 'ins-evening', 'ins-night'];
    if (ids.some(id => $(id).value !== '')) { S.exportFilled = true; return; } // 入力済みなら上書きしない
    $('ex-name').value = es.name || '';
    ['morning', 'noon', 'evening', 'night'].forEach(k => {
      const v = es.insulin && es.insulin[k];
      $('ins-' + k).value = v == null ? '' : v;
    });
    S.exportFilled = true;
  }

  function renderExChanged() {
    document.querySelectorAll('#ex-changed button').forEach(b => {
      b.classList.toggle('on', (b.dataset.v === '1') === exChanged);
    });
  }

  function readExportForm() {
    const from = U.fromInputDate($('ex-from').value);
    const to = U.fromInputDate($('ex-to').value);
    if (!from || !to) return { error: '期間を入力してください' };
    if (from > to) return { error: '開始日が終了日より後になっています' };
    if (U.diffDays(from, to) > 366) return { error: '期間は1年以内で指定してください' };
    const ins = { changed: exChanged };
    for (const k of ['morning', 'noon', 'evening', 'night']) {
      const s = U.normalize($('ins-' + k).value);
      if (s !== '' && (!/^\d+(\.\d+)?$/.test(s) || +s > 300)) return { error: 'インスリン単位数は数値で入力してください' };
      ins[k] = s;
    }
    return { from: from, to: to, name: $('ex-name').value.trim(), insulin: ins, includeEmpty: $('ex-empty').checked };
  }

  async function prepareExport() {
    const f = readExportForm();
    if (f.error) { U.toast(f.error, 'error'); return null; }
    $('ex-status').textContent = 'データを取得しています…';
    const res = await API.call('getRange', { from: f.from, to: f.to });
    const rows = BGPdf.buildRows(res, f.from, f.to, f.includeEmpty);
    const pages = BGPdf.buildPages(rows, { printedAt: U.fmtDateTime(new Date()), name: f.name, insulin: f.insulin });
    showPreview(pages);
    $('ex-status').textContent = rows.length + '日分・' + pages.length + 'ページ';
    return { f: f, pages: pages };
  }

  function showPreview(pages) {
    const box = $('ex-previewbox');
    box.innerHTML = '';
    const w = box.clientWidth || 300;
    const scale = Math.min(1, w / 1123);
    pages.forEach(p => {
      const wrap = document.createElement('div');
      wrap.className = 'preview-page';
      wrap.style.height = Math.round(794 * scale) + 'px';
      wrap.style.width = Math.round(1123 * scale) + 'px';
      const node = p.cloneNode(true);
      node.style.transform = 'scale(' + scale + ')';
      wrap.appendChild(node);
      box.appendChild(wrap);
    });
  }

  async function onPreview() {
    await withButton($('ex-preview'), async () => {
      try { await prepareExport(); } catch (e) { errToast(e); $('ex-status').textContent = ''; }
    });
  }

  async function onPdf(ev) {
    ev.preventDefault();
    await withButton($('ex-pdf'), async () => {
      try {
        const r = await prepareExport();
        if (!r) return;
        if (!window.jspdf || !window.html2canvas) throw new Error('PDFライブラリを読み込めませんでした');
        const name = '血糖値記録_' + r.f.from.replace(/\//g, '') + '-' + r.f.to.replace(/\//g, '') + '.pdf';
        await BGPdf.makePdf(r.pages, name, (i, n) => { $('ex-status').textContent = 'PDFを作成しています…（' + i + '/' + n + 'ページ）'; });
        $('ex-status').textContent = 'PDFを作成しました（' + name + '）';
        // 次回のために氏名・インスリン単位数をサーバーに保存（インスリン変更の有無は保存しない）
        const ins = r.f.insulin;
        const settings = { name: r.f.name, insulin: { morning: ins.morning, noon: ins.noon, evening: ins.evening, night: ins.night } };
        try {
          const s = await API.call('saveExportSettings', settings);
          S.exportSettings = s.exportSettings;
        } catch (e) {
          U.toast('PDFは作成しましたが、氏名・単位数の保存に失敗しました', 'error');
        }
      } catch (e) { errToast(e); }
    });
  }

  // ====================== JSON取り込み ======================
  let importItems = null;

  function renderImport(changed) {
    if (!changed) return;
    importItems = null;
    $('imp-run').disabled = true;
    $('imp-summary').innerHTML = S.data.canImport ? '' : '<p class="warn">既にデータが登録されているため、取り込みはできません。</p>';
    $('imp-check').disabled = !S.data.canImport;
  }

  function checkImport() {
    importItems = null;
    $('imp-run').disabled = true;
    let arr;
    try { arr = JSON.parse($('imp-text').value.trim().replace(/,\s*]$/, ']')); } catch (e) {
      $('imp-summary').innerHTML = '<p class="warn">JSONの形式が正しくありません：' + U.esc(e.message) + '</p>';
      return;
    }
    if (!Array.isArray(arr)) { $('imp-summary').innerHTML = '<p class="warn">配列（[ ... ]）の形式で指定してください。</p>'; return; }
    const dates = new Set();
    let dup = 0, bad = 0, gCount = 0, gBad = 0, other = 0;
    arr.forEach(it => {
      const d = it && it.date;
      if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(d || '')) { bad++; return; }
      if (dates.has(d)) { dup++; return; }
      dates.add(d);
      const c = it.content || {};
      U.SLOTS.forEach(s => {
        if (c[s] && c[s].number != null && c[s].number !== '') {
          if (U.parseGlucose(c[s].number) === null) gBad++; else gCount++;
        }
      });
      if (c.other && Object.keys(c.other).some(k => c.other[k] != null && c.other[k] !== '')) other++;
    });
    const sorted = Array.from(dates).sort();
    $('imp-summary').innerHTML =
      '<ul>' +
      '<li>期間：' + (sorted.length ? sorted[0] + ' 〜 ' + sorted[sorted.length - 1] : '—') + '</li>' +
      '<li>日数：' + dates.size + '日</li>' +
      '<li>血糖値：' + gCount + '件' + (gBad ? '（範囲外 ' + gBad + '件は取り込みません）' : '') + '</li>' +
      '<li>歩数・血圧・体重・備考あり：' + other + '日</li>' +
      (dup ? '<li class="warn">日付の重複：' + dup + '件（最初の1件のみ取り込みます）</li>' : '') +
      (bad ? '<li class="warn">日付が不正：' + bad + '件（取り込みません）</li>' : '') +
      '</ul>';
    if (dates.size > 0) { importItems = arr; $('imp-run').disabled = false; }
  }

  async function runImport() {
    if (!importItems) return;
    if (!window.confirm('この内容で取り込みますか？')) return;
    await withButton($('imp-run'), async () => {
      loading(true);
      try {
        const r = await API.call('importJson', { items: importItems });
        U.toast(r.days + '日分（血糖値' + r.glucoseCount + '件）を取り込みました', 'ok');
        if (r.skippedCount) {
          $('imp-summary').innerHTML = '<p class="warn">取り込めなかった項目：' + r.skippedCount + '件</p><ul>' +
            r.skipped.map(s => '<li>' + U.esc(s) + '</li>').join('') + '</ul>';
        }
        importItems = null;
        await refresh(true);
        if (!r.skippedCount) location.hash = '#/home';
      } catch (e) { errToast(e); } finally { loading(false); }
    });
  }

  // ====================== イベント ======================
  function bindEvents() {
    window.addEventListener('hashchange', route);
    window.addEventListener('auth-required', () => {
      U.store.del(CACHE_KEY);
      U.toast('ログインしてください', 'error');
      showLogin();
    });

    $('login-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const pass = $('login-pass').value;
      if (!pass) return;
      await withButton($('login-btn'), async () => {
        try {
          await API.login(pass);
          $('login-pass').value = '';
          S.view = null;
          await refresh(false);
        } catch (e) { errToast(e); }
      });
    });

    $('btn-back').addEventListener('click', () => { location.hash = '#/home'; });
    $('btn-reload').addEventListener('click', () => refresh(false));
    $('btn-logout').addEventListener('click', async () => {
      if (!window.confirm('ログアウトしますか？')) return;
      await API.logout();
      U.store.del(CACHE_KEY);
      showLogin();
    });

    // ホーム
    $('quick-form').addEventListener('submit', submitQuick);
    $('period-seg').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      prefs.days = Number(b.dataset.days);
      U.store.set(PREF_KEY, prefs);
      document.querySelectorAll('#period-seg button').forEach(x => x.classList.toggle('on', x === b));
      drawChart();
    });
    $('slot-toggles').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      const s = b.dataset.slot;
      prefs.visible[s] = !prefs.visible[s];
      U.store.set(PREF_KEY, prefs);
      b.classList.toggle('on', prefs.visible[s]);
      b.setAttribute('aria-pressed', String(prefs.visible[s]));
      drawChart();
    });

    // 入力・修正
    $('entry-form').addEventListener('submit', submitEntry);
    $('entry-slot').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      S.entry.slot = b.dataset.slot;
      S.entry.slotTouched = true;
      renderSlotSeg();
      updateEntryHint();
    });
    $('entry-time').addEventListener('change', () => {
      const t = $('entry-time').value;
      if (t && !S.entry.slotTouched && !S.entry.id) { S.entry.slot = U.slotOfTime(t); renderSlotSeg(); }
      updateEntryHint();
    });
    $('entry-date').addEventListener('change', updateEntryHint);
    $('entry-delete').addEventListener('click', deleteEntry);
    $('entry-cancel').addEventListener('click', () => { location.hash = '#/entry'; });
    $('rec-more').addEventListener('click', loadMoreRecords);

    // 毎日のデータ
    $('daily-form').addEventListener('submit', submitDaily);
    $('daily-clear').addEventListener('click', clearDaily);
    $('daily-prev').addEventListener('click', () => moveDaily(-1));
    $('daily-next').addEventListener('click', () => moveDaily(1));
    $('daily-date').addEventListener('change', () => {
      const d = U.fromInputDate($('daily-date').value);
      if (d) location.hash = '#/daily?date=' + d;
    });

    // 出力
    $('export-form').addEventListener('submit', onPdf);
    $('ex-preview').addEventListener('click', onPreview);
    $('ex-changed').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      exChanged = b.dataset.v === '1';
      renderExChanged();
    });
    $('ex-quick').addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      const to = U.fromInputDate($('ex-to').value) || today();
      $('ex-from').value = U.toInputDate(U.addDays(to, -(Number(b.dataset.days) - 1)));
    });

    // 取り込み
    $('imp-file').addEventListener('change', ev => {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { $('imp-text').value = reader.result; checkImport(); };
      reader.readAsText(file);
    });
    $('imp-check').addEventListener('click', checkImport);
    $('imp-run').addEventListener('click', runImport);

    // 時間帯の自動更新（ホーム表示中）
    setInterval(() => { if (S.view === 'home' && S.data && document.activeElement !== $('quick-value')) renderHome(); }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && S.data && API.hasToken()) refresh(true);
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
