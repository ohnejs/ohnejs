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
