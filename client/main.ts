import { Game } from './game';

const canvas = document.getElementById('game');
const root = document.getElementById('ui');

try {
  if (!(canvas instanceof HTMLCanvasElement) || !root) throw new Error('Game canvas or UI root is missing.');
  const game = new Game(canvas);
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
    message.textContent = 'Aetheria needs WebGL 2 and a modern desktop browser. Enable hardware acceleration, then reload.';
    const retry = document.createElement('button');
    retry.className = 'ae-primary';
    retry.textContent = 'Reload';
    retry.addEventListener('click', () => location.reload());
    content.append(title, message, retry); panel.appendChild(content); root.appendChild(panel);
  }
}
