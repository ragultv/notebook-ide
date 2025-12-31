# File System API - Handle project files, data uploads, and persistence
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
import os
import json
import shutil
from pathlib import Path
from datetime import datetime

router = APIRouter()

# Store current project path
_current_project: Optional[str] = None

class ProjectInfo(BaseModel):
    path: str
    name: str

class FileItem(BaseModel):
    name: str
    path: str
    type: str  # 'file' or 'directory'
    size: Optional[int] = None
    modified: Optional[str] = None
    extension: Optional[str] = None

class FileContent(BaseModel):
    path: str
    content: str
    encoding: Optional[str] = "utf-8"

class SaveFileRequest(BaseModel):
    path: str
    content: str

class CreateFolderRequest(BaseModel):
    path: str
    name: str

class RenameRequest(BaseModel):
    oldPath: str
    newPath: str

# Allowed data file extensions for ML
DATA_EXTENSIONS = {'.csv', '.json', '.xlsx', '.xls', '.parquet', '.pkl', '.pickle', 
                   '.npy', '.npz', '.h5', '.hdf5', '.txt', '.tsv', '.xml', '.yaml', '.yml'}
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp'}
MODEL_EXTENSIONS = {'.pt', '.pth', '.onnx', '.pb', '.h5', '.keras', '.joblib', '.pkl'}

def get_file_info(file_path: Path) -> FileItem:
    """Get file information."""
    stat = file_path.stat()
    return FileItem(
        name=file_path.name,
        path=str(file_path),
        type='directory' if file_path.is_dir() else 'file',
        size=stat.st_size if file_path.is_file() else None,
        modified=datetime.fromtimestamp(stat.st_mtime).isoformat(),
        extension=file_path.suffix.lower() if file_path.is_file() else None
    )

@router.get('/project')
async def get_current_project():
    """Get current project info."""
    if not _current_project:
        return {"project": None}
    return {
        "project": {
            "path": _current_project,
            "name": os.path.basename(_current_project)
        }
    }

@router.post('/project/open')
async def open_project(project: ProjectInfo):
    """Open/set a project folder."""
    global _current_project
    
    path = project.path
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"Path not found: {path}")
    
    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail="Path must be a directory")
    
    _current_project = path
    
    # Create standard project structure if it doesn't exist
    for folder in ['notebooks', 'data', 'models', 'outputs']:
        folder_path = os.path.join(path, folder)
        if not os.path.exists(folder_path):
            os.makedirs(folder_path)
    
    return {
        "status": "ok",
        "project": {
            "path": path,
            "name": os.path.basename(path)
        }
    }

@router.post('/project/create')
async def create_project(project: ProjectInfo):
    """Create a new project folder with standard structure."""
    global _current_project
    
    path = project.path
    
    if os.path.exists(path):
        raise HTTPException(status_code=400, detail="Project folder already exists")
    
    try:
        os.makedirs(path)
        
        # Create standard ML project structure
        for folder in ['notebooks', 'data', 'models', 'outputs', 'src']:
            os.makedirs(os.path.join(path, folder))
        
        # Create a default notebook
        default_notebook = {
            "cells": [
                {
                    "id": "cell-1",
                    "type": "markdown",
                    "content": f"# {project.name}\n\nWelcome to your new ML project!"
                },
                {
                    "id": "cell-2", 
                    "type": "code",
                    "content": "# Install required packages\n!pip install pandas numpy matplotlib scikit-learn"
                },
                {
                    "id": "cell-3",
                    "type": "code",
                    "content": "import pandas as pd\nimport numpy as np\nimport matplotlib.pyplot as plt"
                }
            ],
            "metadata": {
                "name": "main.ipynb",
                "created": datetime.now().isoformat()
            }
        }
        
        notebook_path = os.path.join(path, 'notebooks', 'main.ipynb')
        with open(notebook_path, 'w') as f:
            json.dump(default_notebook, f, indent=2)
        
        _current_project = path
        
        return {
            "status": "ok",
            "project": {
                "path": path,
                "name": project.name
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/list')
async def list_files(path: Optional[str] = None):
    """List files in a directory."""
    if path:
        target_path = Path(path)
    elif _current_project:
        target_path = Path(_current_project)
    else:
        raise HTTPException(status_code=400, detail="No path specified and no project open")
    
    if not target_path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {target_path}")
    
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path must be a directory")
    
    items = []
    try:
        for item in sorted(target_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            # Skip hidden files and __pycache__
            if item.name.startswith('.') or item.name == '__pycache__':
                continue
            items.append(get_file_info(item))
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")
    
    return {"path": str(target_path), "items": items}

@router.get('/read')
async def read_file(path: str):
    """Read file content."""
    file_path = Path(path)
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    
    # Check if it's a binary file
    ext = file_path.suffix.lower()
    if ext in IMAGE_EXTENSIONS or ext in MODEL_EXTENSIONS or ext in {'.pkl', '.pickle', '.npy', '.npz'}:
        raise HTTPException(status_code=400, detail="Cannot read binary file as text")
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        return {
            "path": str(file_path),
            "content": content,
            "size": file_path.stat().st_size
        }
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Cannot decode file as UTF-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/preview/csv')
async def preview_csv(path: str, limit: int = 100):
    """Preview CSV file data."""
    file_path = Path(path)
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    
    if file_path.suffix.lower() != '.csv':
        raise HTTPException(status_code=400, detail="Not a CSV file")
    
    try:
        import pandas as pd
        df = pd.read_csv(file_path, nrows=limit)
        
        return {
            "path": str(file_path),
            "headers": df.columns.tolist(),
            "rows": df.values.tolist(),
            "totalRows": len(df),
            "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()}
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/preview/excel')
async def preview_excel(path: str, sheet: str = None, limit: int = 100):
    """Preview Excel file data."""
    file_path = Path(path)
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    
    if file_path.suffix.lower() not in ['.xlsx', '.xls']:
        raise HTTPException(status_code=400, detail="Not an Excel file")
    
    try:
        import pandas as pd
        
        # Get sheet names
        xl = pd.ExcelFile(file_path)
        sheets = xl.sheet_names
        
        # Read specified sheet or first sheet
        sheet_name = sheet if sheet and sheet in sheets else sheets[0]
        df = pd.read_excel(file_path, sheet_name=sheet_name, nrows=limit)
        
        return {
            "path": str(file_path),
            "sheets": sheets,
            "currentSheet": sheet_name,
            "headers": df.columns.tolist(),
            "rows": df.fillna('').values.tolist(),
            "totalRows": len(df),
            "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()}
        }
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl required. Install with: pip install openpyxl")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/save')
async def save_file(request: SaveFileRequest):
    """Save file content."""
    file_path = Path(request.path)
    
    # Ensure parent directory exists
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(request.content)
        
        return {
            "status": "ok",
            "path": str(file_path),
            "size": file_path.stat().st_size
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/upload')
async def upload_file(
    file: UploadFile = File(...),
    destination: str = Form(...)
):
    """Upload a data file."""
    dest_path = Path(destination)
    
    # Ensure destination directory exists
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        with open(dest_path, 'wb') as f:
            content = await file.read()
            f.write(content)
        
        return {
            "status": "ok",
            "path": str(dest_path),
            "name": file.filename,
            "size": len(content)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/upload-multiple')
async def upload_multiple_files(
    files: List[UploadFile] = File(...),
    destination: str = Form(...)
):
    """Upload multiple data files."""
    dest_dir = Path(destination)
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    results = []
    for file in files:
        try:
            file_path = dest_dir / file.filename
            with open(file_path, 'wb') as f:
                content = await file.read()
                f.write(content)
            results.append({
                "status": "ok",
                "path": str(file_path),
                "name": file.filename,
                "size": len(content)
            })
        except Exception as e:
            results.append({
                "status": "error",
                "name": file.filename,
                "error": str(e)
            })
    
    return {"results": results}

@router.delete('/delete')
async def delete_file(path: str):
    """Delete a file or folder."""
    target_path = Path(path)
    
    if not target_path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {path}")
    
    try:
        if target_path.is_dir():
            shutil.rmtree(target_path)
        else:
            target_path.unlink()
        
        return {"status": "ok", "deleted": str(target_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/create-folder')
async def create_folder(request: CreateFolderRequest):
    """Create a new folder."""
    folder_path = Path(request.path) / request.name
    
    if folder_path.exists():
        raise HTTPException(status_code=400, detail="Folder already exists")
    
    try:
        folder_path.mkdir(parents=True)
        return {"status": "ok", "path": str(folder_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/rename')
async def rename_file(request: RenameRequest):
    """Rename a file or folder."""
    old_path = Path(request.oldPath)
    new_path = Path(request.newPath)
    
    if not old_path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {request.oldPath}")
    
    if new_path.exists():
        raise HTTPException(status_code=400, detail="Destination already exists")
    
    try:
        old_path.rename(new_path)
        return {"status": "ok", "oldPath": str(old_path), "newPath": str(new_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/download')
async def download_file(path: str):
    """Download a file."""
    file_path = Path(path)
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    
    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type='application/octet-stream'
    )

@router.get('/raw')
async def serve_raw_file(path: str):
    """Serve a file with proper MIME type (for images, etc.)."""
    file_path = Path(path)
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    
    # Determine media type based on extension
    ext = file_path.suffix.lower()
    media_types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        '.pdf': 'application/pdf',
        '.json': 'application/json',
        '.csv': 'text/csv',
        '.txt': 'text/plain',
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
    }
    
    media_type = media_types.get(ext, 'application/octet-stream')
    
    return FileResponse(
        path=str(file_path),
        media_type=media_type
    )

# Notebook-specific endpoints
@router.post('/notebook/save')
async def save_notebook(request: SaveFileRequest):
    """Save a notebook file (.ipynb format)."""
    file_path = Path(request.path)
    
    if not file_path.suffix == '.ipynb':
        file_path = file_path.with_suffix('.ipynb')
    
    # Ensure parent directory exists
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        # Parse and validate notebook content
        notebook_data = json.loads(request.content)
        
        # Add metadata
        if 'metadata' not in notebook_data:
            notebook_data['metadata'] = {}
        notebook_data['metadata']['modified'] = datetime.now().isoformat()
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(notebook_data, f, indent=2)
        
        return {
            "status": "ok",
            "path": str(file_path),
            "size": file_path.stat().st_size
        }
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/notebook/open')
async def open_notebook(path: str):
    """Open a notebook file."""
    file_path = Path(path)
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Notebook not found: {path}")
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = json.load(f)
        
        return {
            "path": str(file_path),
            "name": file_path.name,
            "content": content
        }
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid notebook format: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/recent')
async def get_recent_projects():
    """Get list of recent projects from config."""
    config_path = Path.home() / '.notebook-ide' / 'recent.json'
    
    if not config_path.exists():
        return {"recent": []}
    
    try:
        with open(config_path, 'r') as f:
            data = json.load(f)
        return {"recent": data.get('projects', [])}
    except:
        return {"recent": []}

@router.post('/recent/add')
async def add_recent_project(project: ProjectInfo):
    """Add a project to recent list."""
    config_dir = Path.home() / '.notebook-ide'
    config_dir.mkdir(exist_ok=True)
    config_path = config_dir / 'recent.json'
    
    recent = []
    if config_path.exists():
        try:
            with open(config_path, 'r') as f:
                data = json.load(f)
                recent = data.get('projects', [])
        except:
            pass
    
    # Add to front, remove duplicates
    new_entry = {"path": project.path, "name": project.name, "opened": datetime.now().isoformat()}
    recent = [p for p in recent if p.get('path') != project.path]
    recent.insert(0, new_entry)
    recent = recent[:10]  # Keep only 10 recent
    
    with open(config_path, 'w') as f:
        json.dump({"projects": recent}, f, indent=2)
    
    return {"status": "ok", "recent": recent}
