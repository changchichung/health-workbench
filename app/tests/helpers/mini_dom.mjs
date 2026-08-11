// 最小 DOM shim：只為了讓 vendored preact 在 node:test 裡真渲染 viewer
// （零依賴哲學：不引 jsdom）。實作面以 vendored preact 10 的 diff 路徑
// 為準（createElement/NS、insertBefore、setAttribute、addEventListener、
// style 物件、Text.data），不追求完整 DOM 語意。
class MiniNode {
  constructor() { this.childNodes = []; this.parentNode = null; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const sib = this.parentNode.childNodes;
    return sib[sib.indexOf(this) + 1] || null;
  }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
}

class MiniText extends MiniNode {
  constructor(data) { super(); this.nodeType = 3; this.data = String(data); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class MiniElement extends MiniNode {
  constructor(name) {
    super();
    this.nodeType = 1;
    this.localName = String(name).toLowerCase();
    // preact 以 `'onclick' in dom` 探測事件名大小寫；補常見 handler
    // 屬性讓它走小寫路徑（addEventListener("click", …)）
    this.onclick = null; this.oninput = null; this.onchange = null;
    this.onsubmit = null; this.onkeydown = null;
    this.attributes = {};
    this.style = { setProperty() {}, removeProperty() {}, cssText: "" };
    this.listeners = {};
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  removeAttribute(k) { delete this.attributes[k]; }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    const a = this.listeners[t] || [];
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  dispatch(type) {
    const evt = { type, target: this, currentTarget: this,
      preventDefault() {}, stopPropagation() {} };
    for (const fn of (this.listeners[type] || []).slice()) fn.call(this, evt);
  }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) {
    this.childNodes.forEach((c) => (c.parentNode = null));
    this.childNodes = [];
    if (v !== "" && v != null) this.appendChild(new MiniText(v));
  }
  // preact useEffect 內的 document.querySelector 由 document 層回 null；
  // element 層不需要選擇器。scrollIntoView 給 Timeline/Meds 的 focus 用。
  scrollIntoView() {}
}

export function makeDocument() {
  const byId = new Map();
  const doc = {
    title: "",
    activeElement: null,
    createElement: (n) => new MiniElement(n),
    createElementNS: (_ns, n) => new MiniElement(n),
    createTextNode: (d) => new MiniText(d),
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    registerId(id, el) { byId.set(id, el); el.setAttribute("id", id); },
  };
  return doc;
}

/* 深度優先蒐集符合條件的元素 */
export function findAll(root, pred) {
  const out = [];
  (function walk(n) {
    if (n.nodeType === 1 && pred(n)) out.push(n);
    for (const c of n.childNodes || []) walk(c);
  })(root);
  return out;
}
