import { LitElement, html, css } from 'lit';

export class SInput extends LitElement {
  static properties = {
    type: { type: String },
    placeholder: { type: String },
    value: { type: String },
    disabled: { type: Boolean },
    maxlength: { type: Number },
    autofocus: { type: Boolean },
  };

  static styles = css`
    :host { display: block; width: 100%; }
    input {
      height: 40px;
      width: 100%;
      border-radius: 6px;
      border: 1px solid #ccc;
      background: #fff;
      color: #222;
      padding: 0 12px;
      font-size: 14px;
      font-family: inherit;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #4a9eff; box-shadow: 0 0 0 2px rgba(74,158,255,0.2); }
    input:disabled { opacity: 0.5; cursor: default; }
    input::placeholder { color: #999; }
  `;

  constructor() {
    super();
    this.type = 'text';
    this.placeholder = '';
    this.value = '';
    this.disabled = false;
    this.autofocus = false;
  }

  render() {
    return html`<input
      type=${this.type}
      placeholder=${this.placeholder}
      .value=${this.value}
      ?disabled=${this.disabled}
      maxlength=${this.maxlength || ''}
      ?autofocus=${this.autofocus}
      @input=${this._onInput}
      @keydown=${this._onKeydown}
    />`;
  }

  _onInput(e) {
    this.value = e.target.value;
    this.dispatchEvent(new CustomEvent('s-input', { detail: this.value, bubbles: true, composed: true }));
  }

  _onKeydown(e) {
    this.dispatchEvent(new CustomEvent('s-keydown', { detail: { key: e.key, value: this.value }, bubbles: true, composed: true }));
  }
}
customElements.define('s-input', SInput);
