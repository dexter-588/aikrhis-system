'use strict';

(function initializeBotCompanion() {
  const companion = document.querySelector('#bot-companion');
  if (!companion) return;

  const roamer = companion.querySelector('.bot-roamer');
  const statusTitle = companion.querySelector('.bot-status b');
  const statusDetail = companion.querySelector('.bot-status small');
  const announcer = companion.querySelector('.bot-announcer');
  if (!roamer || !statusTitle || !statusDetail || !announcer) return;

  const defaultTitle = statusTitle.textContent;
  const defaultDetail = statusDetail.textContent;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const PATROL_DURATION = 1800;
  const AUTO_PATROL_MIN = 3800;
  const AUTO_PATROL_MAX = 6500;

  let pointerFrame = 0;
  let patrolTimer = 0;
  let patrolFallbackTimer = 0;
  let phaseTimers = [];
  let patrolToken = 0;
  let patrolIsManual = false;
  let isPatrolling = false;
  let hasAutoPatrolled = false;

  function setStatus(title, detail) {
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
  }

  function announce(message) {
    announcer.textContent = '';
    window.requestAnimationFrame(() => {
      announcer.textContent = message;
    });
  }

  function clearPhaseTimers() {
    phaseTimers.forEach(timer => window.clearTimeout(timer));
    phaseTimers = [];
  }

  function resetTracking() {
    window.cancelAnimationFrame(pointerFrame);
    companion.classList.remove('is-tracking');
    companion.style.setProperty('--pet-tilt-x', '0deg');
    companion.style.setProperty('--pet-tilt-y', '0deg');
  }

  function trackPointer(event) {
    if (reducedMotion.matches || isPatrolling || event.pointerType === 'touch') return;

    window.cancelAnimationFrame(pointerFrame);
    pointerFrame = window.requestAnimationFrame(() => {
      const bounds = companion.getBoundingClientRect();
      const horizontal = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
      const vertical = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
      const rotateX = Math.max(-1, Math.min(1, -vertical)) * 3.5;
      const rotateY = Math.max(-1, Math.min(1, horizontal)) * 6;

      companion.style.setProperty('--pet-tilt-x', `${rotateX.toFixed(2)}deg`);
      companion.style.setProperty('--pet-tilt-y', `${rotateY.toFixed(2)}deg`);
      companion.classList.add('is-tracking');
    });
  }

  function schedulePatrol() {
    window.clearTimeout(patrolTimer);
    if (document.hidden || reducedMotion.matches || isPatrolling || hasAutoPatrolled) return;

    const delay = AUTO_PATROL_MIN + Math.random() * (AUTO_PATROL_MAX - AUTO_PATROL_MIN);
    patrolTimer = window.setTimeout(() => runPatrol({ manual: false }), delay);
  }

  function finishPatrol(token = patrolToken) {
    if (!isPatrolling || token !== patrolToken) return;

    const wasManual = patrolIsManual;
    isPatrolling = false;
    patrolIsManual = false;
    window.clearTimeout(patrolFallbackTimer);
    clearPhaseTimers();
    companion.classList.remove('is-patrolling');
    companion.setAttribute('aria-busy', 'false');
    setStatus(defaultTitle, defaultDetail);

    if (wasManual) announce('KR-01 bark sequence complete.');
    schedulePatrol();
  }

  function cancelPatrol({ restoreStatus = true } = {}) {
    patrolToken += 1;
    isPatrolling = false;
    patrolIsManual = false;
    window.clearTimeout(patrolTimer);
    window.clearTimeout(patrolFallbackTimer);
    clearPhaseTimers();
    companion.classList.remove('is-patrolling');
    companion.setAttribute('aria-busy', 'false');
    resetTracking();

    if (restoreStatus) setStatus(defaultTitle, defaultDetail);
  }

  function runPatrol({ manual = false } = {}) {
    if (isPatrolling) {
      if (manual) announce('KR-01 is already barking.');
      return false;
    }

    if (document.hidden || reducedMotion.matches) {
      if (manual) announce('Motion is reduced. KR-01 will remain at the docking position.');
      return false;
    }

    window.clearTimeout(patrolTimer);
    window.clearTimeout(patrolFallbackTimer);
    clearPhaseTimers();
    resetTracking();

    isPatrolling = true;
    patrolIsManual = manual;
    hasAutoPatrolled = true;
    const token = ++patrolToken;

    companion.classList.remove('is-patrolling');
    void companion.offsetWidth;
    companion.classList.add('is-patrolling');
    companion.setAttribute('aria-busy', 'true');
    setStatus('ALERT BARK // AW-AW', 'Acoustic warning sequence active');
    if (manual) announce('KR-01 says aw-aw.');

    phaseTimers.push(window.setTimeout(() => {
      if (token === patrolToken) setStatus('SECOND BARK // AW-AW', 'Tail and head response synchronized');
    }, 900));

    phaseTimers.push(window.setTimeout(() => {
      if (token === patrolToken) setStatus('ALERT COMPLETE // SAFE', 'Returning to watch mode');
    }, 1550));

    patrolFallbackTimer = window.setTimeout(() => finishPatrol(token), PATROL_DURATION + 180);
    return true;
  }

  function greet() {
    runPatrol({ manual: true });
  }

  roamer.addEventListener('animationend', event => {
    if (event.target === roamer && event.animationName === 'bot-patrol-path') {
      finishPatrol();
    }
  });

  companion.addEventListener('pointermove', trackPointer);
  companion.addEventListener('pointerleave', resetTracking);
  companion.addEventListener('click', greet);
  companion.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    greet();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelPatrol();
    else schedulePatrol();
  });

  window.addEventListener('pagehide', () => cancelPatrol({ restoreStatus: false }));
  window.addEventListener('pageshow', schedulePatrol);

  const handleMotionPreference = () => {
    if (reducedMotion.matches) cancelPatrol();
    else schedulePatrol();
  };

  if (typeof reducedMotion.addEventListener === 'function') {
    reducedMotion.addEventListener('change', handleMotionPreference);
  } else {
    reducedMotion.addListener(handleMotionPreference);
  }

  companion.setAttribute('aria-busy', 'false');
  schedulePatrol();
})();
