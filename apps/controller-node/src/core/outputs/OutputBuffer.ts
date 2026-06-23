export class OutputBuffer<T = any> {
    private buffer: T[] = [];
    private timeoutId: NodeJS.Timeout | null = null;

    constructor(
        private readonly debounceMs = 10,
        private readonly flushCallback: (outputs: T[]) => void,
    ) {}

    public push(output: T): void {
        this.buffer.push(output);
        if (!this.timeoutId) {
            this.timeoutId = setTimeout(() => this.flush(), this.debounceMs);
        }
    }

    public flush(): void {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        if (this.buffer.length > 0) {
            const batch = [...this.buffer];
            this.buffer = [];
            this.flushCallback(batch);
        }
    }
}
