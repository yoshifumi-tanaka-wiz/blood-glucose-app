(function () {
  'use strict';

  const SLOTS = ['morning', 'noon', 'evening', 'night'];
  const SLOT_LABEL = { morning: '朝', noon: '昼', evening: '夕', night: '就寝前' };
  const SLOT_COLOR = { morning: '#2E9E5B', noon: '#D64545', evening: '#EE8A2F', night: '#2F6FD6' };
  const DAY_START_HOUR = 5;

  const pad = n => ('0' + n).slice(-2);

  /** Date → 'yyyy/MM/dd'（端末のローカル時刻） */
  function fmtDate(d) {
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate());
  }
  function fmtTime(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtDateTime(d) {
    return fmtDate(d) + ' ' + fmtTime(d) + ':' + pad(d.getSeconds());
  }
  /** 記録日（0:00〜5:00は前日） */
  function logicalDate(now) {
    return fmtDate(new Date(now.getTime() - DAY_START_HOUR * 3600000));
  }
  /** 時間帯（開始時刻を含み、終了時刻を含まない） */
  function slotOfTime(hhmm) {
    const h = Number(String(hhmm).slice(0, 2));
    if (h >= 5 && h < 11) return 'morning';
    if (h >= 11 && h < 16) return 'noon';
    if (h >= 16 && h < 21) return 'evening';
    return 'night';
  }
  function parseYmd(ymd) {
    const p = ymd.split('/').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function addDays(ymd, n) {
    const d = parseYmd(ymd);
    d.setDate(d.getDate() + n);
    return fmtDate(d);
  }
  function diffDays(a, b) {
    return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
  }
  /** 記録日＋時刻 → 実際の日時（0:00〜5:00は翌日） */
  function actualDate(ymd, hhmm) {
    const d = parseYmd(ymd);
    const h = Number(hhmm.slice(0, 2)), m = Number(hhmm.slice(3, 5));
    if (h < DAY_START_HOUR) d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
    return d;
  }
  const toInputDate = ymd => (ymd || '').replace(/\//g, '-');
  const fromInputDate = s => (s || '').replace(/-/g, '/');
  const md = ymd => Number(ymd.slice(5, 7)) + '/' + Number(ymd.slice(8, 10));
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = ymd => WEEK[parseYmd(ymd).getDay()];

  /** 全角数字などを半角に */
  function normalize(v) {
    return String(v == null ? '' : v)
      .replace(/[０-９．：／－＋]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .trim();
  }
  /** 血糖値の検証。正しければ数値、だめならnull */
  function parseGlucose(v) {
    const s = normalize(v);
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return n >= 20 && n <= 600 ? n : null;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer = null;
  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, type === 'error' ? 4500 : 2600);
  }

  const store = {
    get(k, def) {
      try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ }
    },
    del(k) {
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
    },
  };

  window.U = {
    SLOTS, SLOT_LABEL, SLOT_COLOR, pad, fmtDate, fmtTime, fmtDateTime, logicalDate, slotOfTime,
    parseYmd, addDays, diffDays, actualDate, toInputDate, fromInputDate, md, weekday,
    normalize, parseGlucose, esc, toast, store,
  };
})();
