import { Component, Show } from 'solid-js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  title: string;
  items: ShortcutItem[];
}

export const KeyboardShortcutsModal: Component<Props> = (props) => {
  const shortcutCategories: ShortcutCategory[] = [
    {
      title: 'View Navigation',
      items: [
        { keys: ['1'], description: 'Switch to Risk Matrix Screener' },
        { keys: ['2'], description: 'Switch to Live Open Positions Blotter' },
        { keys: ['/'], description: 'Focus Symbol Search input' },
      ],
    },
    {
      title: 'Display Ergonomics & Semantics',
      items: [
        { keys: ['H'], description: 'Cycle PnL Display Mode (Currency → R-Multiple → Stealth Mask)' },
        { keys: ['C'], description: 'Toggle CVD Accessible Colorway (Standard ↔ Cyan/Amber)' },
      ],
    },
    {
      title: 'Execution & Safety Interlocks',
      items: [
        { keys: ['Escape'], description: 'Disarm execution trigger, close open modals, or clear search' },
        { keys: ['Enter'], description: 'Commit inline Stop Loss or numeric value and release focus' },
        { keys: ['Double-Click'], description: 'Open Quantitative Deep-Dive Math Breakdown for symbol row' },
      ],
    },
    {
      title: 'Help & Information',
      items: [
        { keys: ['?'], description: 'Toggle this Keyboard Shortcuts cheat sheet' },
      ],
    },
  ];

  return (
    <Show when={props.isOpen}>
      <div class="modal-backdrop" onClick={props.onClose}>
        <div
          class="modal-card shortcuts-modal-card"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-modal-title"
        >
          <div class="modal-header">
            <div class="modal-title-group">
              <span class="modal-icon">⌨️</span>
              <h3 id="shortcuts-modal-title" class="modal-title">
                Institutional Terminal — Keyboard Shortcuts
              </h3>
            </div>
            <button
              class="modal-close-btn"
              onClick={props.onClose}
              aria-label="Close shortcuts dialog"
              title="Close (Escape)"
            >
              ✕
            </button>
          </div>

          <div class="modal-body">
            {shortcutCategories.map((category) => (
              <div class="shortcuts-category-group">
                <div class="shortcuts-category-title">{category.title}</div>
                {category.items.map((item) => (
                  <div class="shortcut-row">
                    <span class="shortcut-desc">{item.description}</span>
                    <div class="shortcut-keys">
                      {item.keys.map((k) => (
                        <kbd class="shortcut-key-badge">{k}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Show>
  );
};
