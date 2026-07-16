import { runViewTransition } from './animations.js';

const hooks = {};
let currentScreen = 'home';

export function getCurrentScreen() {
  return currentScreen;
}

export function registerScreen(name, { onEnter, onLeave } = {}) {
  hooks[name] = { onEnter, onLeave };
}

export function showScreen(name, params) {
  if (name === currentScreen && !params) return;

  const prev = currentScreen;
  hooks[prev]?.onLeave?.(params);

  runViewTransition(() => {
    document.querySelectorAll('main [data-screen].screen').forEach((el) => {
      el.classList.toggle('screen--active', el.dataset.screen === name);
    });
    document.body.dataset.screen = name;
  });

  currentScreen = name;
  hooks[name]?.onEnter?.(params);
}

export function initRouter(initialScreen = 'home') {
  document.querySelectorAll('main [data-screen].screen').forEach((el) => {
    el.classList.toggle('screen--active', el.dataset.screen === initialScreen);
  });
  document.body.dataset.screen = initialScreen;
  currentScreen = initialScreen;
  hooks[initialScreen]?.onEnter?.();
}
