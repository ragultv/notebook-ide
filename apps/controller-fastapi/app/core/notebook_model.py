from pydantic import BaseModel
from typing import List

class Cell(BaseModel):
    id: str
    source: str

class Notebook(BaseModel):
    id: str
    cells: List[Cell]
