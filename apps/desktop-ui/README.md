# Desktop UI - Notebook IDE

React-based frontend for the Notebook IDE with AI-powered notebook management.

## Architecture

```
┌──────────────────────────────────┐
│ Desktop UI (React + Vite)        │
│                                  │
│ • Notebook editing               │
│ • Cell formatting                │
│ • File explorer (Sidebar)        │
│ • AI Agent (RightSidebar)        │
│                                  │
└───────────────┬──────────────────┘
                │ HTTP / WebSocket
                ▼
┌──────────────────────────────────┐
│ FastAPI Controller (Backend)     │
│                                  │
│ • Notebook CRUD                  │
│ • Execution sequencing           │
│ • Kernel lifecycle               │
│                                  │
└───────────────┬──────────────────┘
                │
                ▼
┌──────────────────────────────────┐
│ Python Kernel Process            │
│ • exec(code, globals)            │
│ • Long-lived memory              │
│ • stdout / stderr capture        │
└──────────────────────────────────┘
```

## Key Features

### AI Agent (Notebook Management ONLY)
- **What it does**: Create notebooks, add/edit/delete cells, organize structure
- **What it doesn't do**: Execute Python code, generate ML models, run computations
- **Service**: `agent.service.ts`

### Code Execution
- **Where**: Python kernel process managed by FastAPI backend
- **How**: HTTP calls to FastAPI `/execution/run_cell` endpoint
- **NOT via AI**: Code execution is deterministic, not AI-generated

## Project Structure

```
src/
├── components/
│   ├── Layout/
│   │   ├── TopBar.tsx          # App header with branding
│   │   ├── Sidebar.tsx         # File explorer + upload
│   │   └── RightSidebar.tsx    # AI chat for notebook ops
│   └── Notebook/
│       ├── Notebook.tsx        # Notebook container
│       ├── Cell.tsx            # Individual cell editor
│       └── AddCellDivider.tsx  # Cell insertion UI
├── services/
│   ├── agent.service.ts        # AI for notebook management
│   ├── controller.client.ts    # FastAPI HTTP client
│   └── filesystem.client.ts    # Local file operations
├── state/
│   └── ui.store.ts             # Zustand state management
├── types.ts                    # TypeScript interfaces
├── App.tsx                     # Main app component
└── index.tsx                   # React entry point
```

## Development

### Install Dependencies
```bash
npm install
```

### Environment Variables
Create `.env.local`:
```
GEMINI_API_KEY=your_google_api_key_here
NVIDIA_API_KEY=your_nvidia_api_key_here
```

### Run Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Build for Production
```bash
npm run build
```

## AI Agent Usage

The AI agent (RightSidebar) helps with **notebook structure only**:

### Examples:
- ✅ "Create a data analysis notebook with 5 sections"
- ✅ "Add a markdown cell explaining the dataset"
- ✅ "Add a code cell to import pandas and numpy"
- ✅ "Delete cell 3"
- ❌ "Execute this code and show me the output" (use Run button instead)
- ❌ "Train a neural network" (write code yourself, then run it)

### Available AI Operations:
- `create_notebook`: Create new .ipynb file
- `add_cell`: Append code/markdown cell
- `edit_cell`: Modify existing cell by index
- `delete_cell`: Remove cell by index
- `delete_notebook`: Delete notebook file

## Code Execution Flow

1. User writes code in a cell
2. Clicks Run button (or Ctrl+Enter)
3. Frontend calls FastAPI: `POST /execution/run_cell`
4. FastAPI forwards to Python kernel subprocess
5. Kernel executes via `exec()`
6. Output (stdout/stderr) returned to frontend
7. Frontend displays result below cell

**No AI involved in execution** - deterministic Python interpreter only.

## Styling

- **Framework**: TailwindCSS
- **Theme**: Dark cyberpunk aesthetic
- **Colors**: Defined in `tailwind.config.js`
  - `sim-bg`: #09090b (background)
  - `sim-surface`: #18181b
  - `sim-border`: #27272a
  - `sim-red`: #ef4444 (accent)

## TODO

- [ ] Wire up `controller.client.ts` to FastAPI backend
- [ ] Implement WebSocket for streaming execution output
- [ ] Add kernel status indicator
- [ ] Support multiple kernels per notebook
- [ ] Add cell output history/versioning
