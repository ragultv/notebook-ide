import v1State from '@jupyter-widgets/schema/v1/state.schema.json';
import v1View from '@jupyter-widgets/schema/v1/view.schema.json';
import v2State from '@jupyter-widgets/schema/v2/state.schema.json';
import v2View from '@jupyter-widgets/schema/v2/view.schema.json';

if (typeof window !== 'undefined') {
  (window as any).require = function(mod: string) {
    if (mod === '@jupyter-widgets/schema') {
      return {
        v1: { state: v1State, view: v1View },
        v2: { state: v2State, view: v2View }
      };
    }
    console.warn('[Vite Polyfill] require called for:', mod);
    return {};
  };
}
