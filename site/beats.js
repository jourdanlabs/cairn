// The beat-runner + guided arc — PROVING ROOM treatment for the edition rooms.
// Grammar: entrance placard → BEGIN → acts unlock in sequence (placard explains,
// instrument performs LIVE against the box) → completing the refusal-and-verify
// finale opens THE DOORS to the full live demo. Nothing is mocked; every beat's
// raw JSON is one toggle away, because receipts are for inspecting.
(function () {
  'use strict';
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function reveal(node, i) {
    if (reduced) return;
    node.style.opacity = '0'; node.style.transform = 'translateY(6px)';
    setTimeout(function () {
      node.style.transition = 'opacity .5s ease, transform .5s ease';
      node.style.opacity = '1'; node.style.transform = 'none';
    }, 90 * i + 30);
  }
  function rawToggle(out, data) {
    var d = el('details', 'raw');
    d.appendChild(el('summary', null, 'view the raw response'));
    d.appendChild(el('pre', null, JSON.stringify(data, null, 2)));
    out.appendChild(d);
  }
  async function call(base, path, body, onWake) {
    var opts = body === undefined
      ? { method: 'GET' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
    var wakeTimer = setTimeout(onWake, 2500);
    try {
      var res = await fetch(base + path, opts);
      return await res.json();
    } finally { clearTimeout(wakeTimer); }
  }

  // ── the arc ────────────────────────────────────────────────────────────────
  var acts = Array.prototype.slice.call(document.querySelectorAll('.act'));
  var rail = document.querySelector('.rail');
  var railItems = rail ? Array.prototype.slice.call(rail.querySelectorAll('li')) : [];
  var current = 0;

  function openAct(n) {
    var act = acts[n - 1];
    if (!act || !act.hidden) return;
    act.hidden = false;
    act.classList.add('enter');
    railItems.forEach(function (li, i) {
      li.classList.toggle('now', i === n - 1);
    });
    current = n;
    setTimeout(function () {
      act.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }, 60);
  }
  function completeAct(n) {
    if (railItems[n - 1]) { railItems[n - 1].classList.remove('now'); railItems[n - 1].classList.add('done'); }
    openAct(n + 1);
  }

  var begin = document.getElementById('begin');
  if (begin) begin.addEventListener('click', function () {
    begin.remove();
    if (rail) rail.hidden = false;
    openAct(1);
  });
  document.querySelectorAll('.skip').forEach(function (s) {
    s.addEventListener('click', function () {
      if (rail) rail.hidden = false;
      acts.forEach(function (a) { a.hidden = false; });
      railItems.forEach(function (li) { li.classList.remove('now'); });
      acts[acts.length - 1].scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    });
  });

  // ── renderers ──────────────────────────────────────────────────────────────
  function renderCards(out, data) {
    (data.cards || []).forEach(function (c, i) {
      var row = el('div', 'hitrow');
      row.appendChild(el('div', 'hit-title', c.entity + '  ·  ' + (c.type || 'card')));
      row.appendChild(el('div', 'hit-note', c.facts_verified + ' facts verified · ' + c.facts_dropped + ' dropped as unverifiable'));
      row.appendChild(el('div', 'hit-snippet', (c.receipt || '').slice(0, 46) + '…'));
      out.appendChild(row); reveal(row, i);
    });
  }
  function renderHits(out, data) {
    var conf = el('div', 'confline', 'confidence ' + data.confidence + (data.weak ? ' · below the floor' : '') + ' · ' + (data.hits || []).length + ' grounded passages');
    out.appendChild(conf); reveal(conf, 0);
    (data.hits || []).slice(0, 5).forEach(function (h, i) {
      var row = el('div', 'hitrow');
      row.appendChild(el('div', 'hit-title', h.title || h.note));
      row.appendChild(el('div', 'hit-note', h.note + (h.heading ? ' · ' + h.heading : '')));
      row.appendChild(el('div', 'hit-snippet', h.snippet || ''));
      out.appendChild(row); reveal(row, i + 1);
    });
  }
  function renderRefusal(out, data, base, actNum) {
    var stamp = el('div', 'stamp', 'REFUSED');
    out.appendChild(stamp);
    var why = el('div', 'confline', 'confidence ' + data.confidence + ' — the corpus does not establish this. Nothing was invented.');
    out.appendChild(why); reveal(why, 1);
    if (data.ledger) {
      var seal = el('div', 'seal-live', 'sealed · ledger #' + data.ledger.seq + ' · ' + String(data.ledger.entry_hash || '').slice(0, 20) + '…');
      out.appendChild(seal); reveal(seal, 2);
      var vbtn = el('button', 'beat-run', 'Verify the chain to open the doors →');
      vbtn.addEventListener('click', function () {
        vbtn.disabled = true; vbtn.textContent = 'recomputing the chain…';
        call(base, '/api/ledger/verify', undefined, function () { vbtn.textContent = 'waking the engine…'; })
          .then(function (v) {
            vbtn.remove();
            var ok = el('div', 'confline ' + (v.ok ? 'ok' : 'bad'),
              v.ok ? 'chain verifies · ok: true · ' + v.count + ' sealed entries · your refusal is entry #' + data.ledger.seq
                   : 'chain BROKEN at ' + v.broken_at);
            out.appendChild(ok); reveal(ok, 0);
            rawToggle(out, v);
            if (v.ok && actNum) completeAct(actNum);
          })
          .catch(function () { vbtn.textContent = 'the box did not answer — try again'; vbtn.disabled = false; });
      });
      out.appendChild(vbtn); reveal(vbtn, 3);
    }
  }

  // ── instrument wiring ──────────────────────────────────────────────────────
  document.querySelectorAll('[data-beat]').forEach(function (beat) {
    var kind = beat.getAttribute('data-beat');
    var base = beat.getAttribute('data-base') || document.body.getAttribute('data-base');
    var q = beat.getAttribute('data-q');
    var actEl = beat.closest('.act');
    var actNum = actEl ? acts.indexOf(actEl) + 1 : 0;
    var btn = beat.querySelector('.beat-run');
    var out = beat.querySelector('.beat-out');
    if (!btn || !out || !base) return;
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      var was = btn.textContent;
      btn.textContent = 'asking the live box…';
      out.textContent = '';
      var onWake = function () { btn.textContent = 'waking the engine (scale-to-zero — a few seconds)…'; };
      try {
        var data;
        if (kind === 'cards') {
          data = await call(base, '/api/cards', undefined, onWake);
          renderCards(out, data);
          rawToggle(out, data);
          if (actNum) completeAct(actNum);
        } else {
          data = await call(base, '/api/answer', { q: q }, onWake);
          if (data.refused) {
            renderRefusal(out, data, base, actNum); // act completes on chain-verify
            rawToggle(out, data);
          } else {
            renderHits(out, data);
            rawToggle(out, data);
            if (actNum) completeAct(actNum);
          }
        }
        btn.textContent = 'run it again';
        btn.disabled = false;
      } catch (e) {
        btn.textContent = was;
        btn.disabled = false;
        out.appendChild(el('div', 'confline bad', 'The box did not answer from this page — it may be waking, or you may be on a preview URL not on the CORS allow-list. The curls at the end always work.'));
      }
    });
  });
})();
