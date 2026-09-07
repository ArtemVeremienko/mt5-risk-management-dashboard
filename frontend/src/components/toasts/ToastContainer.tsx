import { Component, For, Show } from 'solid-js';
import { toastStore } from '../../stores/toastStore';

export const ToastContainer: Component = () => {
  return (
    <div class="toast-stack" aria-live="polite" aria-atomic="true">
      <For each={toastStore.toasts()}>
        {(t) => (
          <div
            class={`toast-card toast-${t.type}`}
            onClick={() => toastStore.removeToast(t.id)}
            role="alert"
          >
            <div class="toast-header">
              <span class="toast-title">{t.title}</span>
              <button
                type="button"
                class="toast-close-btn"
                aria-label="Dismiss notification"
                onClick={(e) => {
                  e.stopPropagation();
                  toastStore.removeToast(t.id);
                }}
              >
                ✕
              </button>
            </div>
            <Show when={Boolean(t.message && t.message.trim().length > 0)}>
              <div class="toast-body">{t.message}</div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
};
