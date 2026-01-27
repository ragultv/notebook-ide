# AI Service - JSON Parsing and Fixing Utilities
import json
import re
from typing import Optional, List, Dict, Any


def fix_deepseek_json(json_str: str) -> str:
    """Fix common JSON issues from DeepSeek models."""
    print(f"\n🔧 Applying DeepSeek JSON fixes...")
    
    # Strategy: Parse character by character, properly tracking JSON string context
    # and escape unescaped quotes within string values
    
    result = []
    i = 0
    in_string = False
    is_key = False  # Are we in a key or value?
    escape_next = False
    brace_depth = 0
    
    while i < len(json_str):
        char = json_str[i]
        
        if escape_next:
            result.append(char)
            escape_next = False
            i += 1
            continue
        
        if char == '\\':
            result.append(char)
            escape_next = True
            i += 1
            continue
        
        # Track brace depth (outside strings)
        if not in_string:
            if char in '{[':
                brace_depth += 1
            elif char in '}]':
                brace_depth -= 1
        
        # Handle quotes
        if char == '"':
            if not in_string:
                # Starting a string
                in_string = True
                # Check if this is a key (look back for { or ,)
                prev_significant = ''.join(result).rstrip()
                is_key = prev_significant.endswith('{') or prev_significant.endswith(',')
                result.append(char)
            else:
                # Potentially ending a string
                # Look ahead to see what comes next
                lookahead = json_str[i+1:i+10].lstrip()
                
                # If we're in a value and the next char is not : or , or } or ],
                # this might be a nested quote
                if not is_key and lookahead and lookahead[0] not in ',:}]':
                    # This is likely a nested quote - escape it
                    result.append('\\"')
                    i += 1
                    continue
                
                # Otherwise, close the string
                in_string = False
                result.append(char)
        elif in_string:
            # Inside a string - escape control chars
            if char == '\n':
                result.append('\\n')
            elif char == '\r':
                result.append('\\r')
            elif char == '\t':
                result.append('\\t')
            else:
                result.append(char)
        else:
            result.append(char)
        
        i += 1
    
    json_str = ''.join(result)
    
    # Now apply structural fixes
    
    # Fix 1: Remove stray closing brackets
    json_str = re.sub(r'\}\]\s*,\s*\n', '},\n', json_str)
    
    # Fix 2: Remove blank lines within arrays
    lines = json_str.split('\n')
    fixed_lines = []
    bracket_depth = 0
    
    for line in lines:
        stripped = line.strip()
        bracket_depth += stripped.count('[') + stripped.count('{')
        bracket_depth -= stripped.count(']') + stripped.count('}')
        
        # Skip blank lines inside arrays
        if not stripped and bracket_depth > 0:
            continue
        
        # Fix }], to },
        if bracket_depth > 0 and re.search(r'\}\]\s*,\s*$', stripped):
            line = re.sub(r'\}\]\s*,\s*$', '},', line)
        
        fixed_lines.append(line)
    
    json_str = '\n'.join(fixed_lines)
    
    # Fix 3: Remove trailing commas
    json_str = re.sub(r',(\s*)\]', r'\1]', json_str)
    json_str = re.sub(r',(\s*)\}', r'\1}', json_str)
    
    # Fix 4: Clean up spacing
    json_str = re.sub(r',\s*\n\s*\n', ',\n', json_str)
    
    print(f"✓ DeepSeek JSON fixes applied")
    print(f"Fixed JSON preview (first 800 chars):\n{json_str[:800]}...")
    return json_str


def fix_json_string(json_str: str) -> str:
    """Fix common JSON formatting issues from LLM outputs by escaping control characters."""
    # First, try a more aggressive approach: escape all unescaped quotes inside string values
    
    # Handle raw control characters
    json_str = json_str.replace('\r\n', '\\n').replace('\r', '\\n')
    
    result = []
    in_string = False
    escape_next = False
    i = 0
    
    while i < len(json_str):
        char = json_str[i]
        
        if escape_next:
            result.append(char)
            escape_next = False
            i += 1
            continue
        
        if char == '\\':
            result.append(char)
            escape_next = True
            i += 1
            continue
        
        # Handle quotes
        if char == '"':
            if not in_string:
                in_string = True
                result.append(char)
            else:
                # Check if this quote ends the string or is a nested quote
                # Look ahead for JSON structure indicators
                remaining = json_str[i+1:i+50] if i+1 < len(json_str) else ""
                remaining_stripped = remaining.lstrip()
                
                # If next non-whitespace char is a JSON structural character, this closes the string
                if remaining_stripped and remaining_stripped[0] in ',}]:':
                    in_string = False
                    result.append(char)
                # Check for key-value separator pattern like ": "
                elif remaining_stripped.startswith(':'):
                    in_string = False
                    result.append(char)
                else:
                    # This is likely a nested quote in code - escape it
                    result.append('\\"')
                    i += 1
                    continue
            i += 1
            continue
        
        # Inside a string, handle control characters
        if in_string:
            if char == '\n':
                result.append('\\n')
            elif char == '\t':
                result.append('\\t')
            else:
                result.append(char)
        else:
            result.append(char)
        
        i += 1
    
    return ''.join(result)


def clean_code_for_json(code: str) -> str:
    """Clean Python code content to be JSON-safe by properly escaping all special chars."""
    # Escape backslashes first
    code = code.replace('\\', '\\\\')
    # Escape quotes
    code = code.replace('"', '\\"')
    # Escape newlines
    code = code.replace('\n', '\\n')
    code = code.replace('\r', '')
    # Escape tabs
    code = code.replace('\t', '\\t')
    return code


def rebuild_operations_json(text: str) -> Optional[List[Dict[str, Any]]]:
    """Try to rebuild operations by extracting structure and cleaning code content."""
    operations = []
    
    # Find each operation object pattern
    type_pattern = r'"type"\s*:\s*"(add_cell|edit_cell|delete_cell|create_notebook|add_package)"'
    
    # Look for operation blocks
    blocks = re.split(r'\}\s*,\s*\{', text)
    
    for block in blocks:
        try:
            # Add back curly braces if split removed them
            if not block.strip().startswith('{'):
                block = '{' + block
            if not block.strip().endswith('}'):
                block = block + '}'
            
            # Try to find type
            type_match = re.search(type_pattern, block)
            if not type_match:
                continue
                
            op_type = type_match.group(1)
            
            # Build a minimal operation
            if op_type == 'add_cell':
                # Find cell type and content
                cell_type_match = re.search(r'"type"\s*:\s*"(code|markdown)"', block[type_match.end():])
                content_match = re.search(r'"content"\s*:\s*"(.*?)(?:"\s*\}|\"\s*,)', block, re.DOTALL)
                
                if cell_type_match and content_match:
                    content = content_match.group(1)
                    # Unescape for processing then re-escape
                    content = content.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                    
                    operations.append({
                        'type': 'add_cell',
                        'params': {
                            'type': cell_type_match.group(1),
                            'content': content
                        }
                    })
                    
            elif op_type == 'edit_cell':
                index_match = re.search(r'"cellIndex"\s*:\s*(\d+)', block)
                content_match = re.search(r'"content"\s*:\s*"(.*?)(?:"\s*\}|\"\s*,)', block, re.DOTALL)
                
                if index_match and content_match:
                    content = content_match.group(1)
                    content = content.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"')
                    
                    operations.append({
                        'type': 'edit_cell',
                        'params': {
                            'cellIndex': int(index_match.group(1)),
                            'content': content
                        }
                    })
                    
        except Exception as e:
            print(f"  Block parsing error: {e}")
            continue
    
    return operations if operations else None


def extract_operations(text: str, model_name: str) -> Optional[List[Dict[str, Any]]]:
    """Extract operations JSON from AI response text."""
    print(f"\n===== EXTRACTING OPERATIONS =====")
    print(f"Full AI Response Text ({len(text)} chars):\n{text}\n")
    
    # Check if using DeepSeek model
    is_deepseek = 'deepseek' in model_name.lower()
    
    # Method 1: Look for ```operations block
    match = re.search(r'```operations\s*\n?([\[\{][\s\S]*?[\]\}])\s*\n?```', text)
    if match:
        try:
            json_str = fix_deepseek_json(match.group(1)) if is_deepseek else fix_json_string(match.group(1))
            ops = json.loads(json_str)
            print(f"✓ Extracted {len(ops)} operations from ```operations block")
            return ops
        except json.JSONDecodeError as e:
            print(f"✗ Failed to parse operations block JSON: {e}")
    
    # Method 2: Look for ```json block
    match = re.search(r'```json\s*\n?([\[\{][\s\S]*?[\]\}])\s*\n?```', text)
    if match:
        try:
            json_str = fix_deepseek_json(match.group(1)) if is_deepseek else fix_json_string(match.group(1))
            ops = json.loads(json_str)
            print(f"✓ Extracted {len(ops)} operations from ```json block")
            return ops
        except json.JSONDecodeError as e:
            print(f"✗ Failed to parse json block JSON: {e}")
            # Try the rebuild approach
            print("  Attempting to rebuild operations from structure...")
            ops = rebuild_operations_json(match.group(1))
            if ops:
                print(f"✓ Rebuilt {len(ops)} operations from structure")
                return ops
    
    # Method 3: Look for any code block with JSON array
    match = re.search(r'```\s*\n?([\[\{][\s\S]*?[\]\}])\s*\n?```', text)
    if match:
        try:
            json_str = fix_deepseek_json(match.group(1)) if is_deepseek else fix_json_string(match.group(1))
            ops = json.loads(json_str)
            if ops and isinstance(ops, list) and len(ops) > 0 and isinstance(ops[0], dict) and 'type' in ops[0]:
                print(f"✓ Extracted {len(ops)} operations from generic code block")
                return ops
        except (json.JSONDecodeError, KeyError, IndexError) as e:
            print(f"✗ Failed to parse generic code block: {e}")
    
    # Method 4: Try to find JSON array directly
    match = re.search(r'\[\s*\{\s*"type"\s*:\s*"[^"]+"\s*,\s*"params"\s*:[\s\S]*?\}\s*\]', text)
    if match:
        try:
            json_str = fix_deepseek_json(match.group(0)) if is_deepseek else fix_json_string(match.group(0))
            ops = json.loads(json_str)
            print(f"✓ Extracted {len(ops)} operations from direct JSON")
            return ops
        except json.JSONDecodeError as e:
            print(f"✗ Failed to parse direct JSON: {e}")
    
    # Method 5: Fallback - try to rebuild from structure
    print("  Attempting fallback structure rebuild...")
    ops = rebuild_operations_json(text)
    if ops:
        print(f"✓ Rebuilt {len(ops)} operations from fallback structure parsing")
        return ops
    
    print(f"✗ No operations found in response")
    return None
