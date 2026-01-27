from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import sys
from pathlib import Path

# Add kernel-python directory to path
kernel_path = Path(__file__).parent.parent.parent / "kernel-python"
sys.path.insert(0, str(kernel_path))

from .api import execution, kernels, ai, files, models, memory
from kernel_manager import kernel_manager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown - cleanup kernel
    await kernel_manager.stop()

app = FastAPI(title="Notebook IDE Controller", lifespan=lifespan)

# CORS for desktop UI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(execution.router, prefix="/execution", tags=["execution"])
app.include_router(kernels.router, prefix="/kernels", tags=["kernels"])
app.include_router(ai.router, prefix="/ai", tags=["ai"])
app.include_router(files.router, prefix="/files", tags=["files"])
app.include_router(models.router, prefix="/ai", tags=["ai-models"])
app.include_router(memory.router, tags=["memory"])

@app.get('/')
def root():
    return {"status": "ok", "service": "notebook-ide-controller"}
