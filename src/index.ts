/**
 * Public surface. Internal modules (constants, dom, types, measure, fit,
 * visibility, schedule, observers) stay un-exported.
 */
export { vFitChildren, default } from './directive'
export type {
  FitChildrenEventDetail,
  FitChildrenFitState,
  FitChildrenOptions,
} from './types'
