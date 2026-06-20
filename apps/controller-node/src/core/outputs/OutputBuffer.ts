import { IOutputDto } from '../notebook/NotebookCommon';

export class OutputBuffer {
    private buffer: IOutputDto[] = [];
    private timeoutId: NodeJS.Timeout | null = null;

    constructor(
        private readonly debounceMs = 10,
        private readonly flushCallback: (outputs: IOutputDto[]) => void
    ) {}

    public push(output: IOutputDto) {
        this.buffer.push(output);

        if (!this.timeoutId) {
            this.timeoutId = setTimeout(() => this.flush(), this.debounceMs);
        }
    }

    public flush() {
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
