import { Game } from './game';

const canvas = document.getElementById('game');
const root = document.getElementById('ui');

try {
  if (!(canvas instanceof HTMLCanvasElement) || !root) throw new Error('Game canvas or UI root is missing.');
  const game = new Game(canvas);
  game.net.observeStatus((connected, text) => game.ui.connectionStatus(connected, text));
  if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
} catch (error) {
  console.error('Unable to start Aetheria', error);
  if (root) {
    root.replaceChildren();
    const panel = document.createElement('section');
    panel.className = 'ae-scrim';
    const content = document.createElement('div');
    content.className = 'ae-journal ae-form';
    const title = document.createElement('h2');
    title.textContent = 'Unable to start the journey';
    const message = document.createElement('p');
    const detail = error instanceof Error ? error.message : String(error);
    message.textContent = detail || 'An unknown startup error occurred. Reload to try again.';
    if (/webgl|creating.*context/i.test(detail)) message.textContent += ' Aetheria needs WebGL 2. Check browser support and hardware acceleration, then reload.';
    const retry = document.createElement('button');
    retry.className = 'ae-primary';
    retry.textContent = 'Reload';
    retry.addEventListener('click', () => location.reload());
    content.append(title, message, retry); panel.appendChild(content); root.appendChild(panel);
  }
}
