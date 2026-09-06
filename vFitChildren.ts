/**
 * Build entry point — re-exports the public surface from `src/`.
 *
 * The split keeps each concern in a single-purpose module (types / constants /
 * dom / measure / fit / visibility / schedule / observers / directive) without
 * changing the bundle: tsup follows this entry and emits the same minified
 * file. See ARCHITECTURE.md for the module map and the invariant it protects.
 */
export { vFitChildren, default } from './src'
export type {
  FitChildrenEventDetail,
  FitChildrenFitState,
  FitChildrenOptions,
} from './src'
