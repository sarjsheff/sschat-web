import { LitElement, html, css } from 'lit';

export class SButton extends LitElement {
  static properties = {
    variant: { type: String },
    size: { type: String },
    disabled: { type: Boolean },
  };

  static styles = css`
    :host { display: inline-block; }
    :host([block]) { display: block; width: 100%; }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.15s;
      cursor: pointer;
      border: none;
      outline: none;
      font-family: inherit;
    }
    button:disabled {
      pointer-events: none;
      opacity: 0.5;
      cursor: default;
    }
    /* sizes */
    .sz-default { height: 40px; padding: 0 16px; }
    .sz-sm { height: 36px; padding: 0 12px; font-size: 13px; }
    .sz-lg { height: 44px; padding: 0 32px; font-size: 16px; }
    .sz-icon { height: 40px; width: 40px; padding: 0; }
    /* variants */
    .v-default { background: #222; color: #fafafa; }
    .v-default:hover { background: #333; }
    .v-destructive { background: #e23b3b; color: #fff; }
    .v-destructive:hover { background: #c53030; }
    .v-outline { background: #fff; color: #222; border: 1px solid #ccc; }
    .v-outline:hover { background: #f5f5f5; }
    .v-ghost { background: none; color: #222; }
    .v-ghost:hover { background: rgba(0,0,0,0.05); }
    .v-secondary { background: #f5f5f5; color: #222; }
    .v-secondary:hover { background: #e5e5e5; }
  `;

  constructor() {
    super();
    this.variant = 'default';
    this.size = 'default';
    this.disabled = false;
  }

  render() {
    const v = this.variant || 'default';
    const s = this.size || 'default';
    return html`<button class="v-${v} sz-${s}" ?disabled=${this.disabled}><slot></slot></button>`;
  }
}
customElements.define('s-button', SButton);
