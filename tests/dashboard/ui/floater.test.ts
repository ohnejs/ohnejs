import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  type PlaceInput,
  type Placement,
  placeFloating,
} from '../../../src/dashboard/ui/floater-place.ts';

const FLOATER_PLACEMENTS: Placement[] = ['bottom-start', 'bottom-end', 'top-start', 'top-end'];

function floaterInput(overrides: Partial<PlaceInput> = {}): PlaceInput {
  return {
    reference: { x: 10, y: 10, width: 100, height: 20 },
    floating: { width: 200, height: 300 },
    viewport: { width: 1000, height: 800 },
    allowedPlacements: FLOATER_PLACEMENTS,
    offset: 7,
    shiftPadding: 8,
    sizePadding: 8,
    ...overrides,
  };
}

describe('floater placement', () => {
  it('hugs below, start-aligned, with room to spare', () => {
    const placed = placeFloating(floaterInput());
    strictEqual(placed.placement, 'bottom-start');
    strictEqual(placed.x, 10);
    strictEqual(placed.y, 37);
    strictEqual(placed.availableHeight, 755);
    strictEqual(placed.availableWidth, 982);
  });

  it('rises above when the space below is cramped', () => {
    const placed = placeFloating(
      floaterInput({
        reference: { x: 10, y: 700, width: 100, height: 20 },
        floating: { width: 150, height: 200 },
      }),
    );
    strictEqual(placed.placement, 'top-start');
    strictEqual(placed.x, 10);
    strictEqual(placed.y, 493);
  });

  it('ignores the offset gap when choosing the placement', () => {
    const placed = placeFloating(
      floaterInput({
        reference: { x: 10, y: 100, width: 100, height: 20 },
        floating: { width: 200, height: 680 },
      }),
    );
    strictEqual(placed.placement, 'bottom-start');
    strictEqual(placed.y, 127);
  });

  it('end-aligns when the start alignment would poke past the edge', () => {
    const placed = placeFloating(
      floaterInput({
        reference: { x: 850, y: 10, width: 100, height: 20 },
        floating: { width: 300, height: 100 },
      }),
    );
    strictEqual(placed.placement, 'bottom-end');
    strictEqual(placed.x, 650);
    strictEqual(placed.y, 37);
  });

  it('slides along the cross axis to keep the viewport padding', () => {
    const placed = placeFloating(
      floaterInput({
        reference: { x: 2, y: 10, width: 40, height: 20 },
        floating: { width: 100, height: 50 },
        viewport: { width: 300, height: 400 },
      }),
    );
    strictEqual(placed.placement, 'bottom-start');
    strictEqual(placed.x, 8);
  });

  it('measures the clamp space when nothing fits', () => {
    const placed = placeFloating(floaterInput({ floating: { width: 200, height: 900 } }));
    strictEqual(placed.placement, 'bottom-start');
    strictEqual(placed.availableHeight, 755);
  });

  it('leaves room for the gap in the space it reports above the reference', () => {
    const input = floaterInput({
      reference: { x: 10, y: 700, width: 100, height: 20 },
      floating: { width: 200, height: 900 },
    });
    const measured = placeFloating(input);
    strictEqual(measured.placement, 'top-start');
    strictEqual(measured.availableHeight, 685);

    const clamped = placeFloating({
      ...input,
      floating: { width: 200, height: measured.availableHeight },
    });
    strictEqual(clamped.y, 8);
  });
});

describe('tooltip placement', () => {
  it('centers above the reference when it fits', () => {
    const placed = placeFloating({
      reference: { x: 450, y: 300, width: 100, height: 20 },
      floating: { width: 200, height: 40 },
      viewport: { width: 1000, height: 600 },
      placement: 'top',
      flip: true,
      offset: 10,
    });
    strictEqual(placed.placement, 'top');
    strictEqual(placed.x, 400);
    strictEqual(placed.y, 250);
    strictEqual(placed.arrowOffset, 100);
  });

  it('flips below when the top is out of room', () => {
    const placed = placeFloating({
      reference: { x: 450, y: 5, width: 100, height: 20 },
      floating: { width: 200, height: 40 },
      viewport: { width: 1000, height: 600 },
      placement: 'top',
      flip: true,
      offset: 10,
    });
    strictEqual(placed.placement, 'bottom');
    strictEqual(placed.x, 400);
    strictEqual(placed.y, 35);
  });

  it('keeps the arrow over the reference after a shift', () => {
    const placed = placeFloating({
      reference: { x: 0, y: 300, width: 20, height: 20 },
      floating: { width: 100, height: 40 },
      viewport: { width: 1000, height: 600 },
      placement: 'top',
      flip: true,
      offset: 10,
    });
    strictEqual(placed.x, 0);
    strictEqual(placed.arrowOffset, 10);
  });
});
