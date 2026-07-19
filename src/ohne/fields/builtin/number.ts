import { defineField } from '../define-field.ts';

/**
 * The built-in `number` field type: a finite IEEE 754 double, exactly what a JS number holds.
 * `NaN` and the infinities fail the base-type gate; every accepted value stores bit-exact.
 * Never money: a decimal tenth has no exact binary form - use `integer` minor units instead.
 */
export const number = defineField({ columnType: 'real' });
