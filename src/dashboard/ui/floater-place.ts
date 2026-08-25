/**
 * The edge of the reference a floating element attaches to.
 */
export type Side = 'top' | 'bottom' | 'left' | 'right';

/**
 * How a floating element lines up along its side.
 * Omitted on a bare `Side`, the element centers.
 */
export type Alignment = 'start' | 'end';

/**
 * A side with an optional alignment, the floating-ui placement vocabulary.
 */
export type Placement = Side | `${Side}-${Alignment}`;

/**
 * An axis-aligned box in viewport coordinates.
 */
export interface Rect {
  /**
   * The left edge.
   */
  x: number;

  /**
   * The top edge.
   */
  y: number;

  /**
   * The box width.
   */
  width: number;

  /**
   * The box height.
   */
  height: number;
}

/**
 * A measured size.
 */
export interface Dimensions {
  /**
   * The measured width.
   */
  width: number;

  /**
   * The measured height.
   */
  height: number;
}

/**
 * Input for `placeFloating`.
 */
export interface PlaceInput {
  /**
   * The anchor's bounding box in viewport coordinates.
   */
  reference: Rect;

  /**
   * The floating element's measured size.
   */
  floating: Dimensions;

  /**
   * The viewport size the element must stay inside.
   */
  viewport: Dimensions;

  /**
   * The preferred placement.
   * Ignored when `allowedPlacements` picks automatically.
   *
   * @default
   * 'bottom-start'
   */
  placement?: Placement;

  /**
   * When set, the placement with the most main-axis space wins, earlier entries breaking ties.
   * This is floating-ui's `autoPlacement`: the preferred `placement` is ignored entirely.
   */
  allowedPlacements?: Placement[];

  /**
   * Flips to the opposite side when the preferred side overflows and the opposite has more room.
   *
   * @default
   * false
   */
  flip?: boolean;

  /**
   * The main-axis gap between reference and floating element.
   * Applied AFTER the placement choice and the space measurement, exactly as the Pruvious v4
   * middleware order has it - placement decisions ignore the gap.
   *
   * @default
   * 0
   */
  offset?: number;

  /**
   * The minimum distance kept from the viewport edge when sliding along the cross axis.
   *
   * @default
   * 0
   */
  shiftPadding?: number;

  /**
   * The viewport inset used when measuring `availableWidth` and `availableHeight`.
   *
   * @default
   * 0
   */
  sizePadding?: number;
}

/**
 * The computed position of a floating element.
 */
export interface PlaceResult {
  /**
   * The final left edge in viewport coordinates.
   */
  x: number;

  /**
   * The final top edge in viewport coordinates.
   */
  y: number;

  /**
   * The placement the element ended up with.
   */
  placement: Placement;

  /**
   * The width available before the element would poke past the padded viewport.
   * Measured at the pre-offset coordinates, exactly as the Pruvious v4 middleware order has it.
   */
  availableWidth: number;

  /**
   * The height available before the element would poke past the padded viewport.
   * Measured at the pre-offset coordinates, exactly as the Pruvious v4 middleware order has it.
   */
  availableHeight: number;

  /**
   * The reference center's cross-axis distance from the element's cross-axis start.
   * An arrow centered on the reference sits here, minus half its own size, clamped by the caller.
   */
  arrowOffset: number;
}

interface Overflow {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function sideOf(placement: Placement): Side {
  return placement.split('-')[0] as Side;
}

function alignmentOf(placement: Placement): Alignment | null {
  return (placement.split('-')[1] as Alignment | undefined) ?? null;
}

function isVertical(side: Side): boolean {
  return side === 'top' || side === 'bottom';
}

function coordsAt(
  placement: Placement,
  reference: Rect,
  floating: Dimensions,
): { x: number; y: number } {
  const side = sideOf(placement);
  const alignment = alignmentOf(placement);
  if (isVertical(side)) {
    return {
      x:
        alignment === 'start'
          ? reference.x
          : alignment === 'end'
            ? reference.x + reference.width - floating.width
            : reference.x + reference.width / 2 - floating.width / 2,
      y: side === 'top' ? reference.y - floating.height : reference.y + reference.height,
    };
  }
  return {
    x: side === 'left' ? reference.x - floating.width : reference.x + reference.width,
    y:
      alignment === 'start'
        ? reference.y
        : alignment === 'end'
          ? reference.y + reference.height - floating.height
          : reference.y + reference.height / 2 - floating.height / 2,
  };
}

function overflowAt(
  x: number,
  y: number,
  floating: Dimensions,
  viewport: Dimensions,
  padding: number,
): Overflow {
  return {
    top: padding - y,
    right: x + floating.width - (viewport.width - padding),
    bottom: y + floating.height - (viewport.height - padding),
    left: padding - x,
  };
}

function alignedSide(side: Side, alignment: Alignment): Side {
  if (isVertical(side)) return alignment === 'start' ? 'right' : 'left';
  return alignment === 'start' ? 'bottom' : 'top';
}

function pickPlacement(
  allowed: Placement[],
  reference: Rect,
  floating: Dimensions,
  viewport: Dimensions,
): Placement {
  const scored = allowed.map((placement) => {
    const { x, y } = coordsAt(placement, reference, floating);
    const overflow = overflowAt(x, y, floating, viewport, 0);
    const side = sideOf(placement);
    const alignment = alignmentOf(placement);
    const checks = alignment
      ? [overflow[side], overflow[alignedSide(side, alignment)]]
      : isVertical(side)
        ? [overflow[side], overflow.left, overflow.right]
        : [overflow[side], overflow.top, overflow.bottom];
    return { placement, main: overflow[side], fits: checks.every((value) => value <= 0) };
  });
  scored.sort((a, b) => a.main - b.main);
  return (scored.find((entry) => entry.fits) ?? scored[0]!).placement;
}

function opposedPlacement(placement: Placement): Placement {
  const opposite: Record<Side, Side> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  const side = opposite[sideOf(placement)];
  const alignment = alignmentOf(placement);
  return alignment ? `${side}-${alignment}` : side;
}

function flipPlacement(
  preferred: Placement,
  reference: Rect,
  floating: Dimensions,
  viewport: Dimensions,
): Placement {
  const at = coordsAt(preferred, reference, floating);
  const main = overflowAt(at.x, at.y, floating, viewport, 0)[sideOf(preferred)];
  if (main <= 0) return preferred;
  const opposite = opposedPlacement(preferred);
  const oppositeAt = coordsAt(opposite, reference, floating);
  const oppositeMain = overflowAt(oppositeAt.x, oppositeAt.y, floating, viewport, 0)[
    sideOf(opposite)
  ];
  return oppositeMain < main ? opposite : preferred;
}

function availabilityAt(
  placement: Placement,
  x: number,
  y: number,
  floating: Dimensions,
  viewport: Dimensions,
  padding: number,
): { availableWidth: number; availableHeight: number } {
  const overflow = overflowAt(x, y, floating, viewport, padding);
  const side = sideOf(placement);
  const alignment = alignmentOf(placement);
  if (isVertical(side)) {
    const widthSide = alignment === 'end' ? 'left' : 'right';
    return {
      availableWidth: Math.min(
        floating.width - overflow[widthSide],
        floating.width - overflow.left - overflow.right,
      ),
      availableHeight: floating.height - overflow[side],
    };
  }
  const heightSide = alignment === 'end' ? 'top' : 'bottom';
  return {
    availableWidth: floating.width - overflow[side],
    availableHeight: Math.min(
      floating.height - overflow[heightSide],
      floating.height - overflow.top - overflow.bottom,
    ),
  };
}

/**
 * Computes where a floating element goes, ported from the Pruvious v4 floater's floating-ui setup.
 * The pipeline keeps the source's exact middleware order: choose the placement (auto pick or flip),
 * measure the available space, THEN apply the offset, then slide along the cross axis to stay
 * `shiftPadding` from the viewport edge.
 * Pure math over plain rects, so pickers, dropdowns, and tooltips share one engine.
 *
 * @example
 * ```ts
 * placeFloating({
 *   reference: { x: 10, y: 10, width: 100, height: 20 },
 *   floating: { width: 200, height: 300 },
 *   viewport: { width: 1000, height: 800 },
 *   allowedPlacements: ['bottom-start', 'bottom-end', 'top-start', 'top-end'],
 *   offset: 7,
 *   shiftPadding: 8,
 *   sizePadding: 8,
 * })
 * // -> { x: 10, y: 37, placement: 'bottom-start', availableWidth: 982, availableHeight: 762, ... }
 * ```
 */
export function placeFloating(input: PlaceInput): PlaceResult {
  const { reference, floating, viewport } = input;
  const offset = input.offset ?? 0;
  const shiftPadding = input.shiftPadding ?? 0;
  const preferred = input.placement ?? 'bottom-start';
  const placement = input.allowedPlacements
    ? pickPlacement(input.allowedPlacements, reference, floating, viewport)
    : input.flip
      ? flipPlacement(preferred, reference, floating, viewport)
      : preferred;

  let { x, y } = coordsAt(placement, reference, floating);
  const { availableWidth, availableHeight } = availabilityAt(
    placement,
    x,
    y,
    floating,
    viewport,
    input.sizePadding ?? 0,
  );

  const side = sideOf(placement);
  if (side === 'top') y -= offset;
  else if (side === 'bottom') y += offset;
  else if (side === 'left') x -= offset;
  else x += offset;

  if (isVertical(side)) {
    x = Math.max(shiftPadding, Math.min(x, viewport.width - floating.width - shiftPadding));
  } else {
    y = Math.max(shiftPadding, Math.min(y, viewport.height - floating.height - shiftPadding));
  }

  const arrowOffset = isVertical(side)
    ? reference.x + reference.width / 2 - x
    : reference.y + reference.height / 2 - y;

  return { x, y, placement, availableWidth, availableHeight, arrowOffset };
}
