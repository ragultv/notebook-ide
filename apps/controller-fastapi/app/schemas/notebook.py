from pydantic import BaseModel
from typing import List

class CellSchema(BaseModel):
    id: str
    source: str

class NotebookSchema(BaseModel):
    id: str
    cells: List[CellSchema]
