/**
 * A minimal DOM node: enough tree to insert, splice, and read text, with no layout or events.
 */
export class FakeNode {
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];

  get parentElement(): FakeElement | null {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }

  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  set textContent(text: string) {
    this.replaceChildren();
    if (text !== '') this.appendChild(new FakeText(text));
  }

  appendChild(node: FakeNode): FakeNode {
    return this.insertBefore(node, null);
  }

  insertBefore(node: FakeNode, before: FakeNode | null): FakeNode {
    const nodes = node instanceof FakeFragment ? node.childNodes.slice() : [node];
    for (const child of nodes) child.remove();
    const at = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    this.childNodes.splice(at, 0, ...nodes);
    for (const child of nodes) child.parentNode = this;
    return node;
  }

  before(node: FakeNode): void {
    this.parentNode?.insertBefore(node, this);
  }

  replaceChildren(): void {
    for (const child of this.childNodes.slice()) child.remove();
  }

  remove(): void {
    if (!this.parentNode) return;
    this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
}

/**
 * A text node.
 */
export class FakeText extends FakeNode {
  data: string;

  constructor(data: string) {
    super();
    this.data = data;
  }

  override get textContent(): string {
    return this.data;
  }
}

/**
 * A comment node, the anchor a reactive region sits between.
 */
export class FakeComment extends FakeNode {
  override get textContent(): string {
    return '';
  }
}

/**
 * A document fragment, whose children move into the parent on insert.
 */
export class FakeFragment extends FakeNode {}

/**
 * An element with attributes, a class list, and an inline style, but no layout and no events.
 */
export class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly classList = new Set<string>() as Set<string> & {
    toggle: (name: string, force?: boolean) => void;
  };
  readonly style: Record<string, string> = {};
  readonly offsetHeight = 0;

  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
    this.classList.toggle = (name, force) => {
      if (force ?? !this.classList.has(name)) this.classList.add(name);
      else this.classList.delete(name);
    };
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(): void {}

  removeEventListener(): void {}
}

/**
 * The first element under `root`, depth first, that `match` accepts.
 */
export function findElement(
  root: FakeNode,
  match: (element: FakeElement) => boolean,
): FakeElement | undefined {
  for (const child of root.childNodes) {
    if (child instanceof FakeElement && match(child)) return child;
    const found = findElement(child, match);
    if (found) return found;
  }
  return undefined;
}

/**
 * The observed targets of every live `ResizeObserver`, so a test can report a size to them.
 */
const resizeTargets = new Map<object, (entries: { contentRect: { width: number } }[]) => void>();

/**
 * Reports `width` as the content width of `target` to every observer watching it.
 */
export function resizeTo(target: object, width: number): void {
  resizeTargets.get(target)?.([{ contentRect: { width } }]);
}

/**
 * Whether `element`'s `class` attribute lists `name`.
 */
export function hasClass(element: FakeElement, name: string): boolean {
  return (element.getAttribute('class') ?? '').split(' ').includes(name);
}

Object.assign(globalThis, {
  Node: FakeNode,
  Text: FakeText,
  Element: FakeElement,
  HTMLElement: FakeElement,
  CSSStyleSheet: class {
    replaceSync(): void {}
  },
  ResizeObserver: class {
    #targets: object[] = [];
    #callback: (entries: { contentRect: { width: number } }[]) => void;
    constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
      this.#callback = callback;
    }
    observe(target: object): void {
      this.#targets.push(target);
      resizeTargets.set(target, this.#callback);
    }
    disconnect(): void {
      for (const target of this.#targets) resizeTargets.delete(target);
    }
  },
  MutationObserver: class {
    observe(): void {}
    disconnect(): void {}
  },
  document: {
    adoptedStyleSheets: [],
    createComment: () => new FakeComment(),
    createTextNode: (data: string) => new FakeText(data),
    createDocumentFragment: () => new FakeFragment(),
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_: string, tag: string) => new FakeElement(tag),
  },
});
