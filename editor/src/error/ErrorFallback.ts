import { icons } from '../utils/icons';

export function createErrorFallback(error: Error): HTMLElement {
  const container = document.createElement('div');
  container.className = 'es-error-fallback';
  container.innerHTML = `
    <div class="es-error-fallback-icon">${icons.x(48)}</div>
    <h3 class="es-error-fallback-title">Something went wrong</h3>
    <p class="es-error-fallback-message">${escapeHtml(error.message)}</p>
    <details class="es-error-fallback-details">
      <summary>Error details</summary>
      <pre class="es-error-fallback-stack">${escapeHtml(error.stack ?? 'No stack trace')}</pre>
    </details>
    <div class="es-error-fallback-actions">
      <button class="es-btn es-btn-primary" data-action="reload">Reload Panel</button>
      <button class="es-btn" data-action="report">Report Issue</button>
    </div>
  `;

  container.querySelector('[data-action="reload"]')?.addEventListener('click', () => {
    window.location.reload();
  });

  container.querySelector('[data-action="report"]')?.addEventListener('click', () => {
    const issueUrl = `https://github.com/esengine/esengine/issues/new?template=bug_report.md&title=${encodeURIComponent('Editor Error: ' + error.message)}`;
    window.open(issueUrl, '_blank');
  });

  return container;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
