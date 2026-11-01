// Act II honesty. beats.js renders either a GROUNDED answer or bare retrieved passages.
// Watch each ask beat's output: when passages come back with no written answer, say so,
// and set body[data-answer] so placards, seals and finales switch to copy true of that state.
(function () {
  'use strict';
  // The answer model writes **bold**; beats.js sets textContent, so render only that, as text nodes.
  function boldify(node) {
    var parts = node.textContent.split('**');
    if (parts.length < 3 || parts.length % 2 === 0) return;
    node.textContent = '';
    parts.forEach(function (p, i) {
      if (i % 2) { var b = document.createElement('b'); b.textContent = p; node.appendChild(b); }
      else node.appendChild(document.createTextNode(p));
    });
  }
  document.querySelectorAll('[data-beat="ask"] .beat-out').forEach(function (out) {
    new MutationObserver(function () {
      if (out.querySelector('.stamp.grounded')) {
        document.body.setAttribute('data-answer', 'answer');
        var body = out.querySelector('.abody');
        if (body && !body.getAttribute('data-md')) { body.setAttribute('data-md', '1'); boldify(body); }
        return;
      }
      if (out.querySelector('.stamp') || !out.querySelector('.hitrow') || out.querySelector('.answer-down')) return;
      document.body.setAttribute('data-answer', 'passages');
      var down = document.createElement('div');
      down.className = 'confline bad answer-down';
      down.textContent = 'The written answer is unavailable right now. These are the retrieved passages, sealed. Nothing was written for you.';
      out.insertBefore(down, out.firstChild);
    }).observe(out, { childList: true });
  });
})();
