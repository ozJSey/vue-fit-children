/**
 * Attribute names, the event name and the two tuning numbers. Leaf module —
 * imports nothing.
 */

export const DEFAULT_OFFSET_PX = 50

export const DECORATIVE_ATTR = 'data-v-fit-decorative'
export const HIDDEN_ATTR = 'data-v-fit-hidden'
export const KEEP_ATTR = 'data-v-fit-keep'
export const STATE_ATTR = 'data-v-fit-state'
export const STYLE_ATTR = 'data-v-fit-style'

export const EVENT_NAME = 'fit-children-updated'

/**
 * Sub-pixel slack. Layout resolves to 1/64px, so an exact `<=` can reject a run
 * that fits by 0.002px and drop a whole chip. Half a pixel is far below any real
 * child, so it can never admit one that genuinely overflows.
 */
export const EPSILON = 0.5
