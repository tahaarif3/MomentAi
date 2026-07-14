const MOTION_MS = 280;

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function waitForTransition(el, fallbackMs = MOTION_MS) {
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (e) => {
      if (e.target === el) done();
    };
    el.addEventListener('transitionend', onEnd);
    setTimeout(done, fallbackMs + 80);
  });
}

export function showPanel(el) {
  if (!el) return Promise.resolve();
  el.classList.remove('hidden');
  void el.offsetHeight;
  el.classList.add('is-visible');
  return Promise.resolve();
}

export async function hidePanel(el) {
  if (!el) return;
  el.classList.remove('is-visible');
  if (prefersReducedMotion()) {
    el.classList.add('hidden');
    return;
  }
  await waitForTransition(el);
  el.classList.add('hidden');
}

export async function toggleModal(modalEl, open) {
  if (!modalEl) return;
  const content = modalEl.querySelector('.modal-content');

  if (open) {
    modalEl.classList.remove('hidden', 'is-closing');
    if (content) content.classList.remove('is-closing');
    void modalEl.offsetHeight;
    modalEl.classList.add('is-visible');
    return;
  }

  modalEl.classList.remove('is-visible');
  modalEl.classList.add('is-closing');
  if (content) content.classList.add('is-closing');

  if (prefersReducedMotion()) {
    modalEl.classList.add('hidden');
    modalEl.classList.remove('is-closing');
    if (content) content.classList.remove('is-closing');
    return;
  }

  await waitForTransition(modalEl, 320);
  modalEl.classList.add('hidden');
  modalEl.classList.remove('is-closing');
  if (content) content.classList.remove('is-closing');
}

export function staggerIn(container, itemSelector, delayMs = 40) {
  if (!container) return;
  const items = container.querySelectorAll(itemSelector);
  items.forEach((item, i) => {
    item.style.setProperty('--stagger-delay', `${i * delayMs}ms`);
    item.classList.add('stagger-enter');
    if (prefersReducedMotion()) {
      item.classList.add('stagger-visible');
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => item.classList.add('stagger-visible'));
    });
  });
}

export function runViewTransition(updateFn) {
  if (!prefersReducedMotion() && document.startViewTransition) {
    return document.startViewTransition(updateFn);
  }
  updateFn();
  return { finished: Promise.resolve() };
}

export async function transitionToPreview({ grid, landingStack, analysisCard, analysisLoader, showLoader = true }) {
  runViewTransition(() => {
    if (grid) {
      grid.classList.remove('landing-state');
      grid.classList.add('preview-state');
    }
  });

  const rightPanel = document.querySelector('.right-panel');
  if (landingStack) await hidePanel(landingStack);
  if (analysisCard) {
    analysisCard.classList.remove('hidden');
    analysisCard.classList.add('is-analyzing');
    analysisCard.classList.remove('is-ready');
    await showPanel(analysisCard);
  }
  if (rightPanel) await showPanel(rightPanel);
  if (analysisLoader) {
    if (showLoader) {
      analysisLoader.classList.remove('hidden');
      analysisLoader.setAttribute('aria-busy', 'true');
    } else {
      analysisLoader.classList.add('hidden');
      analysisLoader.setAttribute('aria-busy', 'false');
    }
  }
}

export async function transitionToLanding({ grid, landingStack, analysisCard, analysisLoader }) {
  runViewTransition(() => {
    if (grid) {
      grid.classList.add('landing-state');
      grid.classList.remove('preview-state');
    }
  });

  if (analysisLoader) analysisLoader.classList.add('hidden');
  if (analysisCard) {
    analysisCard.classList.remove('is-analyzing', 'is-ready');
    await hidePanel(analysisCard);
  }
  const rightPanel = document.querySelector('.right-panel');
  if (rightPanel) {
    rightPanel.classList.remove('is-visible');
  }
  if (landingStack) await showPanel(landingStack);
}

export function setButtonLoading(btn, loading, loadingText) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.originalText) {
      btn.dataset.originalText = btn.textContent;
    }
    btn.classList.add('is-loading');
    btn.disabled = true;
    if (loadingText) btn.setAttribute('aria-busy', 'true');
  } else {
    btn.classList.remove('is-loading');
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (btn.dataset.originalText) {
      btn.textContent = btn.dataset.originalText;
      delete btn.dataset.originalText;
    }
  }
}
