"""
kernel_bridge.py

Provides a Python Bridge for notebook communication.
Manages jupyter_client interactions and standard I/O JSON-RPC bridge.
"""

import sys
import json
import asyncio
import traceback
import os
import platform
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=False)
if hasattr(sys.__stdout__, 'reconfigure'):
    sys.__stdout__.reconfigure(line_buffering=False)

if platform.system() == 'Windows':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Ensure subprocess output (e.g. !pip install) is unbuffered so lines stream immediately
os.environ.setdefault('PYTHONUNBUFFERED', '1')
os.environ.setdefault('PIP_NO_COLOR', '1')

sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from jupyter_client import AsyncKernelManager
    from jupyter_client.kernelspec import KernelSpecManager
except ImportError:
    print(json.dumps({
        "type": "bridge_error",
        "error": "jupyter_client not installed. Run: pip install jupyter_client"
    }), file=sys.__stdout__)
    sys.exit(1)


def send(data: dict):
    """
    Primary output junction for all messages destined for the Node.js backend.
    
    Args:
        data (dict): The message dictionary to serialize and send.
    """
    line = json.dumps(data, ensure_ascii=False)
    sys.__stdout__.write(line + '\n')
    sys.__stdout__.flush()


class KernelBridge:
    """
    Manages the connection and messaging between a specific notebook and an IPython kernel.

    Args:
        notebook_id (str): Unique ID of the notebook.
        reconnect_file (str | None): Path to an existing connection file for recovery.
    """
    def __init__(self, notebook_id: str, reconnect_file: str = None):
        self.notebook_id = notebook_id
        self.reconnect_file = reconnect_file
        self.km = None
        self.kc = None
        self.execution_map = {}   
        self.cell_map = {}        
        self._running = True
        self._stdin_reply_futures = {}  

    async def start(self):
        """
        Initialize the kernel manager and start all asynchronous message listeners.
        
        Handles both fresh starts and reconnection from crashes.
        """
        self.km = AsyncKernelManager()

        if self.reconnect_file:
            self.km.load_connection_file(self.reconnect_file)
            self.kc = self.km.client()
            self.kc.start_channels()
        else:
            await self.km.start_kernel()
            self.kc = self.km.client()
            self.kc.start_channels()
            self.km.write_connection_file()

        await self.kc.wait_for_ready(timeout=30)

        send({"type": "ready", "notebook_id": self.notebook_id})
        send({"type": "debug", "notebook_id": self.notebook_id, "message": f"Kernel ready, starting listeners. kc={self.kc}, km={self.km}"})

        try:
            await asyncio.gather(
                self.listen_iopub(),
                self.listen_stdin(),
                self.listen_stdin_input(),
                self.heartbeat_loop()
            )
        except Exception as e:
            send({"type": "debug", "notebook_id": self.notebook_id, "message": f"Listener error: {str(e)}"})


    async def listen_iopub(self):
        """
        Receives every output message from the IPython iopub channel.
        
        Formats and forwards stdout, stderr, display results, and execution 
        status messages to the backend.
        """
        while self._running:
            try:
                msg = await self.kc.get_iopub_msg(timeout=0.01)
            except Exception:
                await asyncio.sleep(0.005)
                continue

            msg_type = msg['header']['msg_type']
            content = msg['content']
            parent_id = msg['parent_header'].get('msg_id', '')
            exec_id = self.execution_map.get(parent_id, parent_id)
            
            send({"type": "debug", "notebook_id": self.notebook_id, "message": f"IOPub: {msg_type}, parent={parent_id}, exec={exec_id}"})

            if msg_type == 'stream':
                send({
                    "type": "stream",
                    "notebook_id": self.notebook_id,
                    "execution_id": exec_id,
                    "name": content['name'],  
                    "text": content['text']
                })

            elif msg_type in ('display_data', 'execute_result'):
                out = {
                    "type": "result" if msg_type == "execute_result" else "display",
                    "notebook_id": self.notebook_id,
                    "execution_id": exec_id,
                    "data": content.get('data', {})
                }
                if msg_type == 'execute_result':
                    out['execution_count'] = content.get('execution_count')
                send(out)

            elif msg_type == 'error':
                send({
                    "type": "error",
                    "notebook_id": self.notebook_id,
                    "execution_id": exec_id,
                    "ename": content['ename'],
                    "evalue": content['evalue'],
                    "traceback": '\r\n'.join(content['traceback'])
                })

            elif msg_type == 'status':
                send({
                    "type": "status",
                    "notebook_id": self.notebook_id,
                    "execution_id": exec_id,
                    "state": content['execution_state']
                })

            elif msg_type == 'clear_output':
                send({
                    "type": "clear_output",
                    "notebook_id": self.notebook_id,
                    "execution_id": exec_id,
                    "wait": content.get('wait', False)
                })

            elif msg_type == 'comm_open':
                send({
                    "type": "comm_open",
                    "notebook_id": self.notebook_id,
                    "execution_id": exec_id,
                    "comm_id": content.get('comm_id'),
                    "target_name": content.get('target_name'),
                    "data": content.get('data', {}),
                    "metadata": msg.get('metadata', {})
                })

            elif msg_type == 'comm_msg':
                send({
                    "type": "comm_msg",
                    "notebook_id": self.notebook_id,
                    "execution_id": exec_id,
                    "comm_id": content.get('comm_id'),
                    "data": content.get('data', {})
                })

            elif msg_type == 'comm_close':
                send({
                    "type": "comm_close",
                    "notebook_id": self.notebook_id,
                    "comm_id": content.get('comm_id')
                })

            elif msg_type in ('execute_input', 'comm_info_reply'):
                pass

            else:
                send({
                    "type": "debug",
                    "notebook_id": self.notebook_id,
                    "message": f"Unknown IOPub message type: {msg_type}"
                })


    async def listen_stdin(self):
        """
        Handles kernel input requests (e.g., from Python's input()).
        
        Forwards the request to the frontend and blocks until a reply is received.
        """
        send({"type": "debug", "notebook_id": self.notebook_id, "message": "listen_stdin_channel started"})
        while self._running:
            try:
                msg = await self.kc.get_stdin_msg(timeout=0.1)
            except Exception as e:
                await asyncio.sleep(0.01)
                continue

            msg_type = msg['header']['msg_type']
            if msg_type != 'input_request':
                continue

            parent_id = msg['parent_header'].get('msg_id', '')
            exec_id = self.execution_map.get(parent_id, parent_id)
            prompt = msg['content'].get('prompt', '')
            password = msg['content'].get('password', False)

            send({"type": "debug", "notebook_id": self.notebook_id, "message": f"input_request: exec_id={exec_id}, prompt={prompt}"})

            send({
                "type": "input_request",
                "notebook_id": self.notebook_id,
                "execution_id": exec_id,
                "prompt": prompt,
                "password": password
            })

            try:
                reply = await self.wait_for_stdin_reply(exec_id)
                send({"type": "debug", "notebook_id": self.notebook_id, "message": f"stdin_reply received: {reply[:20] if reply else 'empty'}..."})
                self.kc.input(reply)
                send({"type": "debug", "notebook_id": self.notebook_id, "message": "stdin_reply sent to kernel"})
            except Exception as e:
                send({"type": "debug", "notebook_id": self.notebook_id, "message": f"stdin_reply error: {str(e)}"})

    async def wait_for_stdin_reply(self, exec_id: str, timeout: float = 300.0) -> str:
        """Block until Node sends a stdin_reply for this execution."""
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self._stdin_reply_futures[exec_id] = future
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self._stdin_reply_futures.pop(exec_id, None)
            raise


    async def listen_stdin_input(self):
        """
        Reads newline-delimited JSON commands from Node via stdin.
        This is the main command intake loop.
        """
        loop = asyncio.get_event_loop()
        
        while self._running:
            try:
                line = await loop.run_in_executor(None, sys.stdin.readline)
                if not line:
                    break
                line = line.decode('utf-8').strip() if isinstance(line, bytes) else line.strip()
                if not line:
                    continue
                msg = json.loads(line)
                await self.handle_command(msg)
            except json.JSONDecodeError:
                pass
            except Exception as e:
                send({
                    "type": "bridge_error",
                    "notebook_id": self.notebook_id,
                    "error": str(e),
                    "traceback": traceback.format_exc()
                })

    async def handle_command(self, msg: dict):
        """
        Dispatching logic for incoming JSON-RPC commands from the backend.

        Args:
            msg (dict): The parsed command dictionary.
        """
        cmd = msg.get('type')

        if cmd == 'execute':
            send({"type": "debug", "notebook_id": self.notebook_id, "message": f"execute command: code={msg['code'][:50]}..., exec_id={msg['execution_id']}"})
            kernel_msg_id = self.kc.execute(
                msg['code'],
                silent=False,
                store_history=True,
                allow_stdin=True
            )
            self.execution_map[kernel_msg_id] = msg['execution_id']
            self.cell_map[msg['execution_id']] = msg.get('cell_id')
            send({"type": "debug", "notebook_id": self.notebook_id, "message": f"execute sent: kernel_msg_id={kernel_msg_id}"})

        elif cmd == 'interrupt':
            await self.km.interrupt_kernel()

        elif cmd == 'restart':
            await self.km.restart_kernel()
            send({"type": "kernel_restarted", "notebook_id": self.notebook_id})

        elif cmd == 'stdin_reply':
            exec_id = msg.get('execution_id')
            value = msg.get('value', '')
            send({"type": "debug", "notebook_id": self.notebook_id, "message": f"stdin_reply cmd: exec_id={exec_id}, value={value[:20] if value else 'empty'}..."})
            future = self._stdin_reply_futures.pop(exec_id, None)
            if future and not future.done():
                future.set_result(value)
            else:
                send({"type": "debug", "notebook_id": self.notebook_id, "message": f"stdin_reply: no waiting future for exec_id={exec_id}"})

        elif cmd == 'set_notebook_id':
            new_id = msg.get('notebook_id')
            if new_id:
                send({"type": "debug", "notebook_id": new_id,
                      "message": f"notebook_id updated from {self.notebook_id} to {new_id}"})
                self.notebook_id = new_id
            send({"type": "ready", "notebook_id": self.notebook_id})

        elif cmd == 'comm_msg':
            comm_id = msg.get('comm_id')
            data = msg.get('data', {})
            send({"type": "debug", "notebook_id": self.notebook_id, "message": f"comm_msg: comm_id={comm_id}"})
            try:
                self.kc.session.send(
                    self.kc.shell_channel.socket,
                    'comm_msg',
                    content={'comm_id': comm_id, 'data': data},
                    parent=None
                )
            except Exception as e:
                send({"type": "debug", "notebook_id": self.notebook_id, "message": f"comm_msg error: {str(e)}"})
        elif cmd == 'get_variables':
            await self.run_introspection(msg['execution_id'])

        elif cmd == 'complete':
            # P1-2: Tab completion via Jupyter complete_request.
            await self.run_completion(
                msg.get('request_id', ''),
                msg.get('code', ''),
                msg.get('cursor_pos', len(msg.get('code', '')))
            )

        elif cmd == 'shutdown':
            await self.km.shutdown_kernel()
            send({"type": "shutdown_ack", "notebook_id": self.notebook_id})
            self._running = False
            sys.exit(0)


    async def run_introspection(self, execution_id: str):
        """
        Execute a silent snippet to extract current variable values.

        Args:
            execution_id (str): The ID of the execution context to report against.
        """
        code = """
import json as _json, sys as _sys
_vars = []
for _n, _v in list(globals().items()):
    if _n.startswith('_'): continue
    try:
        _e = {"name": _n, "type": type(_v).__name__}
        if hasattr(_v, 'shape'):   _e['shape']   = list(_v.shape)
        if hasattr(_v, 'columns'):
            _e['columns']     = list(_v.columns)
            _e['null_counts'] = {k: int(v) for k,v in _v.isnull().sum().items()}
        if hasattr(_v, 'memory_usage'):
            _e['memory_mb'] = round(_v.memory_usage(deep=True).sum() / 1e6, 3)
        _vars.append(_e)
    except: pass
print(_json.dumps(_vars))
del _n, _v, _e, _vars
"""
        msg_id = self.kc.execute(code, silent=True, store_history=False)
        deadline = asyncio.get_event_loop().time() + 5.0
        while asyncio.get_event_loop().time() < deadline:
            try:
                msg = await self.kc.get_iopub_msg(timeout=0.1)
                if (msg['parent_header'].get('msg_id') == msg_id
                        and msg['header']['msg_type'] == 'stream'):
                    data = json.loads(msg['content']['text'])
                    send({
                        "type": "variables",
                        "notebook_id": self.notebook_id,
                        "execution_id": execution_id,
                        "data": data
                    })
                    return
            except Exception:
                await asyncio.sleep(0.01)

    #── P1-2: Code Completion ──────────────────────────────────────────────────

    async def run_completion(self, request_id: str, code: str, cursor_pos: int):
        """
        Send a complete_request to the kernel and return the completions to Node.

        Args:
            request_id (str): Caller-supplied ID so Node can match the response.
            code (str):       The source code text up to the cursor.
            cursor_pos (int): The cursor position (character index) within code.
        """
        msg_id = self.kc.complete(code, cursor_pos)
        deadline = asyncio.get_event_loop().time() + 5.0

        while asyncio.get_event_loop().time() < deadline:
            try:
                # complete_reply comes on the shell channel
                msg = await self.kc.get_shell_msg(timeout=0.1)
                if (msg['parent_header'].get('msg_id') == msg_id
                        and msg['header']['msg_type'] == 'complete_reply'):
                    content = msg['content']
                    send({
                        "type":        "completions",
                        "notebook_id": self.notebook_id,
                        "request_id":  request_id,
                        "matches":     content.get('matches', []),
                        "cursor_start": content.get('cursor_start', cursor_pos),
                        "cursor_end":   content.get('cursor_end', cursor_pos),
                        "metadata":     content.get('metadata', {}),
                    })
                    return
            except Exception:
                await asyncio.sleep(0.01)

        # Timeout — return empty completions so the editor doesn't hang
        send({
            "type":        "completions",
            "notebook_id": self.notebook_id,
            "request_id":  request_id,
            "matches":     [],
            "cursor_start": cursor_pos,
            "cursor_end":   cursor_pos,
        })

    #── Heartbeat — Detect dead kernels──────────────────────────────────

    async def heartbeat_loop(self, interval: float = 5.0):
        while self._running:
            await asyncio.sleep(interval)
            try:
                pass
            except Exception:
                send({"type": "kernel_dead", "notebook_id": self.notebook_id})


# ── Entry Point ──────────────────────────────────────────────────────────

async def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--notebook-id', required=True)
    parser.add_argument('--reconnect', default=None,
                        help='Path to connection file for reconnect after crash')
    args = parser.parse_args()

    bridge = KernelBridge(
        notebook_id=args.notebook_id,
        reconnect_file=args.reconnect
    )
    await bridge.start()


if __name__ == '__main__':
    asyncio.run(main())
