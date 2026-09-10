/* EDUStudio 60s film — deterministic timeline renderer */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- math ---------- */
  function seg(t, a, b) { if (b === a) return t >= b ? 1 : 0; return Math.min(1, Math.max(0, (t - a) / (b - a))); }
  function sm(x) { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }
  function lerp(a, b, x) { return a + (b - a) * x; }
  function Eo(x) { return 1 - Math.pow(1 - x, 3); }
  function Ei(x) { return x * x * x; }
  function Eio(x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function Eb(x) { var c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function Ee(x) { return x === 1 ? 1 : 1 - Math.pow(2, -10 * x); }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function px(n) { return n.toFixed(2) + 'px'; }

  /* ---------- icons ---------- */
  var S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  var ICON = {
    users: '<svg viewBox="0 0 24 24" ' + S + '><circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6"/><path d="M16.4 6.6a3 3 0 0 1 0 5.6M18 14.8c2.2.6 3.6 2.4 3.6 5.2"/></svg>',
    chart: '<svg viewBox="0 0 24 24" ' + S + '><path d="M4 20V11M10 20V5M16 20v-6"/><path d="M2.5 20h19"/></svg>',
    book: '<svg viewBox="0 0 24 24" ' + S + '><path d="M12 6.6C10.4 5.3 8.3 4.7 5 4.7V19c3.3 0 5.4.6 7 1.9 1.6-1.3 3.7-1.9 7-1.9V4.7c-3.3 0-5.4.6-7 1.9z"/><path d="M12 6.6V21"/></svg>',
    search: '<svg viewBox="0 0 24 24" ' + S + '><circle cx="10.8" cy="10.8" r="6.4"/><path d="M20 20l-4.6-4.6"/></svg>',
    quiz: '<svg viewBox="0 0 24 24" ' + S + '><rect x="4" y="3" width="16" height="18" rx="2.6"/><path d="M8.4 8.6h7.2M8.4 12.6h7.2M8.4 16.6h4"/></svg>',
    doc: '<svg viewBox="0 0 24 24" ' + S + '><path d="M6.2 3h7.4L19 8.4V21H6.2z"/><path d="M13.4 3v5.6H19"/></svg>',
    folder: '<svg viewBox="0 0 24 24" ' + S + '><path d="M3 7.4A2.4 2.4 0 0 1 5.4 5h3.2l2 2.3h7.9A2.4 2.4 0 0 1 21 9.7v8A2.4 2.4 0 0 1 18.6 20H5.4A2.4 2.4 0 0 1 3 17.7z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" ' + S + '><path d="M12 3l2.1 5.6L19.7 11l-5.6 2.1L12 18.7l-2.1-5.6L4.3 11l5.6-2.4z"/></svg>',
    target: '<svg viewBox="0 0 24 24" ' + S + '><circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.6"/></svg>',
    check: '<svg viewBox="0 0 24 24" ' + S + '><path d="M4.5 12.6l5 5L19.5 6.8"/></svg>',
    pen: '<svg viewBox="0 0 24 24" ' + S + '><path d="M4 20l4.4-1 10-10-3.4-3.4-10 10z"/><path d="M14.6 5.2l3.4 3.4"/></svg>'
  };
  function ic(name, size, color) {
    var s = ICON[name].replace('viewBox="0 0 24 24"', 'viewBox="0 0 24 24" width="' + (size || 24) + '" height="' + (size || 24) + '"');
    return '<span class="ico" style="width:' + (size || 24) + 'px;height:' + (size || 24) + 'px;' + (color ? 'color:' + color : '') + '">' + s + '</span>';
  }

  /* ---------- dom helper ---------- */
  function mk(parent, cls, html, css) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    if (html) d.innerHTML = html;
    if (css) d.setAttribute('style', css);
    parent.appendChild(d); return d;
  }
  function st(d, x, y, k, rot, op) {
    d.style.transform = 'translate(' + (x).toFixed(2) + 'px,' + (y).toFixed(2) + 'px)' + (k !== undefined && k !== null ? ' scale(' + k.toFixed(4) + ')' : '') + (rot ? ' rotate(' + rot.toFixed(2) + 'deg)' : '');
    if (op !== undefined && op !== null) d.style.opacity = op;
  }

  var camera = $('camera'), stage = $('stage'), gridbg = $('gridbg');
  var hero = $('hero'), cursor = $('cursor'), skill = $('skill'), outro = $('outro');
  var hcEdge = hero.querySelector('.hc-edge'), hcHalo = hero.querySelector('.hc-halo');
  var hcDot = hero.querySelector('.hc-dot'), hcTick = hero.querySelector('.tick');
  var hcDelta = hero.querySelector('.hc-delta'), hcShine = hero.querySelector('.hc-shine');
  var trDown = $('trDown'), trUp = $('trUp'), trUpDot = $('trUpDot');
  var cursorRipple = cursor.querySelector('.ripple');

  stage.appendChild(outro); /* 尾板不随镜头缩放 */

  var cam = { x: 0, y: 0, s: 1 };
  function w2sx(wx) { return 640 + (wx - 640) * cam.s + cam.x; }
  function w2sy(wy) { return 360 + (wy - 360) * cam.s + cam.y; }
  function s2wx(sx) { return 640 + (sx - 640 - cam.x) / cam.s; }
  function s2wy(sy) { return 360 + (sy - 360 - cam.y) / cam.s; }

  function setHero(cx, cy, k, rot, op) {
    hero.style.transform = 'translate(' + (cx - 118) + 'px,' + (cy - 148) + 'px) scale(' + k + ')' + (rot ? ' rotate(' + rot + 'deg)' : '');
    hero.style.opacity = op;
  }

  /* ================= background blobs ================= */
  var blobs = [];
  (function () {
    var defs = [
      [170, 130, 300, '#DFF3F9', .55], [1120, 150, 340, '#E2F7EE', .5],
      [1010, 640, 300, '#DFF3F9', .5], [250, 660, 260, '#FFE1AB', .28],
      [640, 360, 460, '#FFFFFF', .5]
    ];
    var host = $('blobs');
    defs.forEach(function (d, i) {
      var b = mk(host, 'blob', '', 'left:0;top:0;width:' + d[2] + 'px;height:' + d[2] + 'px;background:' + d[3] + ';opacity:' + d[4]);
      blobs.push({ el: b, x: d[0], y: d[1], r: d[2], ph: i * 1.3, op: d[4] });
    });
  })();

  /* ================= SCENE 1 : 教师工作空间 ================= */
  var sc1 = $('sc1'), floaters = [];
  (function () {
    function wrap(inner, w, h) {
      return '<div style="width:100%;height:100%;padding:14px;">' + inner + '</div>';
    }
    var parts = [
      ['schedule', 168, 132, wrap('<div style="height:9px;width:46px;background:#DFF3F9;border-radius:5px;margin-bottom:11px"></div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px">' +
        '<div style="height:22px;border-radius:6px;background:#DFF3F9"></div><div style="height:22px;border-radius:6px;background:#E2F7EE"></div><div style="height:22px;border-radius:6px;background:#FFE1AB"></div>' +
        '<div style="height:22px;border-radius:6px;background:#E2F7EE"></div><div style="height:22px;border-radius:6px;background:#F1FAFC"></div><div style="height:22px;border-radius:6px;background:#DFF3F9"></div>' +
        '<div style="height:22px;border-radius:6px;background:#FFE1AB"></div><div style="height:22px;border-radius:6px;background:#DFF3F9"></div><div style="height:22px;border-radius:6px;background:#E2F7EE"></div></div>', 168, 132)],
      ['sheet', 150, 150, wrap('<div style="height:100%;background:#fff;border-radius:8px;box-shadow:0 2px 6px rgba(20,80,100,.07);padding:12px">' +
        '<div style="height:7px;border-radius:4px;background:#EAF4F7;margin-bottom:9px"></div>' +
        '<div style="height:7px;width:78%;border-radius:4px;background:#EAF4F7;margin-bottom:9px"></div>' +
        '<div style="height:7px;width:60%;border-radius:4px;background:#EAF4F7;margin-bottom:14px"></div>' +
        '<svg viewBox="0 0 24 24" width="30" height="30" style="margin-left:auto;display:block"><path d="M4.5 12.6l5 5L19.5 6.8" fill="none" stroke="#2CC08B" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>', 150, 150)],
      ['bars', 176, 128, wrap('<div style="height:9px;width:52px;background:#DFF3F9;border-radius:5px;margin-bottom:10px"></div>' +
        '<div style="display:flex;align-items:flex-end;gap:11px;height:62px">' +
        '<div style="flex:1;height:40%;background:#8EDCEA;border-radius:5px 5px 0 0"></div>' +
        '<div style="flex:1;height:72%;background:#8EDCEA;border-radius:5px 5px 0 0"></div>' +
        '<div style="flex:1;height:34%;background:#EE5A54;border-radius:5px 5px 0 0"></div>' +
        '<div style="flex:1;height:58%;background:#8EDCEA;border-radius:5px 5px 0 0"></div></div>', 176, 128)],
      ['doc', 148, 148, wrap('<div style="height:100%;background:#fff;border-radius:8px;padding:13px;box-shadow:0 2px 6px rgba(20,80,100,.07)">' +
        '<div style="height:8px;width:56px;background:#8EDCEA;border-radius:4px;margin-bottom:12px"></div>' +
        '<div style="height:6px;border-radius:3px;background:#EAF4F7;margin-bottom:8px"></div>' +
        '<div style="height:6px;width:84%;border-radius:3px;background:#EAF4F7;margin-bottom:8px"></div>' +
        '<div style="height:6px;width:66%;border-radius:3px;background:#EAF4F7"></div></div>', 148, 148)],
      ['line', 178, 120, wrap('<svg viewBox="0 0 150 66" width="150" height="66"><polyline points="4,52 40,44 76,26 112,30 146,12" fill="none" stroke="#EE5A54" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><line x1="4" y1="60" x2="146" y2="60" stroke="#EAF4F7" stroke-width="3" stroke-linecap="round"/></svg>', 178, 120)],
      ['users', 160, 116, wrap('<div style="display:flex;gap:9px;margin-top:8px">' +
        '<div style="width:38px;height:38px;border-radius:50%;background:#DFF3F9;position:relative"><div style="position:absolute;left:9px;top:8px;width:20px;height:20px;border-radius:50%;background:#8EDCEA"></div></div>' +
        '<div style="width:38px;height:38px;border-radius:50%;background:#E2F7EE;position:relative"><div style="position:absolute;left:9px;top:8px;width:20px;height:20px;border-radius:50%;background:#A7E9CE"></div></div>' +
        '<div style="width:38px;height:38px;border-radius:50%;background:#FFE1AB;position:relative"><div style="position:absolute;left:9px;top:8px;width:20px;height:20px;border-radius:50%;background:#F5A623"></div></div></div>', 160, 116)],
      ['ring', 132, 132, wrap('<svg viewBox="0 0 100 100" width="104" height="104"><circle cx="50" cy="50" r="36" fill="none" stroke="#EAF4F7" stroke-width="14"/><circle cx="50" cy="50" r="36" fill="none" stroke="#2CC08B" stroke-width="14" stroke-linecap="round" stroke-dasharray="160 226" transform="rotate(-90 50 50)"/><circle cx="50" cy="50" r="36" fill="none" stroke="#EE5A54" stroke-width="14" stroke-linecap="round" stroke-dasharray="46 340" transform="rotate(75 50 50)"/></svg>', 132, 132)],
      ['book', 156, 128, wrap('<svg viewBox="0 0 130 90" width="130" height="90"><path d="M65 22C54 14 38 10 12 10v70c26 0 42 4 53 12 11-8 27-12 53-12V10c-26 0-42 4-53 12z" fill="#DFF3F9"/><path d="M65 22v70" stroke="#8EDCEA" stroke-width="3"/><path d="M22 32h26M22 44h26M82 32h26M82 44h26" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>', 156, 128)]
    ];
    parts.forEach(function (p, i) {
      var ang = (i / parts.length) * Math.PI * 2 + 0.35;
      var d = mk(sc1, 'card soft', p[3], 'left:0;top:0;width:' + p[1] + 'px;height:' + p[2] + 'px;transform-origin:50% 50%;opacity:0');
      floaters.push({ el: d, w: p[1], h: p[2], ang: ang, ph: i * 0.7 });
    });
  })();
  var s1Core = mk(sc1, '', '', 'position:absolute;left:640px;top:360px;width:0;height:0;');
  var s1Glow = mk(s1Core, '', '', 'position:absolute;left:-90px;top:-90px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,#8EDCEA 0%,rgba(142,220,234,0) 70%);opacity:0');

  /* ================= SCENE 2 : Agent 任务轨道 ================= */
  var sc2 = $('sc2'), nodes = [], edges = [], grains = [];
  var NP = [[150, 376], [250, 344], [410, 412], [570, 366], [730, 330], [890, 404], [1050, 352], [1160, 372]];
  (function () {
    for (var i = 0; i < NP.length - 1; i++) {
      var a = NP[i], b = NP[i + 1];
      var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
      var e = mk(sc2, 'edge', '', 'left:' + a[0] + 'px;top:' + a[1] + 'px;width:' + len + 'px;transform-origin:0 50%;transform:rotate(' + ang + 'deg) scaleX(0);opacity:.9');
      edges.push({ el: e, len: len, ang: ang, a: a, b: b });
    }
    var ics = ['users', 'chart', 'book', 'search', 'quiz', 'doc'];
    for (var j = 0; j < 6; j++) {
      var p = NP[j + 1];
      var n = mk(sc2, 'node', '<div class="halo"></div><div class="nring"></div>' + ic(ics[j], 38), 'left:' + p[0] + 'px;top:' + p[1] + 'px;opacity:0');
      n.querySelector('.ico').classList.add('ico');
      nodes.push({ el: n, x: p[0], y: p[1], ring: n.querySelector('.nring'), halo: n.querySelector('.halo'), ico: n.querySelector('.ico'), tOn: 7.5 + (j + 1) / 8 * 7.0 });
    }
    for (var g = 0; g < 36; g++) grains.push(mk(sc2, 'grain', '', 'left:0;top:0;opacity:0'));
  })();

  /* ================= SCENE 3 : 生产线 ================= */
  var sc3 = $('sc3'), bars3 = [], pills3 = [], pages3 = [], lens = null, lensHL = null;
  var qcards = [], lessonBlocks = [];
  (function () {
    /* 3A 学情面板 world x 640 */
    var pA = mk(sc3, 'panel', '', 'left:410px;top:250px;width:460px;height:300px;opacity:0');
    mk(pA, '', '', 'position:absolute;left:26px;top:26px;width:120px;height:14px;border-radius:7px;background:#DFF3F9');
    mk(pA, '', '', 'position:absolute;left:26px;top:52px;width:72px;height:9px;border-radius:5px;background:#EAF4F7');
    var barHost = mk(pA, '', '', 'position:absolute;left:30px;top:96px;width:400px;height:180px');
    var hs = [.62, .74, .55, .82, .48, .38, .7, .58], hot = [2, 4, 5];
    for (var i = 0; i < 8; i++) {
      var b = mk(barHost, 'bar' + (hot.indexOf(i) >= 0 ? ' hl' : ''), '', 'left:' + (i * 50) + 'px;width:30px;height:' + (hs[i] * 180) + 'px;transform:scaleY(0)');
      bars3.push(b);
    }
    mk(pA, '', '', 'position:absolute;left:30px;top:278px;width:400px;height:3px;background:#EAF4F7;border-radius:2px');
    for (var k = 0; k < 3; k++) {
      var pl = mk(sc3, '', '<div style="width:100%;height:100%;display:flex;align-items:center;gap:9px;padding:0 14px">' +
        '<div style="width:10px;height:10px;border-radius:50%;background:#8EDCEA"></div>' +
        '<div style="height:8px;flex:1;border-radius:4px;background:#DFF3F9"></div></div>',
        'position:absolute;left:' + (430 + k * 150) + 'px;top:178px;width:132px;height:42px;border-radius:21px;background:#fff;box-shadow:0 6px 16px rgba(20,80,100,.09);opacity:0');
      pills3.push(pl);
    }
    /* 3B 课本 world x 1100 */
    var bk = mk(sc3, '', '', 'position:absolute;left:900px;top:230px;width:400px;height:280px;opacity:0;perspective:1000px');
    mk(bk, '', '', 'position:absolute;left:0;top:0;width:196px;height:280px;background:#fff;border-radius:10px 4px 4px 10px;box-shadow:0 8px 22px rgba(20,80,100,.10)');
    mk(bk, '', '', 'position:absolute;left:204px;top:0;width:196px;height:280px;background:#fff;border-radius:4px 10px 10px 4px;box-shadow:0 8px 22px rgba(20,80,100,.10)');
    mk(bk, '', '', 'position:absolute;left:194px;top:0;width:12px;height:280px;background:linear-gradient(90deg,#EAF4F7,#F7FCFD,#EAF4F7)');
    for (var q = 0; q < 4; q++) {
      var pg = mk(bk, '', '', 'position:absolute;left:206px;top:0;width:190px;height:280px;background:#fff;transform-origin:0% 50%;opacity:0;box-shadow:0 4px 12px rgba(20,80,100,.08)');
      pg.innerHTML = '<div style="padding:22px"><div style="height:11px;width:70px;background:#DFF3F9;border-radius:6px;margin-bottom:16px"></div>' +
        '<div style="height:7px;border-radius:4px;background:#EAF4F7;margin-bottom:10px"></div>'.repeat(0) +
        new Array(7).join().split(',').map(function (_, idx) { return '<div style="height:7px;border-radius:4px;background:#EAF4F7;margin-bottom:11px;width:' + (100 - (idx % 3) * 16) + '%"></div>'; }).join('') +
        '</div>';
      pages3.push(pg);
    }
    lensHL = mk(bk, '', '', 'position:absolute;left:224px;top:96px;width:150px;height:26px;border-radius:6px;background:#FFE1AB;opacity:0');
    lens = mk(sc3, '', '<svg viewBox="0 0 100 100" width="100" height="100"><circle cx="42" cy="42" r="28" fill="rgba(255,255,255,.55)" stroke="#1FA2C4" stroke-width="6"/><path d="M62 62 L88 88" stroke="#1FA2C4" stroke-width="9" stroke-linecap="round"/></svg>',
      'position:absolute;left:0;top:0;width:100px;height:100px;opacity:0');

    /* 3C 题目卡 world x 1560 */
    var layerCfg = [[560, 58, 1, '#8EDCEA'], [450, 74, 2, '#F5A623'], [336, 90, 3, '#0B7A99']];
    for (var L = 0; L < 3; L++) {
      var cfg = layerCfg[L];
      for (var c = 0; c < 8; c++) {
        var stars = '';
        for (var s = 0; s < cfg[2]; s++) stars += '<b style="background:' + cfg[3] + '"></b>';
        var qd = mk(sc3, 'qcard', '<div class="qt" style="background:' + cfg[3] + '"></div><div class="qs">' + stars + '</div>' +
          '<div style="position:absolute;left:12px;right:12px;bottom:12px;height:6px;border-radius:3px;background:#EAF4F7"></div>',
          'left:0;top:0;width:92px;height:' + cfg[0] * 0 + 'px;opacity:0;overflow:hidden');
        qd.style.height = cfg[1] + 'px';
        qcards.push({ el: qd, L: L, i: c, x: 1075 + c * 100, y: cfg[0], h: cfg[1], delay: 23.0 + L * 0.28 + c * 0.055 });
      }
    }
    /* 3D 教案 world x 1920 */
    var les = mk(sc3, 'doc', '', 'left:1740px;top:210px;width:340px;height:420px;opacity:0');
    mk(les, 'dt', '', '');
    var blocks = [
      ['left:34px;top:44px;width:150px;height:16px;border-radius:8px;background:#8EDCEA'],
      ['left:34px;top:78px;width:250px;height:9px;border-radius:5px;background:#EAF4F7'],
      ['left:34px;top:110px;width:200px;height:9px;border-radius:5px;background:#EAF4F7'],
      ['left:34px;top:150px;width:272px;height:150px;border-radius:12px;background:#F3FAFC;border:2px dashed #DCEEF4'],
      ['left:34px;top:318px;width:272px;height:72px;border-radius:12px;background:#E2F7EE']
    ];
    blocks.forEach(function (b) { lessonBlocks.push(mk(les, '', '', 'position:absolute;' + b + ';opacity:0')); });
  })();

  /* ================= SCENE 4 : 四份成果 ================= */
  var sc4 = $('sc4'), arti = [];
  (function () {
    var inner = [
      '<div style="position:absolute;left:26px;top:22px;width:80px;height:11px;border-radius:6px;background:#DFF3F9"></div>' +
      '<div style="position:absolute;left:26px;bottom:34px;display:flex;align-items:flex-end;gap:12px;height:110px">' +
      '<div style="width:26px;height:52%;background:#8EDCEA;border-radius:5px 5px 0 0"></div><div style="width:26px;height:78%;background:#8EDCEA;border-radius:5px 5px 0 0"></div>' +
      '<div style="width:26px;height:40%;background:#EE5A54;border-radius:5px 5px 0 0"></div><div style="width:26px;height:66%;background:#8EDCEA;border-radius:5px 5px 0 0"></div>' +
      '<div style="width:26px;height:88%;background:#2CC08B;border-radius:5px 5px 0 0"></div></div>' +
      '<svg style="position:absolute;left:26px;bottom:34px" viewBox="0 0 220 110" width="220" height="110"><polyline points="6,90 60,72 114,44 168,30 214,10" fill="none" stroke="#1FA2C4" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/></svg>',
      '<div style="position:absolute;left:26px;top:22px;width:80px;height:11px;border-radius:6px;background:#FFE1AB"></div>' +
      '<div style="position:absolute;left:26px;top:56px;right:26px;height:26px;border-radius:8px;background:#F3FAFC;border-left:5px solid #8EDCEA"></div>' +
      '<div style="position:absolute;left:26px;top:94px;right:26px;height:34px;border-radius:8px;background:#F3FAFC;border-left:5px solid #F5A623"></div>' +
      '<div style="position:absolute;left:26px;top:140px;right:26px;height:42px;border-radius:8px;background:#F3FAFC;border-left:5px solid #0B7A99"></div>',
      '<div style="position:absolute;left:26px;top:22px;width:80px;height:11px;border-radius:6px;background:#E2F7EE"></div>' +
      '<div style="position:absolute;left:26px;top:56px;right:26px;height:12px;border-radius:6px;background:#2CC08B;opacity:.35"></div>' +
      '<div style="position:absolute;left:26px;top:82px;right:60px;height:8px;border-radius:4px;background:#EAF4F7"></div>'.replace('>x', '>') +
      '<div style="position:absolute;left:26px;top:100px;right:90px;height:8px;border-radius:4px;background:#EAF4F7"></div>' +
      '<div style="position:absolute;left:26px;top:130px;right:26px;height:56px;border-radius:10px;background:#F3FAFC"></div>',
      '<div style="position:absolute;left:26px;top:22px;width:80px;height:11px;border-radius:6px;background:#DFF3F9"></div>' +
      '<div style="position:absolute;left:26px;top:58px;display:flex;gap:16px">' +
      '<div style="width:40px;height:40px;border-radius:50%;background:#DFF3F9;position:relative"><div style="position:absolute;left:10px;top:9px;width:20px;height:20px;border-radius:50%;background:#8EDCEA"></div><div style="position:absolute;right:-3px;top:-3px;width:14px;height:14px;border-radius:50%;background:#EE5A54;border:2px solid #fff"></div></div>' +
      '<div style="width:40px;height:40px;border-radius:50%;background:#E2F7EE;position:relative"><div style="position:absolute;left:10px;top:9px;width:20px;height:20px;border-radius:50%;background:#A7E9CE"></div><div style="position:absolute;right:-3px;top:-3px;width:14px;height:14px;border-radius:50%;background:#EE5A54;border:2px solid #fff"></div></div>' +
      '<div style="width:40px;height:40px;border-radius:50%;background:#FFE1AB;position:relative"><div style="position:absolute;left:10px;top:9px;width:20px;height:20px;border-radius:50%;background:#F5A623"></div></div></div>' +
      '<div style="position:absolute;left:26px;top:126px;right:26px;height:8px;border-radius:4px;background:#EAF4F7"></div>' +
      '<div style="position:absolute;left:26px;top:146px;right:70px;height:8px;border-radius:4px;background:#EAF4F7"></div>'
    ];
    var accents = ['#1FA2C4', '#F5A623', '#2CC08B', '#8EDCEA'];
    var pos = [[400, 250], [880, 250], [400, 490], [880, 490]];
    for (var i = 0; i < 4; i++) {
      var a = mk(sc4, 'panel', '<div style="position:absolute;left:0;top:0;width:100%;height:6px;background:' + accents[i] + '"></div>' + inner[i],
        'left:0;top:0;width:300px;height:210px;margin:-105px 0 0 -150px;opacity:0');
      arti.push({ el: a, x: pos[i][0], y: pos[i][1] });
    }
    window.__artiMerged = mk(sc4, 'panel',
      '<div style="position:absolute;left:0;top:0;width:100%;height:6px;background:linear-gradient(90deg,#1FA2C4,#8EDCEA)"></div>' +
      '<div style="position:absolute;left:26px;top:24px;width:96px;height:12px;border-radius:6px;background:#DFF3F9"></div>' +
      '<div style="position:absolute;left:26px;top:56px;display:flex;gap:14px">' +
      '<div style="width:36px;height:36px;border-radius:50%;background:#DFF3F9;position:relative"><div style="position:absolute;left:9px;top:8px;width:18px;height:18px;border-radius:50%;background:#8EDCEA"></div><div style="position:absolute;right:-3px;top:-2px;width:13px;height:13px;border-radius:50%;background:#EE5A54;border:2px solid #fff"></div></div>' +
      '<div style="width:36px;height:36px;border-radius:50%;background:#E2F7EE;position:relative"><div style="position:absolute;left:9px;top:8px;width:18px;height:18px;border-radius:50%;background:#A7E9CE"></div><div style="position:absolute;right:-3px;top:-2px;width:13px;height:13px;border-radius:50%;background:#EE5A54;border:2px solid #fff"></div></div>' +
      '<div style="width:36px;height:36px;border-radius:50%;background:#FFE1AB;position:relative"><div style="position:absolute;left:9px;top:8px;width:18px;height:18px;border-radius:50%;background:#F5A623"></div></div></div>' +
      '<div style="position:absolute;left:26px;bottom:30px;display:flex;align-items:flex-end;gap:10px;height:88px">' +
      '<div style="width:20px;height:44%;background:#8EDCEA;border-radius:4px 4px 0 0"></div><div style="width:20px;height:70%;background:#8EDCEA;border-radius:4px 4px 0 0"></div>' +
      '<div style="width:20px;height:36%;background:#EE5A54;border-radius:4px 4px 0 0"></div><div style="width:20px;height:60%;background:#8EDCEA;border-radius:4px 4px 0 0"></div>' +
      '<div style="width:20px;height:84%;background:#2CC08B;border-radius:4px 4px 0 0"></div></div>',
      'left:0;top:0;width:300px;height:210px;margin:-105px 0 0 -150px;opacity:0');
    window.__artiRef = mk(sc4, '', '<svg viewBox="0 0 24 24" width="26" height="26"><rect x="3" y="4" width="18" height="16" rx="3" fill="#fff" stroke="#2CC08B" stroke-width="2.4"/><path d="M7.5 12.6l2.6 2.6L16.4 8.6" fill="none" stroke="#2CC08B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      'left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;opacity:0');
    window.__artiLink = mk(sc4, '', '', 'left:0;top:0;height:3px;border-radius:2px;background:#2CC08B;transform-origin:0 50%;opacity:0');
  })();
  var artiMerged = window.__artiMerged, artiRef = window.__artiRef, artiLink = window.__artiLink;

  /* ================= SCENE 5 : 真实课堂 ================= */
  var sc5 = $('sc5'), cr = null, papers = [], tStars = [];
  (function () {
    function starPath(cx, cy, r, fill) {
      var p = [];
      for (var i = 0; i < 10; i++) {
        var rr = i % 2 ? r * 0.44 : r, a = -Math.PI / 2 + i * Math.PI / 5;
        p.push((cx + Math.cos(a) * rr).toFixed(1) + ',' + (cy + Math.sin(a) * rr).toFixed(1));
      }
      return '<polygon points="' + p.join(' ') + '" fill="' + fill + '"/>';
    }
    var svg = '<svg viewBox="0 0 1280 720" width="1280" height="720" style="position:absolute;left:0;top:0">' +
      '<rect width="1280" height="720" fill="#F4FBFC"/>' +
      '<path d="M0 566 H1280 V720 H0 Z" fill="#E8F5F9"/>' +
      /* window */
      '<rect x="902" y="86" width="268" height="176" rx="18" fill="#DCF2FA" stroke="#CBE7F0" stroke-width="7"/>' +
      '<line x1="1036" y1="86" x2="1036" y2="262" stroke="#CBE7F0" stroke-width="7"/>' +
      '<path d="M902 262 L1170 86 L1170 132 L1000 262 Z" fill="#FFF3D4" opacity=".65"/>' +
      /* board */
      '<rect x="120" y="96" width="546" height="238" rx="16" fill="#E4F1EB" stroke="#C6DFD4" stroke-width="8"/>' +
      '<rect x="150" y="132" width="150" height="12" rx="6" fill="#fff" opacity=".85"/>' +
      '<rect x="150" y="166" width="300" height="10" rx="5" fill="#fff" opacity=".6"/>' +
      '<rect x="150" y="196" width="230" height="10" rx="5" fill="#fff" opacity=".6"/>' +
      '<rect x="150" y="240" width="180" height="10" rx="5" fill="#fff" opacity=".45"/>' +
      '<rect x="356" y="248" width="76" height="60" rx="10" fill="none" stroke="#fff" stroke-width="7" opacity=".7"/>' +
      /* desks + students */
      ['#8EDCEA', '#A7E9CE', '#FFD79A'].map(function (col, i) {
        var x = [250, 640, 1030][i];
        return '<g>' +
          '<rect x="' + (x - 30) + '" y="474" width="60" height="52" rx="24" fill="' + col + '"/>' +
          '<circle cx="' + x + '" cy="452" r="27" fill="#FFE1C4"/>' +
          '<path d="M' + (x - 30) + ' 452 a30 30 0 0 1 60 0 z" fill="#4A3A32" opacity=".85"/>' +
          '<rect x="' + (x - 92) + '" y="516" width="184" height="17" rx="8" fill="#F7E7CD"/>' +
          '<rect x="' + (x - 78) + '" y="533" width="11" height="76" rx="5" fill="#DFEDF2"/>' +
          '<rect x="' + (x + 67) + '" y="533" width="11" height="76" rx="5" fill="#DFEDF2"/>' +
          '</g>';
      }).join('') +
      /* teacher */
      '<g><rect x="1116" y="452" width="64" height="112" rx="28" fill="#1FA2C4"/>' +
      '<circle cx="1148" cy="424" r="29" fill="#FFE1C4"/>' +
      '<path d="M1118 424 a30 30 0 0 1 60 0 z" fill="#3A2E28" opacity=".85"/>' +
      '<rect x="1196" y="452" width="66" height="48" rx="8" fill="#fff" stroke="#CBE7F0" stroke-width="5"/>' +
      '<rect x="1205" y="461" width="48" height="30" rx="5" fill="#DCF2FA"/></g>' +
      '</svg>';
    cr = mk(sc5, '', svg, 'position:absolute;inset:0;opacity:0;transform-origin:640px 380px');
    /* papers on desks */
    [250, 640, 1030].forEach(function (x, i) {
      var p = mk(sc5, '', '<div style="width:100%;height:100%;background:#fff;border-radius:4px;box-shadow:0 4px 10px rgba(20,80,100,.13);position:relative;overflow:hidden">' +
        '<div style="position:absolute;left:0;top:0;width:100%;height:7px;background:' + ['#8EDCEA', '#F5A623', '#0B7A99'][i] + '"></div>' +
        '<div style="position:absolute;left:9px;top:17px;right:9px;height:5px;border-radius:3px;background:#EAF4F7"></div>' +
        '<div style="position:absolute;left:9px;top:28px;right:20px;height:5px;border-radius:3px;background:#EAF4F7"></div>' +
        '<div style="position:absolute;left:9px;top:39px;right:26px;height:5px;border-radius:3px;background:#EAF4F7"></div>' +
        '<svg class="pstars" style="position:absolute;left:0;top:0;width:100%;height:100%">' +
        [0, 1, 2].slice(0, i + 1).map(function (s) { return starPath(20 + s * 16, 62, 6, '#F5A623'); }).join('') +
        '</svg></div>',
        'position:absolute;left:' + (x - 40) + 'px;top:472px;width:80px;height:56px;opacity:0;transform-origin:50% 50%');
      papers.push(p);
    });
    /* flying sheet */
    window.__fly = mk(sc5, '', '<div style="width:100%;height:100%;background:#fff;border-radius:10px;box-shadow:0 20px 50px rgba(20,80,100,.18);position:relative;overflow:hidden">' +
      '<div style="position:absolute;left:0;top:0;width:100%;height:14px;background:#1FA2C4"></div>' +
      '<div style="position:absolute;left:26px;top:44px;right:26px;height:12px;border-radius:6px;background:#EAF4F7"></div>' +
      '<div style="position:absolute;left:26px;top:70px;right:70px;height:12px;border-radius:6px;background:#EAF4F7"></div>' +
      '<div style="position:absolute;left:26px;top:110px;right:26px;height:96px;border-radius:10px;background:#F3FAFC"></div>' +
      '<div style="position:absolute;left:26px;top:222px;right:26px;height:96px;border-radius:10px;background:#F3FAFC"></div></div>',
      'position:absolute;left:0;top:0;width:230px;height:330px;margin:-165px 0 0 -115px;opacity:0;transform-origin:50% 50%');
    /* tablet screen pop */
    window.__tab = mk(sc5, '', '<svg viewBox="0 0 48 30" width="48" height="30">' +
      '<circle cx="11" cy="11" r="6" fill="#8EDCEA"/><circle cx="24" cy="11" r="6" fill="#A7E9CE"/><circle cx="37" cy="11" r="6" fill="#FFD79A"/>' +
      '<polyline points="6,26 16,22 26,24 42,13" fill="none" stroke="#2CC08B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      'position:absolute;left:1205px;top:461px;width:48px;height:30px;opacity:0');
  })();
  var fly = window.__fly, tab = window.__tab;

  /* ================= SCENE 6 : Skill ================= */
  var sc6 = $('sc6'), mods = [], shelf = null, slots = [], hero2 = null, flowNodes = [], flowOut = [];
  (function () {
    var ics = ['users', 'chart', 'book', 'search', 'quiz', 'doc'];
    var from = [[220, 180], [1050, 160], [200, 560], [1080, 560], [640, 120], [640, 620]];
    for (var i = 0; i < 6; i++) {
      var m = mk(sc6, '', ic(ics[i], 34, '#1FA2C4'),
        'position:absolute;left:0;top:0;width:70px;height:70px;margin:-35px 0 0 -35px;border-radius:18px;background:#fff;box-shadow:0 8px 20px rgba(20,80,100,.12);display:flex;align-items:center;justify-content:center;opacity:0');
      mods.push({ el: m, fx: from[i][0], fy: from[i][1] });
    }
    shelf = mk(sc6, 'shelf', '', 'left:760px;top:220px;width:400px;height:300px;opacity:0');
    for (var r = 0; r < 2; r++) for (var c = 0; c < 3; c++) {
      slots.push(mk(shelf, 'slot', '', 'left:' + (26 + c * 120) + 'px;top:' + (26 + r * 130) + 'px;width:100px;height:106px'));
    }
    /* two pre-existing dim skills */
    mk(shelf, '', '', 'position:absolute;left:36px;top:36px;width:80px;height:86px;border-radius:12px;background:#E7F4F8');
    mk(shelf, '', '', 'position:absolute;left:156px;top:36px;width:80px;height:86px;border-radius:12px;background:#E7F4F8');

    /* hero2 : 新简报 */
    hero2 = hero.cloneNode(true); hero2.id = 'hero2'; hero2.style.opacity = 0;
    hero2.querySelector('.hc-title').textContent = '高一（3）班';
    camera.appendChild(hero2);

    for (var f = 0; f < 6; f++) {
      var fn = mk(sc6, '', ic(ics[f], 26),
        'position:absolute;left:0;top:0;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:15px;background:#fff;box-shadow:0 6px 16px rgba(20,80,100,.12);display:flex;align-items:center;justify-content:center;opacity:0');
      fn.querySelector('.ico').style.color = '#B9D3DC';
      flowNodes.push(fn);
    }
    var fo = mk(sc6, 'panel', '<div style="position:absolute;left:0;top:0;width:100%;height:6px;background:linear-gradient(90deg,#2CC08B,#A7E9CE)"></div>' +
      '<div style="position:absolute;left:20px;top:22px;width:70px;height:10px;border-radius:5px;background:#E2F7EE"></div>' +
      '<div style="position:absolute;left:20px;top:48px;right:20px;height:8px;border-radius:4px;background:#EAF4F7"></div>' +
      '<div style="position:absolute;left:20px;top:66px;right:52px;height:8px;border-radius:4px;background:#EAF4F7"></div>' +
      '<div style="position:absolute;left:20px;top:92px;right:20px;height:34px;border-radius:8px;background:#F3FAFC"></div>',
      'left:0;top:0;width:200px;height:150px;margin:-75px 0 0 -100px;opacity:0');
    flowOut.push(fo);
    var fchk = mk(sc6, '', '<svg viewBox="0 0 44 44" width="44" height="44"><circle cx="22" cy="22" r="20" fill="#2CC08B"/><path d="M13 22.6l6 6L31 15.6" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      'left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;opacity:0');
    flowOut.push(fchk);
  })();
  var skEdge = skill.querySelector('.sk-edge');
  (function () {
    var host = $('skIco'), ics = ['users', 'chart', 'book', 'search', 'quiz', 'doc'];
    ics.forEach(function (n) { host.innerHTML += '<div>' + ic(n, 22, '#2CC08B') + '</div>'; });
  })();

  /* ================= SCENE 7 : 汇聚 ================= */
  var sc7 = $('sc7'), swarm = [];
  (function () {
    var cols = ['#1FA2C4', '#2CC08B', '#F5A623', '#8EDCEA', '#A7E9CE', '#FFFFFF', '#0B7A99', '#FFD79A'];
    for (var i = 0; i < 40; i++) {
      var a = (i / 40) * Math.PI * 2 + 0.4, r = 300 + (i % 6) * 105;
      var w = 84 + (i % 4) * 26, h = 104 + (i % 5) * 24;
      var face = '';
      if (i % 3 === 0) face = '<div style="position:absolute;left:0;top:0;width:100%;height:9px;border-radius:6px 6px 0 0;background:rgba(15,47,59,.22)"></div>' +
        '<div style="position:absolute;left:12px;top:24px;right:30%;height:7px;border-radius:4px;background:rgba(15,47,59,.14)"></div>' +
        '<div style="position:absolute;left:12px;top:38px;right:45%;height:7px;border-radius:4px;background:rgba(15,47,59,.10)"></div>';
      var d = mk(sc7, '', '<div style="width:100%;height:100%;border-radius:14px;background:' + cols[i % 8] + ';box-shadow:0 10px 24px rgba(20,80,100,.14);position:relative;overflow:hidden">' + face + '</div>',
        'position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px;transform-origin:50% 50%;opacity:0');
      swarm.push({ el: d, a: a, r: r, ph: i * 0.31 });
    }
  })();

  /* ================= helpers ================= */
  function sceneOn(sc, t, a, b) {
    var on = t > a - 0.75 && t < b + 0.75;
    sc.style.display = on ? 'block' : 'none';
    if (!on) return 0;
    var o = Math.min(1, seg(t, a - 0.75, a - 0.05)) * (1 - seg(t, b - 0.05, b + 0.7));
    sc.style.opacity = o.toFixed(3);
    return o;
  }

  /* ---------- path along nodes ---------- */
  function pathAt(u) {
    var n = NP.length - 1, f = u * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
    k = sm(k);
    return [lerp(NP[i][0], NP[i + 1][0], k), lerp(NP[i][1], NP[i + 1][1], k)];
  }

  /* ================= RENDER ================= */
  function render(t) {
    /* ---- camera ---- */
    var cx = 0, cy = 0, cs = 1;
    if (t < 15) { cx = 0; cs = lerp(1, 1.02, sm(seg(t, 7, 15))); }
    else if (t < 19) { cx = lerp(0, -60, sm(seg(t, 15, 19))); }
    else if (t < 23) { cx = lerp(-60, -460, sm(seg(t, 19, 23))); }
    else if (t < 27) { cx = lerp(-460, -920, sm(seg(t, 23, 27))); }
    else if (t < 30) { cx = lerp(-920, -1280, sm(seg(t, 27, 30))); }
    else if (t < 31.4) { cx = lerp(-1280, 0, Eio(seg(t, 30, 31.4))); cs = 1.02; }
    else if (t < 45) { cx = 0; cs = 1 + 0.06 * Math.sin((t - 31.4) * 0.8); }
    else if (t < 47) { cx = lerp(0, -110, sm(seg(t, 45, 47))); cs = lerp(1, 1.09, sm(seg(t, 45, 47))); }
    else if (t < 49) { cx = lerp(-110, 0, sm(seg(t, 47, 49))); cs = lerp(1.09, 1, sm(seg(t, 47, 49))); }
    else if (t < 56) { cx = 0; cs = 1; }
    else { var u7 = sm(seg(t, 56, 58.1)); cs = lerp(1, 0.5, u7); cy = lerp(0, 26, u7); }
    cam.x = cx; cam.y = cy; cam.s = cs;
    camera.style.transform = 'translate(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px) scale(' + cs.toFixed(4) + ')';

    /* ---- background ---- */
    var gb = 0;
    if (t > 7) gb = Math.min(1, seg(t, 7.2, 9));
    if (t > 38) gb = Math.min(gb, 1 - seg(t, 39.4, 41.2));
    if (t > 48) gb = Math.max(gb, seg(t, 48.6, 50.5));
    if (t > 56) gb = Math.max(gb, 1);
    gridbg.style.opacity = (gb * (t > 56 ? 0.9 : 0.55)).toFixed(3);
    gridbg.style.transform = 'scale(' + (1 + (t > 56 ? sm(seg(t, 56, 58)) * 0.7 : 0)) + ')';
    blobs.forEach(function (b) {
      var o = b.op * (t < 7 ? 1 : 0.55) * (1 - Math.max(0, seg(t, 39.6, 41.4)) * (t < 49 ? 1 : 0.4));
      if (t > 56) o = b.op * 0.8;
      var dx = Math.sin(t * 0.32 + b.ph) * 18, dy = Math.cos(t * 0.27 + b.ph * 1.4) * 14;
      st(b.el, b.x - b.r / 2 + dx, b.y - b.r / 2 + dy, 1, 0, o);
    });

    /* ---- scene visibility ---- */
    var o1 = sceneOn(sc1, t, 0, 7.6), o2 = sceneOn(sc2, t, 7.0, 15.2),
      o3 = sceneOn(sc3, t, 14.6, 30.4), o4 = sceneOn(sc4, t, 30.0, 40.4),
      o5 = sceneOn(sc5, t, 39.6, 49.4), o6 = sceneOn(sc6, t, 48.8, 58.4),
      o7 = sceneOn(sc7, t, 55.6, 60.2);

    /* ================= SCENE 1 ================= */
    if (o1 > 0) {
      var gather = sm(seg(t, 0.2, 2.5));
      var suck = sm(seg(t, 2.5, 3.15));
      floaters.forEach(function (f, i) {
        var r = lerp(560, 268, gather), r2 = lerp(268, 96, suck);
        var rr = suck > 0 ? r2 : r;
        var ang = f.ang + (1 - gather) * 0.5;
        var x = 640 + Math.cos(ang) * rr - f.w / 2 + Math.sin(t * 0.9 + f.ph) * 7;
        var y = 360 + Math.sin(ang) * rr * 0.72 - f.h / 2 + Math.cos(t * 0.8 + f.ph) * 6;
        var op = Math.min(1, seg(t, 0.1, 0.9) + 0.0) * (1 - suck * 0.85);
        var k = lerp(0.72, 1, gather) * (1 - suck * 0.45);
        var rot = lerp((i % 2 ? 1 : -1) * 9, 0, gather) + Math.sin(t * 0.7 + f.ph) * 1.6;
        st(f.el, x, y, k, rot, op * o1);
      });
      var gp = seg(t, 2.4, 3.3);
      s1Glow.style.opacity = (Math.sin(gp * Math.PI) * 0.9 * o1).toFixed(3);
      s1Glow.style.transform = 'scale(' + (0.4 + gp * 2.2) + ')';
    }

    /* ================= HERO (global) ================= */
    var hx = 640, hy = 360, hk = 0, hrot = 0, hop = 0, halo = 0, edge = 0, shine = 0;
    if (t < 2.95) { hop = 0; }
    else if (t < 4.6) {
      var g = Eb(seg(t, 2.95, 4.6));
      hk = lerp(0.16, 1, g); hop = Math.min(1, seg(t, 2.95, 3.35));
      hy = lerp(392, 360, g);
    } else if (t < 7.6) {
      hk = 1; hop = 1;
      var lit = seg(t, 6.1, 6.45);
      hk = 1 + Math.sin(lit * Math.PI) * 0.055;
      hy = 360 + Math.sin(t * 1.9) * 5.5 - lit * 8;
      hrot = Math.sin(t * 1.25) * 1.1;
      edge = seg(t, 6.1, 6.55);
      halo = seg(t, 6.1, 6.9);
      shine = seg(t, 6.05, 6.5) - seg(t, 6.5, 6.9);
      var mv = sm(seg(t, 6.75, 7.6));
      hx = lerp(640, 300, mv); hy = lerp(hy, 344, mv); hk = lerp(hk, 0.8, mv);
    } else if (t < 14.9) {
      var u = seg(t, 7.35, 14.6); var p = pathAt(u);
      hx = p[0]; hy = p[1]; hk = 0.56; hop = 1;
      hrot = Math.sin(t * 2.6) * 2.2;
      hy += Math.sin(t * 3.4) * 3;
      edge = 1; halo = 0.25 + 0.2 * Math.sin(t * 4);
    } else if (t < 30.6) {
      hop = 1; hk = 0.44;
      hx = s2wx(178); hy = s2wy(142);
      hrot = Math.sin(t * 1.6) * 1.4;
      edge = 1; halo = 0.2 + 0.18 * Math.sin(t * 3.2);
      hk = 0.44 * (1 + 0.05 * Math.sin(t * 5));
    } else if (t < 32.2) {
      var m4 = Eio(seg(t, 30.7, 32.2));
      hx = lerp(s2wx(178), 640, m4); hy = lerp(s2wy(142), 360, m4); hk = lerp(0.44, 0.92, m4);
      hop = 1; edge = 1; halo = 0.3;
      hrot = Math.sin(t * 1.6) * 1.4 * (1 - m4);
    } else if (t < 33.6) {
      var sp = seg(t, 32.2, 33.4);
      hx = 640; hy = 360; hk = lerp(0.92, 1.5, Eo(sp)); hop = 1 - seg(t, 32.6, 33.6);
      halo = sp; edge = 1;
    } else if (t < 46.6) { hop = 0; }
    else {
      var d5 = Eio(seg(t, 46.6, 47.9));
      hx = s2wx(640); hy = s2wy(lerp(200, 340, d5)); hk = lerp(0.7, 1.0, d5); hop = seg(t, 46.6, 47.2);
      edge = 1; halo = 0;
      var fin = seg(t, 47.3, 48.6);
      halo = Math.max(halo, Math.sin(fin * Math.PI) * 0.9);
      if (t > 48.8) hop = (1 - seg(t, 48.8, 49.5));
    }
    setHero(hx, hy, hk, hrot, hop);
    hcEdge.style.opacity = edge.toFixed(3);
    hcEdge.style.background = 'conic-gradient(from ' + (t * 220 % 360).toFixed(0) + 'deg, transparent 0deg, #1FA2C4 45deg, #8EDCEA 95deg, transparent 165deg, transparent 360deg)';
    hcHalo.style.opacity = (halo * 0.55).toFixed(3);
    hcHalo.style.transform = 'scale(' + (1 + halo * 0.5) + ')';
    hcShine.style.opacity = (shine * 0.85).toFixed(3);
    hcShine.style.transform = 'translateX(' + (shine * 260 - 60) + 'px)';

    /* hero 状态：红 → 绿 */
    var green = seg(t, 47.4, 48.4);
    trDown.style.opacity = (1 - green).toFixed(3);
    trUp.style.opacity = green.toFixed(3);
    trUpDot.style.opacity = green.toFixed(3);
    hcDot.className = 'hc-dot' + (green > 0.5 ? ' ok' : '');
    hcTick.style.opacity = green.toFixed(3);
    /* 数据与产品物料同源（v0.9.3 P1-C①）：高一（3）班「函数单调性」掌握率 61% → 习题课干预后 +9pp */
    hcDelta.textContent = green > 0.5 ? '70%' : '61%';
    hcDelta.style.color = green > 0.5 ? '#2CC08B' : '#EE5A54';
    hero.querySelector('.hc-accent').style.background = green > 0.5
      ? 'linear-gradient(90deg,#2CC08B,#A7E9CE)' : 'linear-gradient(90deg,#1FA2C4,#8EDCEA)';

    /* cursor */
    if (t > 5.2 && t < 6.6) {
      var cm = Eio(seg(t, 5.2, 5.95));
      var ccx = lerp(940, 646, cm), ccy = lerp(566, 372, cm);
      var clk = seg(t, 6.0, 6.12) - seg(t, 6.12, 6.3);
      cursor.style.opacity = (1 - seg(t, 6.45, 6.7)).toFixed(3);
      cursor.style.transform = 'translate(' + ccx + 'px,' + ccy + 'px) scale(' + (1 - clk * 0.14) + ')';
      var rp = seg(t, 6.0, 6.75);
      cursorRipple.style.opacity = ((1 - rp) * 0.9).toFixed(3);
      cursorRipple.style.transform = 'scale(' + (0.3 + rp * 2.6) + ')';
    } else if (t > 33.6 && t < 36.2) {
      var sw = sm(seg(t, 33.7, 35.7));
      cursor.style.opacity = (Math.min(seg(t, 33.6, 33.9), 1 - seg(t, 35.9, 36.2))).toFixed(3);
      cursor.style.transform = 'translate(' + lerp(430, 860, sw) + 'px,' + (520 + Math.sin(sw * Math.PI) * -18) + 'px) scale(1)';
      cursorRipple.style.opacity = 0;
    } else if (t > 37.2 && t < 38.4) {
      var dr = Eio(seg(t, 37.2, 38.2));
      cursor.style.opacity = (1 - seg(t, 38.2, 38.4)).toFixed(3);
      cursor.style.transform = 'translate(' + lerp(880, 404, dr) + 'px,' + lerp(250, 484, dr) + 'px) scale(' + (1 - 0.09 * Math.sin(dr * Math.PI)) + ')';
      cursorRipple.style.opacity = 0;
    } else { cursor.style.opacity = 0; cursorRipple.style.opacity = 0; }

    /* ================= SCENE 2 ================= */
    if (o2 > 0) {
      var railU = seg(t, 7.15, 14.6);
      edges.forEach(function (e, i) {
        var a = i / (edges.length), b = (i + 1) / (edges.length);
        var g = clamp01((railU - a) / (b - a));
        e.el.style.transform = 'rotate(' + e.ang + 'deg) scaleX(' + (Eo(g)).toFixed(3) + ')';
        e.el.style.background = g > 0.98 ? 'linear-gradient(90deg,#8EDCEA,#8EDCEA)' : 'linear-gradient(90deg,#DFF3F9,#C9EAF3)';
        e.el.style.opacity = (0.95 * Math.min(1, seg(t, 7.0, 7.6))).toFixed(3);
      });
      nodes.forEach(function (n, i) {
        var on = seg(t, n.tOn, n.tOn + 0.45);
        var app = Math.min(1, seg(t, 7.0 + i * 0.09, 7.5 + i * 0.09));
        var pulse = Math.sin(clamp01(on) * Math.PI);
        n.el.style.opacity = (app * o2).toFixed(3);
        n.el.style.transform = 'scale(' + (0.8 + app * 0.2 + pulse * 0.22) + ')';
        n.ring.style.opacity = on.toFixed(3);
        n.ring.style.transform = 'scale(' + (0.7 + on * 0.3) + ')';
        n.halo.style.opacity = (pulse * 0.32).toFixed(3);
        n.ico.style.color = on > 0.5 ? '#1FA2C4' : '#9FB9C4';
      });
      /* 数据颗粒飞入卡片 */
      grains.forEach(function (g, i) {
        var ni = i % 6, gi = Math.floor(i / 6);
        var t0 = nodes[ni].tOn + gi * 0.07;
        var u = seg(t, t0, t0 + 0.62);
        if (u <= 0 || u >= 1) { g.style.opacity = 0; return; }
        var n = nodes[ni];
        var sx = n.x + (i % 3 - 1) * 16, sy = n.y + (gi % 3 - 1) * 14;
        var e = Eio(u);
        var gx = lerp(sx, hx, e) + Math.sin(u * 6 + i) * 12 * (1 - e);
        var gy = lerp(sy, hy, e) + Math.cos(u * 5 + i) * 12 * (1 - e);
        g.style.background = ['#1FA2C4', '#8EDCEA', '#2CC08B', '#F5A623'][i % 4];
        st(g, gx, gy, 1 - e * 0.55, 0, (1 - Ee(u)) * 0.95 * o2);
      });
    }

    /* ================= SCENE 3 ================= */
    if (o3 > 0) {
      /* 3A */
      var pAel = sc3.children[0];
      pAel.style.opacity = (Math.min(seg(t, 15.0, 15.7), 1 - seg(t, 18.6, 19.4)) * o3).toFixed(3);
      pAel.style.transform = 'translate(' + (lerp(60, 0, Eo(seg(t, 15.0, 15.8)))) + 'px,0)';
      bars3.forEach(function (b, i) {
        var u = seg(t, 15.9 + i * 0.07, 16.5 + i * 0.07);
        b.style.transform = 'scaleY(' + Eo(u).toFixed(3) + ')';
      });
      pills3.forEach(function (p, i) {
        var u = Eo(seg(t, 16.6 + i * 0.12, 17.2 + i * 0.12));
        var fo = 1 - seg(t, 18.6, 19.3);
        p.style.opacity = (u * fo * o3).toFixed(3);
        p.style.transform = 'translateY(' + ((1 - u) * 18) + 'px) scale(' + (0.9 + u * 0.1) + ')';
        var dot = p.firstElementChild.firstElementChild;
        dot.style.background = (i === 1 && t > 17.6) ? '#EE5A54' : '#8EDCEA';
        if (i === 1 && t > 17.6) {
          var fl = 0.5 + 0.5 * Math.sin(t * 9);
          dot.style.background = fl > 0.5 ? '#EE5A54' : '#FF9A95';
        }
      });
      /* 3B 课本 */
      var bk = sc3.children[4];
      bk.style.opacity = (Math.min(seg(t, 19.2, 19.9), 1 - seg(t, 22.6, 23.4)) * o3).toFixed(3);
      pages3.forEach(function (pg, i) {
        var u = seg(t, 19.9 + i * 0.42, 20.3 + i * 0.42);
        var hold = seg(t, 20.3 + i * 0.42, 21.9);
        pg.style.opacity = (i === 0 ? 1 : Math.min(1, u)).toFixed(3);
        pg.style.transform = 'rotateY(' + ((1 - Eio(u)) * -150) + 'deg)';
        pg.style.display = u > 0 || i === 0 ? 'block' : 'none';
      });
      lensHL.style.opacity = (Math.min(seg(t, 21.3, 21.7), 1 - seg(t, 22.4, 23.0)) * 0.95).toFixed(3);
      var lu = seg(t, 20.6, 22.2);
      var lx = lerp(1086, 1200, sm(lu)), ly = 300 + Math.sin(lu * 3.1) * 34;
      lens.style.opacity = (Math.min(seg(t, 20.5, 20.9), 1 - seg(t, 22.3, 22.8)) * o3).toFixed(3);
      lens.style.transform = 'translate(' + lx + 'px,' + ly + 'px) scale(' + (0.9 + 0.12 * Math.sin(t * 6)) + ')';
      /* 3C 题目卡 */
      qcards.forEach(function (q) {
        var u = seg(t, q.delay, q.delay + 0.55);
        if (t < q.delay - 0.05) { q.el.style.opacity = 0; return; }
        var e = Eb(u);
        var sx = lerp(2050, q.x, sm(u)), sy = lerp(180 + (q.i % 4) * 60, q.y, sm(u));
        var op = Math.min(1, seg(t, q.delay, q.delay + 0.2)) * (1 - seg(t, 27.4, 28.2));
        q.el.style.transform = 'translate(' + sx + 'px,' + sy + 'px) rotate(' + ((1 - u) * 22) + 'deg) scale(' + (0.6 + 0.4 * e) + ')';
        q.el.style.opacity = (op * o3).toFixed(3);
      });
      /* 3D 教案 */
      var les = sc3.children[sc3.children.length - 1];
      les.style.opacity = (Math.min(seg(t, 27.0, 27.7), 1) * o3).toFixed(3);
      les.style.transform = 'translate(' + (lerp(90, 0, Eo(seg(t, 27.0, 27.8)))) + 'px,0)';
      lessonBlocks.forEach(function (b, i) {
        var u = Eo(seg(t, 27.7 + i * 0.24, 28.2 + i * 0.24));
        b.style.opacity = (u * o3).toFixed(3);
        b.style.transform = 'translateY(' + ((1 - u) * 14) + 'px)';
      });
    }

    /* ================= SCENE 4 ================= */
    if (o4 > 0) {
      var exp = Eo(seg(t, 32.3, 33.5));
      var slide = sm(seg(t, 33.8, 35.6));
      var offX = Math.sin(slide * Math.PI) * -110;
      arti.forEach(function (a, i) {
        var x = lerp(640, a.x, exp) + offX, y = lerp(360, a.y, exp);
        var k = lerp(0.35, 1, exp), rot = lerp((i % 2 ? 1 : -1) * 14, 0, exp);
        if (t > 35.4) {
          if (i === 0 || i === 3) {
            var mg = Eio(seg(t, 35.5, 37.1));
            x = lerp(a.x, 640, mg); y = lerp(a.y, 380, mg);
            k = lerp(1, 0.86, mg); rot = lerp(0, (i === 0 ? -3 : 3), mg);
            if (t > 36.9) { k *= (1 - seg(t, 36.9, 37.3)); }
          } else if (i === 2) {
            var fz = seg(t, 37.3, 38.1);
            k = 1 + fz * 0.06; y = a.y - fz * 6;
          }
        }
        if (t > 35.4 && (i === 0 || i === 3) && t > 37.2) { a.el.style.opacity = 0; return; }
        if (i === 1 && t > 37.3) return; /* 交给下方拖入逻辑 */
        a.el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ') rotate(' + rot + 'deg)';
        a.el.style.opacity = (Math.min(seg(t, 32.3, 33.0), 1) * o4).toFixed(3);
      });
      /* 合并结果 */
      var mo = 0;
      if (t > 36.6) {
        mo = Math.min(seg(t, 36.9, 37.3), 1 - seg(t, 39.5, 40.2));
        artiMerged.style.opacity = (mo * o4).toFixed(3);
        var mz = Eo(seg(t, 36.9, 37.5));
        artiMerged.style.transform = 'translate(640px,380px) scale(' + (0.9 + mz * 0.1) + ')';
      } else artiMerged.style.opacity = 0;
      /* 分层练习被拖入教案 → 吸附为引用 */
      if (t > 37.3) {
        var fu = Eio(seg(t, 37.35, 38.05));
        var a1 = arti[1].el;
        a1.style.transform = 'translate(' + lerp(880, 404, fu) + 'px,' + lerp(250, 484, fu) + 'px) scale(' + lerp(1, 0.58, fu) + ') rotate(' + (fu * -4) + 'deg)';
        a1.style.opacity = ((1 - seg(t, 38.0, 38.45)) * o4).toFixed(3);
        var ro = Math.min(Eo(seg(t, 38.0, 38.45)), 1 - seg(t, 39.6, 40.3));
        artiRef.style.opacity = (ro * o4).toFixed(3);
        artiRef.style.transform = 'translate(524px,392px) scale(' + Eo(seg(t, 38.0, 38.5)) + ')';
        artiLink.style.opacity = (ro * 0.85 * o4).toFixed(3);
        artiLink.style.width = '58px';
        artiLink.style.transform = 'translate(470px,404px) rotate(-9deg) scaleX(' + Eo(seg(t, 38.1, 38.6)) + ')';
        var bounceK = 1 + 0.045 * Math.sin(seg(t, 38.0, 38.9) * Math.PI);
        arti[2].el.style.transform = 'translate(400px,' + (490) + 'px) scale(' + bounceK + ')';
      } else { artiRef.style.opacity = 0; artiLink.style.opacity = 0; }
    }

    /* ================= SCENE 5 ================= */
    if (o5 > 0) {
      cr.style.opacity = (Math.min(seg(t, 39.9, 41.3), 1 - seg(t, 46.4, 47.4) * 0.55) * o5).toFixed(3);
      cr.style.transform = 'scale(' + lerp(1.06, 1.0, sm(seg(t, 39.9, 42.5))) + ')';
      /* 飞出的练习纸 */
      var fu2 = seg(t, 40.6, 41.7);
      fly.style.opacity = ((fu2 > 0 ? Math.sin(Math.min(1, fu2) * Math.PI) : 0) * o5).toFixed(3);
      fly.style.transform = 'translate(640px,400px) scale(' + lerp(0.8, 2.3, Eo(fu2)) + ') rotate(' + (fu2 * 8) + 'deg)';
      /* 落到课桌 */
      papers.forEach(function (p, i) {
        var u = seg(t, 41.5 + i * 0.16, 42.2 + i * 0.16);
        if (u <= 0) { p.style.opacity = 0; return; }
        var e = Eb(u);
        var y = lerp(300, 472, Eo(u)) + Math.sin(u * Math.PI * 2) * -22;
        p.style.transform = 'translate(0,' + (y - 472) + 'px) rotate(' + ((1 - u) * (i % 2 ? 14 : -14)) + 'deg) scale(' + (0.7 + 0.3 * e) + ')';
        p.style.opacity = (Math.min(1, seg(t, 41.5 + i * 0.16, 41.9 + i * 0.16)) * o5).toFixed(3);
        var bounce = t > 42.3 ? 1 + 0.03 * Math.sin(t * 7 + i) : 1;
        if (t > 42.3) p.style.transform = 'translate(0,0) scale(' + bounce + ')';
      });
      /* 平板 */
      tab.style.opacity = (Math.min(seg(t, 45.0, 45.6), 1 - seg(t, 46.8, 47.3)) * o5).toFixed(3);
    }

    /* ================= SCENE 6 ================= */
    if (o6 > 0) {
      var gatherU = Eio(seg(t, 49.0, 50.7));
      mods.forEach(function (m, i) {
        var a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        var tx = 640 + Math.cos(a) * 96, ty = 360 + Math.sin(a) * 96;
        var d = seg(t, 49.0 + i * 0.05, 50.7 + i * 0.05);
        var e = Eio(d) * (1 + 0.06 * Math.sin(d * Math.PI));
        var x = lerp(m.fx, tx, e), y = lerp(m.fy, ty, e);
        m.el.style.opacity = (Math.min(seg(t, 48.9, 49.4), 1 - seg(t, 51.6, 52.0)) * o6).toFixed(3);
        m.el.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + ((1 - e) * (i % 2 ? 22 : -22)) + 'deg) scale(' + (0.75 + 0.25 * e) + ')';
      });
      /* skill card */
      var skA = seg(t, 51.4, 52.1);
      if (t > 51.4 && t < 53.1) {
        var kx = lerp(640, 640, 1), ky = 360;
        var kk = lerp(0.5, 1, Eb(skA));
        skill.style.opacity = (Math.min(skA, 1) * o6).toFixed(3);
        skill.style.transform = 'translate(' + (kx - 105) + 'px,' + (ky - 131) + 'px) scale(' + kk + ')';
      } else if (t >= 53.1) {
        var mv2 = Eio(seg(t, 52.9, 53.9));
        var sx2 = lerp(640, 908, mv2), sy2 = lerp(360, 344, mv2);
        var kk2 = lerp(1, 0.72, mv2);
        if (t > 56.0) {
          var cg2 = Eio(seg(t, 56.2, 57.5));
          sx2 = lerp(908, 640, cg2); sy2 = lerp(344, 360, cg2); kk2 = lerp(0.72, 0.42, cg2);
        }
        skill.style.opacity = ((1 - seg(t, 57.3, 57.9)) * o6).toFixed(3);
        skill.style.transform = 'translate(' + (sx2 - 105) + 'px,' + (sy2 - 131) + 'px) scale(' + kk2 + ')';
      } else skill.style.opacity = 0;
      var skGlowT = seg(t, 53.9, 56.2);
      skEdge.style.opacity = (t > 52.0 ? (0.35 + 0.65 * Math.max(0, Math.sin(skGlowT * Math.PI))) : 0).toFixed(3);
      skEdge.style.background = 'conic-gradient(from ' + (t * 260 % 360).toFixed(0) + 'deg, transparent 0deg, #2CC08B 45deg, #F5A623 100deg, transparent 170deg, transparent 360deg)';
      shelf.style.opacity = (Math.min(seg(t, 52.4, 53.0), 1 - seg(t, 55.2, 56.0)) * o6).toFixed(3);
      /* hero2 新简报 */
      if (t > 52.9) {
        var h2 = Eo(seg(t, 52.9, 53.6));
        var h2x = 300, h2y = 372, h2k = 0.7 + 0.1 * h2;
        if (t > 56.0) {
          var cg = Eio(seg(t, 56.2, 57.5));
          h2x = lerp(300, 640, cg); h2y = lerp(372, 360, cg); h2k = lerp(0.8, 0.44, cg);
        }
        hero2.style.opacity = ((h2 * (1 - seg(t, 57.3, 57.9))) * o6).toFixed(3);
        hero2.style.transform = 'translate(' + (h2x - 118) + 'px,' + (h2y - 148) + 'px) scale(' + h2k + ')';
      } else hero2.style.opacity = 0;
      /* 快速流程点亮 */
      flowNodes.forEach(function (fn, i) {
        var t0 = 54.05 + i * 0.12;
        var u = seg(t, t0, t0 + 0.14);
        var x = 445 + i * 70, y = 372;
        fn.style.opacity = (Math.min(seg(t, 53.95, 54.05), 1 - seg(t, 55.4, 55.9)) * o6).toFixed(3);
        fn.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + (0.85 + u * 0.2) + ')';
        fn.querySelector('.ico').style.color = u > 0.5 ? '#2CC08B' : '#B9D3DC';
        fn.style.boxShadow = u > 0.5 ? '0 6px 18px rgba(44,192,139,.32)' : '0 6px 16px rgba(20,80,100,.12)';
      });
      var outU = Eo(seg(t, 54.85, 55.3));
      flowOut[0].style.opacity = (outU * (1 - seg(t, 55.6, 56.1)) * o6).toFixed(3);
      flowOut[0].style.transform = 'translate(' + (1015) + 'px,' + (372) + 'px) scale(' + (0.6 + outU * 0.4) + ')';
      flowOut[1].style.opacity = (Eo(seg(t, 55.15, 55.5)) * (1 - seg(t, 55.9, 56.3)) * o6).toFixed(3);
      flowOut[1].style.transform = 'translate(' + (1092) + 'px,' + (300) + 'px) scale(' + (0.5 + Eo(seg(t, 55.15, 55.5)) * 0.5) + ')';
    } else { skill.style.opacity = 0; hero2.style.opacity = 0; }

    /* ================= SCENE 7 ================= */
    if (o7 > 0) {
      var flowU = sm(seg(t, 55.8, 58.0));
      swarm.forEach(function (s) {
        var r = lerp(s.r, 40, flowU);
        var a = s.a + t * 0.12 + flowU * 1.2;
        var x = 640 + Math.cos(a) * r * 1.5, y = 360 + Math.sin(a) * r * 0.85;
        var k = lerp(1, 0.15, flowU);
        s.el.style.transform = 'translate(' + (x - 40) + 'px,' + (y - 50) + 'px) scale(' + k + ') rotate(' + (Math.sin(t + s.ph) * 6) + 'deg)';
        s.el.style.opacity = (Math.min(seg(t, 55.9, 56.6), 1 - seg(t, 57.2, 58.0)) * o7).toFixed(3);
      });
      var oo = Eo(seg(t, 57.9, 58.5));
      outro.style.opacity = (oo * o7).toFixed(3);
      outro.style.transform = 'scale(' + (0.9 + oo * 0.1) + ')';
    }
  }

  /* 时间轴常量集中一处（v0.9.3 P2-C②）：shoot.cjs 与 BGM 合成均从此读取 */
  window.__FILM = { fps: 30, duration: 60, bgm: 'bgm.wav' };
  window.__seek = render;
  render(0);
})();
