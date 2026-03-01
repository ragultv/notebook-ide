/**
 * Widget Service — manages ipywidgets comm protocol and rendering.
 *
 * Key insight: @jupyter-widgets/html-manager's loadClass() uses synchronous
 * require() which does NOT work in Vite (ESM environment). We must patch it
 * to use dynamic import() before creating any models.
 *
 */

import { HTMLManager } from '@jupyter-widgets/html-manager';

// ── State ─────────────────────────────────────────────────────────────────────

const widgetModels = new Map<string, any>();
const msgHandlers = new Map<string, Function>();
const closeHandlers = new Map<string, Function>();

let managerPromise: Promise<HTMLManager> | null = null;
let manager: HTMLManager | null = null; // synchronous reference for debug

type WidgetCallback = (commId: string, data?: any) => void;
const stateChangeCallbacks = new Set<WidgetCallback>();

// ── Module cache for patched loader ──────────────────────────────────────────

let controlsModule: any = null;
let baseModule: any = null;
let outputModule: any = null;

async function preloadWidgetModules() {
    if (!controlsModule) controlsModule = await import('@jupyter-widgets/controls');
    if (!baseModule) baseModule = await import('@jupyter-widgets/base');
    if (!outputModule) outputModule = await import('@jupyter-widgets/output');
}

// ── Manager ───────────────────────────────────────────────────────────────────

export function getWidgetManager(): Promise<HTMLManager> {
    if (managerPromise) return managerPromise;

    managerPromise = (async () => {
        // Preload all modules so synchronous require() calls below have cached values
        await preloadWidgetModules();

        const mgr = new HTMLManager();

        // Patch loadClass to use our pre-loaded ESM modules instead.
        (mgr as any).loadClass = async (
            className: string,
            moduleName: string,
            _moduleVersion: string
        ): Promise<any> => {
            let mod: any;

            console.log(`[WidgetService] loadClass requested: ${moduleName} - ${className}`);

            if (moduleName === '@jupyter-widgets/controls') {
                mod = controlsModule;
            } else if (moduleName === '@jupyter-widgets/base') {
                mod = baseModule;
            } else if (moduleName === '@jupyter-widgets/output') {
                mod = outputModule;
            } else {
                console.error(`[WidgetService] Unknown widget module: ${moduleName}`);
                throw new Error(`[WidgetService] Unknown widget module: ${moduleName}`);
            }

            const cls = mod[className] ?? mod?.default?.[className];
            if (!cls) {
                console.error(`[WidgetService] Class "${className}" not found in ${moduleName}`);
                console.log(`[WidgetService] Available exports in ${moduleName}:`, Object.keys(mod));
                throw new Error(`[WidgetService] Class "${className}" not found in ${moduleName}`);
            }
            console.log(`[WidgetService] Successfully loaded class: ${className}`);
            return cls;
        };

        manager = mgr;
        return mgr;
    })();

    return managerPromise;
}

// ── Comm Protocol ─────────────────────────────────────────────────────────────

/**
 * Handle comm_open — creates a widget model for each widget the kernel declares.
 * Called for ALL sub-widgets (VBox, Button, HTML, Label…).
 * Only the ROOT widget is displayed via display_data MIME in the output stream.
 */
export async function handleCommOpen(
    commId: string,
    targetName: string,
    data: any,
    _metadata: any,
    sendCommMsg: (commId: string, data: any) => void
): Promise<any | null> {
    const validTargets = ['jupyter.widget', 'jupyter.widget.version'];
    if (!validTargets.includes(targetName)) return null;

    if (widgetModels.has(commId)) return widgetModels.get(commId);

    try {
        const mgr = await getWidgetManager();
        const state = data?.state ?? {};

        console.log(`[WidgetService] comm_open ${commId} → ${state._model_module}.${state._model_name}`);

        const model = await mgr.new_model(
            {
                model_name: state._model_name ?? 'DOMWidgetModel',
                model_module: state._model_module ?? '@jupyter-widgets/base',
                model_module_version: state._model_module_version ?? '*',
                model_id: commId,
                comm: {
                    comm_id: commId,
                    target_name: targetName,
                    send: (msgData: any) => sendCommMsg(commId, msgData),
                    close: () => { closeHandlers.get(commId)?.(); },
                    // Bug 3 fix: store and call the widget's own message handler.
                    on_msg: (handler: Function) => { msgHandlers.set(commId, handler); },
                    on_close: (handler: Function) => { closeHandlers.set(commId, handler); },
                } as any,
            },
            state
        );

        widgetModels.set(commId, model);
        // Notify waitForModel subscribers that this model is ready
        stateChangeCallbacks.forEach(cb => cb(commId));
        return model;

    } catch (err) {
        console.error(`[WidgetService] handleCommOpen failed for ${commId}:`, err);
        return null;
    }
}

/**
 * Handle comm_msg — update model state and dispatch to the widget's handler.
 *
 * Kernel message format: { method: 'update', state: {...} }
 * Widget._handle_comm_msg reads: msg.content.data.method
 * So we wrap:                    { content: { data: rawData }, buffers: [] }
 */
export function handleCommMsg(commId: string, data: any): void {
    const model = widgetModels.get(commId);
    if (!model) {
        console.warn(`[WidgetService] comm_msg for unknown model: ${commId}`);
        return;
    }
    try {
        if (data?.method === 'update') {
            model.set_state(data.state ?? {});
            stateChangeCallbacks.forEach(cb => cb(commId, data.state));
        } else if (data?.method === 'custom') {
            model.trigger('msg:custom', data.content, data.buffers);
        }
        // Call the widget's own registered handler.
        // Wrapper: { content: { data } } because widget reads msg.content.data.method
        const handler = msgHandlers.get(commId);
        if (handler) {
            handler({ content: { data }, buffers: [] });
        }
    } catch (err) {
        console.error(`[WidgetService] comm_msg error ${commId}:`, err);
    }
}

/**
 * Handle comm_close — close model and clean all handlers.
 */
export function handleCommClose(commId: string): void {
    closeHandlers.get(commId)?.();
    const model = widgetModels.get(commId);
    if (model) { try { model.close(); } catch { } }
    widgetModels.delete(commId);
    msgHandlers.delete(commId);
    closeHandlers.delete(commId);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/**
 * Render a widget into `element`.
 *
 * Bug 1 fix: await create_view() BEFORE display_view() (though display_view
 * also awaits internally, being explicit is correct and safe).
 */
export async function createWidgetView(
    commId: string,
    element: HTMLElement
): Promise<any | null> {
    const model = widgetModels.get(commId);
    if (!model) {
        console.warn(`[WidgetService] No model for ${commId}`);
        return null;
    }

    try {
        const mgr = await getWidgetManager();
        const view = await mgr.create_view(model, {});
        await mgr.display_view(view, element);

        console.log(`[WidgetService] Rendered ${commId}`);
        return view;
    } catch (err) {
        console.error(`[WidgetService] Render failed ${commId}:`, err);
        return null;
    }
}

// ── Utils ─────────────────────────────────────────────────────────────────────

export function hasWidget(commId: string): boolean {
    return widgetModels.has(commId);
}

/**
 * Bug 4 fix: wait until a widget model is registered (or timeout).
 * Handles the race where display_data arrives before comm_open completes.
 */
export function waitForModel(
    commId: string,
    timeoutMs: number = 10_000
): Promise<any | null> {
    return new Promise(resolve => {
        if (widgetModels.has(commId)) {
            resolve(widgetModels.get(commId));
            return;
        }

        const unsub = onWidgetStateChange((changedId) => {
            if (changedId !== commId) return;
            unsub();
            clearTimeout(timer);
            resolve(widgetModels.get(commId) ?? null);
        });

        const timer = setTimeout(() => {
            unsub();
            console.warn(`[WidgetService] waitForModel timed out for ${commId}`);
            resolve(null);
        }, timeoutMs);
    });
}

export function getWidgetModel(commId: string): any | undefined {
    return widgetModels.get(commId);
}

export function getActiveWidgetIds(): string[] {
    return [...widgetModels.keys()];
}

export function onWidgetStateChange(callback: WidgetCallback): () => void {
    stateChangeCallbacks.add(callback);
    return () => stateChangeCallbacks.delete(callback);
}

export function cleanupWidgets(): void {
    widgetModels.forEach(model => { try { model.close(); } catch { } });
    widgetModels.clear();
    msgHandlers.clear();
    closeHandlers.clear();
}

/** Debug helper — run in browser console */
export function debugGetRegistry() {
    return {
        managerReady: !!manager,
        registeredIds: [...widgetModels.keys()],
        msgHandlerIds: [...msgHandlers.keys()],
        loadedModules: {
            controls: !!controlsModule,
            base: !!baseModule,
            output: !!outputModule,
        },
    };
}
