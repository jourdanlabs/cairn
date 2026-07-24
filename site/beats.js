// The beat-runner — PROVING ROOM treatment for the edition rooms. Each beat is a
// stage: the visitor presses run, the page calls the LIVE box (CORS allow-listed),
// and the real response performs in the room's aesthetic. Nothing is mocked; the
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
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(function () {
      node.style.transition = 'opacity .5s ease, transform .5s ease';
      node.style.opacity = '1';
      node.style.transform = 'none';
    }, 90 * i + 30);
  }
  function rawToggle(out, data) {
    var d = el('details', 'raw');
    d.appendChild(el('summary', null, 'view the raw response'));
    var pre = el('pre', null, JSON.stringify(data, null, 2));
    d.appendChild(pre);
    out.appendChild(d);
  }
  async function call(base, path, body, onWake) {
    var opts = body === undefined
      ? { method: 'GET' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
    // Scale-to-zero boxes wake on first touch — surface that honestly.
    var wakeTimer = setTimeout(onWake, 2500);
    try {
      var res = await fetch(base + path, opts);
      return await res.json();
    } finally { clearTimeout(wakeTimer); }
  }

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
  function renderRefusal(out, data, base) {
    var stamp = el('div', 'stamp', 'REFUSED');
    out.appendChild(stamp);
    var why = el('div', 'confline', 'confidence ' + data.confidence + ' — the corpus does not establish this. Nothing was invented.');
    out.appendChild(why); reveal(why, 1);
    if (data.ledger) {
      var seal = el('div', 'seal-live', 'sealed · ledger #' + data.ledger.seq + ' · ' + String(data.ledger.entry_hash || '').slice(0, 20) + '…');
      out.appendChild(seal); reveal(seal, 2);
      var vbtn = el('button', 'beat-run', 'Verify the chain it just sealed into →');
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
          })
          .catch(function () { vbtn.textContent = 'the box did not answer — try the curl below'; });
      });
      out.appendChild(vbtn); reveal(vbtn, 3);
    }
  }

  // ── stage wiring ───────────────────────────────────────────────────────────
  document.querySelectorAll('[data-beat]').forEach(function (beat) {
    var kind = beat.getAttribute('data-beat');
    var base = beat.getAttribute('data-base') || document.body.getAttribute('data-base');
    var q = beat.getAttribute('data-q');
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
        } else {
          data = await call(base, '/api/answer', { q: q }, onWake);
          if (data.refused) renderRefusal(out, data, base);
          else renderHits(out, data);
        }
        rawToggle(out, data);
        btn.textContent = 'run it again';
        btn.disabled = false;
      } catch (e) {
        btn.textContent = was;
        btn.disabled = false;
        out.appendChild(el('div', 'confline bad', 'The box did not answer from this page — it may be waking, or you may be on a preview URL not on the CORS allow-list. The curl below always works.'));
      }
    });
  });
})();
