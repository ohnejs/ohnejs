import type { NodeLike } from '../../../src/utils/index.ts';

/**
 * An element node, named uppercase as the DOM names an HTML element.
 */
export function el(tag: string, attrs: Record<string, string>, ...children: NodeLike[]): NodeLike {
  return {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    nodeValue: null,
    childNodes: children,
    getAttribute: (name) => attrs[name] ?? null,
  };
}

/**
 * A text node.
 */
export function text(value: string): NodeLike {
  return { nodeType: 3, nodeName: '#text', nodeValue: value, childNodes: [] };
}

/**
 * A comment node, which a walker skips.
 */
export function comment(value: string): NodeLike {
  return { nodeType: 8, nodeName: '#comment', nodeValue: value, childNodes: [] };
}

/**
 * The JSON shape of a stored node tree: a `NodeLike` whose attributes sit in a record.
 */
export interface JSONNode {
  nodeType: number;
  nodeName: string;
  nodeValue?: string | null;
  attributes?: Record<string, string>;
  childNodes?: JSONNode[];
}

/**
 * A node tree read back from its JSON shape, as a fixture captured from a browser.
 */
export function nodeOf(json: JSONNode): NodeLike {
  const node: NodeLike = {
    nodeType: json.nodeType,
    nodeName: json.nodeName,
    nodeValue: json.nodeValue ?? null,
    childNodes: (json.childNodes ?? []).map(nodeOf),
  };
  if (json.nodeType !== 1) return node;
  const attributes = json.attributes ?? {};
  return { ...node, getAttribute: (name) => attributes[name] ?? null };
}
