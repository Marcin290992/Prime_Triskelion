// Copy-the-email action for the Contact page: copies the address and a
// toast rises above the MENU button with the address that's now on the
// clipboard (the page also updates its own status line). If the browser
// blocks the clipboard, the toast shows the address selected for a manual
// copy instead of pretending it worked.

import { CONTACT_EMAIL } from './contactLinks';

export { CONTACT_EMAIL };

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the legacy path */
    }
  }
  const t = document.createElement('textarea');
  t.value = text;
  t.setAttribute('readonly', '');
  t.style.position = 'fixed';
  t.style.opacity = '0';
  document.body.appendChild(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
  t.remove();
  return ok;
}

let toastTimer = 0;

function getToast(): HTMLElement {
  // Recreated after page swaps (Astro replaces <body>'s children).
  let el = document.getElementById('pt-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pt-toast';
    el.className = 'pt-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="pt-toast__text"></span>';
    document.body.appendChild(el);
  }
  return el;
}

export function showToast(html: string, { ok = true, duration = 2600 } = {}) {
  const el = getToast();
  el.classList.toggle('pt-toast--warn', !ok);
  el.querySelector('.pt-toast__text')!.innerHTML = html;
  el.classList.remove('is-visible');
  void el.offsetWidth; // restart the entrance if it was already showing
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('is-visible'), duration);
}

export async function copyContactEmail(trigger?: HTMLElement | null): Promise<boolean> {
  const ok = await copyText(CONTACT_EMAIL);
  if (ok) {
    showToast(`Email copied <span class="pt-toast__sep">—</span> <span class="pt-toast__email">${CONTACT_EMAIL}</span>`);
    navigator.vibrate?.(18);
    if (trigger) {
      trigger.classList.add('is-copied');
      window.setTimeout(() => trigger.classList.remove('is-copied'), 2200);
    }
  } else {
    showToast(`<span class="pt-toast__email pt-toast__email--select">${CONTACT_EMAIL}</span> <span class="pt-toast__sep">—</span> select to copy`, { ok: false, duration: 6000 });
  }
  return ok;
}
