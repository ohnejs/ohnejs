/**
 * The shape of a DOM node that a pure walker reads, so it runs in Node and over plain objects in tests.
 * A real DOM `Node` satisfies it as it is: an element has `getAttribute`, and a text node its `nodeValue`.
 *
 * @example
 * ```ts
 * const text: NodeLike = { nodeType: 3, nodeName: '#text', nodeValue: 'Hi', childNodes: [] }
 * const paragraph: NodeLike = {
 *   nodeType: 1,
 *   nodeName: 'P',
 *   nodeValue: null,
 *   childNodes: [text],
 *   getAttribute: () => null,
 * }
 * ```
 */
export interface NodeLike {
  /**
   * The node's type, where `1` is an element and `3` is text.
   */
  nodeType: number;

  /**
   * The element's tag name as the DOM reports it, uppercase for an HTML element, or `#text` for text.
   */
  nodeName: string;

  /**
   * The text of a text node, and `null` for an element.
   */
  nodeValue: string | null;

  /**
   * The node's children, in order.
   */
  childNodes: Iterable<NodeLike>;

  /**
   * Reads an attribute of an element, as `null` when it is not set.
   * A text node has no attributes and no such method.
   */
  getAttribute?(name: string): string | null;
}
