import React from 'react';
import { X, Activity, MemoryStick, HardDrive, Zap, Cpu } from 'lucide-react';
import { useUIStore, MetricsSnapshot } from '../../store/ui.store';

interface ResourcePanelProps {
    width: number;
    isResizing: boolean;
}

// ── Area Sparkline ─────────────────────────────────────────────────────────────

interface SparklineProps {
    history: MetricsSnapshot[];
    getValue: (s: MetricsSnapshot) => number | null;
    color: string;
    label: string;
    icon: React.ReactNode;
    currentValue: string;
    maxLabel: string;
    maxValue: number;
    accentBg: string;
}

const AreaSparkline: React.FC<SparklineProps> = ({
    history, getValue, color, label, icon, currentValue, maxLabel, maxValue, accentBg,
}) => {
    const raw = history.map(getValue);
    const points = raw.filter((v): v is number => v !== null);

    // Pad with zeros so we always have at least 20 data points rendered
    const padLen = Math.max(0, 20 - points.length);
    const data = [...Array(padLen).fill(0), ...points];

    const absMax = maxValue;
    const W = 260;
    const H = 64;
    const step = W / Math.max(data.length - 1, 1);

    // Polyline coordinates
    const coords = data.map((v, i) => ({
        x: +(i * step).toFixed(1),
        y: +(H - (v / absMax) * H * 0.88).toFixed(1),
    }));

    const pointsStr = coords.map(c => `${c.x},${c.y}`).join(' ');

    // Area fill path
    const lastC = coords[coords.length - 1];
    const fillPath = coords.length >= 2
        ? `M ${coords.map(c => `${c.x},${c.y}`).join(' L ')} L ${lastC.x},${H} L 0,${H} Z`
        : null;

    const lastVal = data[data.length - 1] ?? 0;
    const pct = Math.min(100, Math.round((lastVal / absMax) * 100));

    // pick color for bar segments
    const barColor = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : color;

    return (
        <div className="rounded-2xl border border-white/5 bg-[#0d0d0f] overflow-hidden">
            {/* Top row */}
            <div className={`flex items-center justify-between px-4 py-3 ${accentBg}`}>
                <div className="flex items-center gap-2.5">
                    <span style={{ color }}>{icon}</span>
                    <span className="text-xs font-bold text-white tracking-tight">{label}</span>
                </div>
                <div className="flex items-baseline gap-1">
                    <span className="text-base font-mono font-bold text-white leading-none">{currentValue}</span>
                    <span className="text-[10px] text-gray-500 font-mono">/ {maxLabel}</span>
                </div>
            </div>

            {/* Chart */}
            <div className="relative w-full" style={{ height: '72px' }}>
                <svg
                    viewBox={`0 0 ${W} ${H}`}
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full"
                >
                    <defs>
                        <linearGradient id={`fill-${label}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
                            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                        </linearGradient>
                    </defs>
                    {/* Grid lines */}
                    {[0.25, 0.5, 0.75].map(f => (
                        <line
                            key={f}
                            x1="0" y1={H * f}
                            x2={W} y2={H * f}
                            stroke="white" strokeOpacity="0.04" strokeWidth="1"
                        />
                    ))}
                    {/* Area fill */}
                    {fillPath && (
                        <path d={fillPath} fill={`url(#fill-${label})`} />
                    )}
                    {/* Line */}
                    <polyline
                        fill="none"
                        stroke={color}
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={pointsStr}
                        style={{ opacity: points.length < 2 ? 0.2 : 1 }}
                    />
                    {/* Glow dot */}
                    {points.length > 0 && (
                        <>
                            <circle
                                cx={lastC.x}
                                cy={lastC.y}
                                r="5"
                                fill={color}
                                opacity="0.2"
                            />
                            <circle
                                cx={lastC.x}
                                cy={lastC.y}
                                r="2.5"
                                fill={color}
                                style={{ filter: `drop-shadow(0 0 5px ${color})` }}
                            />
                        </>
                    )}
                </svg>
            </div>

            {/* Percentage bar */}
            <div className="px-4 pb-3 pt-1 space-y-1.5">
                <div className="flex justify-between items-center text-[10px] font-mono">
                    <span className="text-gray-600">USAGE</span>
                    <span style={{ color: barColor }} className="font-bold">{pct}%</span>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                            width: `${pct}%`,
                            backgroundColor: barColor,
                            boxShadow: `0 0 8px ${barColor}60`,
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

// ── Runtime Toggle ─────────────────────────────────────────────────────────────

const RuntimeToggle: React.FC = () => {
    const { runtimeType, setRuntimeType, kernelStatus } = useUIStore();
    const isConnected = kernelStatus === 'idle' || kernelStatus === 'busy';

    return (
        <div className="space-y-2">
            <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-1">
                Compute Runtime
            </p>

            <div className="relative flex bg-[#111113] rounded-2xl border border-white/5 p-1 gap-1">
                {/* Sliding active indicator */}
                <div
                    className="absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-xl transition-transform duration-300 ease-out"
                    style={{
                        background: 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))',
                        border: '1px solid rgba(239,68,68,0.25)',
                        transform: runtimeType === 'gpu' ? 'translateX(calc(100% + 4px))' : 'translateX(0)',
                    }}
                />

                {/* CPU option */}
                <button
                    onClick={() => setRuntimeType('cpu')}
                    className={`relative flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-colors z-10
            ${runtimeType === 'cpu' ? 'text-sim-red' : 'text-gray-600 hover:text-gray-400'}`}
                >
                    <Cpu className="w-3.5 h-3.5" />
                    <span>CPU</span>
                </button>

                {/* GPU option */}
                <button
                    disabled
                    className={`relative flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-colors z-10 text-gray-700 cursor-not-allowed`}
                    title="GPU Runtime is coming soon"
                >
                    <Zap className="w-3.5 h-3.5" />
                    <span className="flex items-center gap-1.5">
                        GPU
                        <span className="text-[9px] bg-[#27272a] text-gray-400 px-1 py-0.5 rounded uppercase font-bold tracking-widest leading-none">
                            Soon
                        </span>
                    </span>
                </button>
            </div>

            {/* Context explanation */}
            <p className="text-[10px] text-gray-700 font-mono px-1 leading-relaxed">
                {runtimeType === 'gpu'
                    ? 'Cells execute on VRAM via CUDA. Tensors & models load onto GPU memory.'
                    : 'Cells execute on CPU RAM. Standard Python environment.'}
            </p>

            {isConnected && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-950/30 border border-amber-900/30 rounded-xl">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <p className="text-[10px] text-amber-600 font-mono">
                        Restart kernel to apply runtime change
                    </p>
                </div>
            )}
        </div>
    );
};

// ── Main Panel ─────────────────────────────────────────────────────────────────

export const ResourcePanel: React.FC<ResourcePanelProps> = ({ width, isResizing }) => {
    const {
        resourcePanelOpen, setResourcePanelOpen,
        kernelMetrics, metricsHistory, runtimeType, kernelStatus
    } = useUIStore();

    const isGpu = runtimeType === 'gpu';
    const isConnected = kernelStatus === 'idle' || kernelStatus === 'busy';

    const formatMb = (mb: number | null) => {
        if (mb === null) return '--';
        return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(1)} GB`;
    };

    // For VRAM we use memoryMb (the kernel process memory allocation on GPU)
    // For RAM we use the same field (kernel process resident set size on CPU)
    const memLabel = isGpu ? 'VRAM' : 'RAM';
    const memColor = isGpu ? '#a78bfa' : '#0096FF';
    const memMax = isGpu ? 8192 : 16384; // 8 GB VRAM or 16 GB RAM reasonable defaults
    const memMaxLabel = isGpu ? '8 GB' : '16 GB';

    if (!resourcePanelOpen) return null;

    return (
        <div
            className={`shrink-0 overflow-hidden ${isResizing ? '' : 'transition-all duration-300 ease-in-out'}`}
            style={{ width: `${width}px` }}
        >
            <div
                className={`bg-sim-bg flex flex-col z-20 h-full rounded-2xl border border-sim-border overflow-hidden shadow-lg
          ${isResizing ? '' : 'transition-transform duration-300 ease-in-out'}`}
                style={{
                    width: `${width}px`,
                    transform: 'translateX(0)',
                }}
            >
                {/* Header */}
                <div className="h-12 flex items-center justify-between px-4 border-b border-sim-border shrink-0">
                    <div className="flex items-center gap-2.5">
                        <Activity className="w-4 h-4 text-sim-red" />
                        <span className="text-sm font-bold text-white">Notebook Resources</span>
                    </div>
                    <button
                        onClick={() => setResourcePanelOpen(false)}
                        className="p-1.5 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-all"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">

                    {/* Kernel status badge */}
                    <div className="flex items-center gap-3 px-3 py-2.5 bg-[#111113] border border-white/5 rounded-xl">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
                        <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold text-white truncate">
                                {isGpu ? 'GPU · CUDA Kernel' : 'CPU Kernel'}
                            </p>
                            <p className="text-[10px] text-gray-600 font-mono truncate">
                                {isConnected ? `PID ${kernelMetrics.pid ?? '—'} · notebook process only` : 'No kernel connected'}
                            </p>
                        </div>
                        <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border shrink-0
              ${isConnected ? 'text-green-400 border-green-900/60 bg-green-950/30' : 'text-gray-600 border-gray-800 bg-gray-900/30'}`}>
                            {kernelStatus}
                        </span>
                    </div>

                    {/* Memory chart: RAM or VRAM */}
                    <AreaSparkline
                        history={metricsHistory}
                        getValue={s => s.memoryMb}
                        color={memColor}
                        label={memLabel}
                        icon={<MemoryStick className="w-4 h-4" />}
                        currentValue={formatMb(kernelMetrics.memoryMb)}
                        maxLabel={memMaxLabel}
                        maxValue={memMax}
                        accentBg={isGpu ? 'bg-purple-950/20' : 'bg-blue-950/20'}
                    />

                    {/* Disk chart */}
                    <AreaSparkline
                        history={metricsHistory}
                        getValue={s => s.diskMb ?? 0}
                        color="#34d399"
                        label="Disk I/O"
                        icon={<HardDrive className="w-4 h-4" />}
                        currentValue="--"
                        maxLabel="500 MB/s"
                        maxValue={500}
                        accentBg="bg-emerald-950/20"
                    />

                    {/* Runtime switcher */}
                    <RuntimeToggle />

                </div>

                {/* Footer */}
                <div className="p-4 border-t border-sim-border bg-black/20 shrink-0 space-y-2">
                    <div className="flex justify-between text-[11px]">
                        <span className="text-gray-600">Poll interval</span>
                        <span className="font-mono text-gray-400">3 s</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                        <span className="text-gray-600">History</span>
                        <span className="font-mono text-gray-400">{metricsHistory.length} snapshots</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                        <span className="text-gray-600">Source</span>
                        <span className="font-mono text-gray-400">notebook kernel only</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
