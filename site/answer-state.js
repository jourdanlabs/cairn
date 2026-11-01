// Act II honesty. beats.js renders either a GROUNDED answer or bare retrieved passages.
// Watch each ask beat's output: when passages come back with no written answer, say so,
// and set body[data-answer] so placards, seals and finales switch to copy true of that state.
(function () {
  'use strict';
  document.querySelectorAll('[data-beat="ask"] .beat-out').forEach(function (out) {
    new MutationObserver(function () {
      if (out.querySelector('.stamp.grounded')) { document.body.setAttribute('data-answer', 'answer'); return; }
      if (out.querySelector('.stamp') || !out.querySelector('.hitrow') || out.querySelector('.answer-down')) return;
      document.body.setAttribute('data-answer', 'passages');
      var down = document.createElement('div');
      down.className = 'confline bad answer-down';
      down.textContent = 'The written answer is unavailable right now. These are the retrieved passages, sealed. Nothing was written for you.';
      out.insertBefore(down, out.firstChild);
    }).observe(out, { childList: true });
  });
})();
