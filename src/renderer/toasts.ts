import { state } from './state';

export function showToast(title: string, body: string, accentColor: string): void {
  if (!state.settings.toastNotifications) return;
  const container = document.getElementById("toast-container")!;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast-accent" style="background: ${accentColor}"></div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-body">${body}</div>
    </div>
    <span class="toast-time">now</span>
  `;
  toast.addEventListener("click", () => dismissToast(toast));
  container.appendChild(toast);
  setTimeout(() => dismissToast(toast), 5000);
}

function dismissToast(toast: HTMLElement): void {
  if (toast.classList.contains("exiting")) return;
  toast.classList.add("exiting");
  setTimeout(() => toast.remove(), 300);
}
