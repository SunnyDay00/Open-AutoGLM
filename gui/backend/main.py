import sys
import os
import asyncio
import io
import contextlib
from typing import List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import json
import threading
import queue

# Add project root to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from phone_agent.agent import PhoneAgent, AgentConfig, StepResult
from phone_agent.model import ModelConfig
# from phone_agent.adb import list_devices # Assuming this exists or similar

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.responses import FileResponse

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    logo_path = os.path.join(os.path.dirname(__file__), "../../logo.jpg")
    if os.path.exists(logo_path):
        return FileResponse(logo_path)
    return FastAPI.Response(status_code=204)

# Models
class ChatRequest(BaseModel):
    message: str
    is_new_task: bool = False

class ModelSettings(BaseModel):
    base_url: str
    model_name: str
    api_key: str

class Settings(BaseModel):
    mode: str = "cloud"  # "cloud" or "local"
    cloud: ModelSettings
    local: ModelSettings
    device_id: Optional[str] = None
    device_type: str = "adb"

# Global State
agent: Optional[PhoneAgent] = None
log_queue = queue.Queue()

# Logging Capture
class OutputTee(io.StringIO):
    def __init__(self, original_stdout):
        super().__init__()
        self.original_stdout = original_stdout
        self.buffer = ""
        self.io_lock = threading.Lock()

    def write(self, s):
        # Always write to original stdout immediately (console sees streaming)
        self.original_stdout.write(s)
        
        # Buffer for WebSocket logs to ensure line-by-line transmission
        with self.io_lock:
            self.buffer += s
            while '\n' in self.buffer:
                line, self.buffer = self.buffer.split('\n', 1)
                # Only broadcast non-empty lines to keep UI clean
                if line.strip():
                     log_queue.put(line)

    def flush(self):
        self.original_stdout.flush()

sys.stdout = OutputTee(sys.stdout)
# sys.stderr = OutputTee(sys.stderr) # Optionally capture stderr too

# WebSocket Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.log_history: List[str] = [] # Store recent logs
        self.max_history = 2000

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Replay history
        for log in self.log_history:
            try:
                await websocket.send_text(log)
            except: pass

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        # Add to history
        self.log_history.append(message)
        if len(self.log_history) > self.max_history:
            self.log_history.pop(0)
            
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except:
                pass

manager = ConnectionManager()

# Background Log Broadcaster
async def log_broadcaster():
    while True:
        while not log_queue.empty():
            msg = log_queue.get()
            await manager.broadcast(msg)
        await asyncio.sleep(0.1)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(log_broadcaster())

# APIs
@app.get("/api/devices")
def get_devices():
    # Helper to get devices calling adb directly if imports fail
    import subprocess
    import shutil
    
    # Check for local adb first
    local_adb = os.path.join(os.getcwd(), "platform-tools", "adb.exe")
    if os.path.exists(local_adb):
        adb_cmd = local_adb
    else:
        adb_cmd = "adb"
        
    try:
        result = subprocess.run([adb_cmd, "devices"], capture_output=True, text=True, encoding='utf-8')
        lines = result.stdout.strip().split("\n")[1:]
        devices = [line.split("\t")[0] for line in lines if "\tdevice" in line]
        return {"devices": devices}
    except Exception as e:
        return {"devices": [], "error": str(e)}

# Default Settings and Persistence
# Use absolute path relative to this script to avoid CWD issues
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, "../../"))
SETTINGS_FILE = os.path.join(PROJECT_ROOT, "settings.json")
CHAT_HISTORY_FILE = os.path.join(PROJECT_ROOT, "chat_history.json")

# File Locks
settings_lock = threading.Lock()
history_lock = threading.Lock()

def load_settings():
    default_cloud = ModelSettings(
        base_url="https://open.bigmodel.cn/api/paas/v4",
        model_name="autoglm-phone",
        api_key=""
    )
    default_local = ModelSettings(
        base_url="http://localhost:11434/v1",
        model_name="qwen2.5:9b",
        api_key="EMPTY"
    )

    if os.path.exists(SETTINGS_FILE):
        try:
            with settings_lock:
                with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    
                    # Migration logic: Check if it's old format (flat structure)
                    if "cloud" not in data and "base_url" in data:
                        print("Migrating old settings format...")
                        old_cloud = ModelSettings(
                            base_url=data.get("base_url", default_cloud.base_url),
                            model_name=data.get("model_name", default_cloud.model_name),
                            api_key=data.get("api_key", default_cloud.api_key)
                        )
                        return Settings(
                            mode="cloud",
                            cloud=old_cloud,
                            local=default_local,
                            device_id=data.get("device_id"),
                            device_type=data.get("device_type", "adb")
                        )
                    
                    if "device_id" not in data:
                        data["device_id"] = None
                    print(f"Loaded settings from {SETTINGS_FILE}")
                    return Settings(**data)
        except Exception as e:
            print(f"Failed to load settings from {SETTINGS_FILE}: {e}")
            try:
                with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                    print(f"Corrupted content raw: {f.read()!r}")
            except: pass
    else:
        print(f"Settings file not found at {SETTINGS_FILE}, using defaults.")
        
    return Settings(
        mode="cloud",
        cloud=default_cloud,
        local=default_local,
        device_id=None
    )

def save_settings_to_file(settings: Settings):
    try:
        with settings_lock:
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(settings.dict(), f, indent=4)
        print(f"Saved settings to {SETTINGS_FILE}")
    except Exception as e:
        print(f"Failed to save settings: {e}")

current_settings = load_settings()

@app.get("/api/settings")
def get_settings():
    return current_settings

@app.post("/api/settings")
def update_settings(settings: Settings):
    global agent, current_settings
    
    current_settings = settings
    save_settings_to_file(settings)
    
    # Determine active config based on mode
    active_config = settings.cloud if settings.mode == "cloud" else settings.local
    
    model_config = ModelConfig(
        base_url=active_config.base_url,
        model_name=active_config.model_name,
        api_key=active_config.api_key
    )
    
    agent_config = AgentConfig(
        device_id=settings.device_id,
        # device_type=settings.device_type
    )
    
    # Re-initialize agent
    try:
        agent = PhoneAgent(model_config=model_config, agent_config=agent_config)
    except Exception as e:
        print(f"Failed to initialize agent: {e}")
        return {"status": "error", "message": f"Agent init failed: {str(e)}"}
        
    return {"status": "success", "message": "Agent configured"}

@app.post("/api/test_model")
def test_model(settings: Settings):
    try:
        from phone_agent.model import ModelClient, ModelConfig
        from phone_agent.config import get_system_prompt
        
        # Use config from the request settings, respecting the mode
        print(f"DEBUG: Received settings mode: '{settings.mode}'")
        print(f"DEBUG: Cloud config: {settings.cloud}")
        print(f"DEBUG: Local config: {settings.local}")
        
        # Check and clear proxies if they exist
        for proxy_key in ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']:
            if proxy_key in os.environ:
                print(f"DEBUG: Found proxy env var {proxy_key}={os.environ[proxy_key]}")
                print(f"DEBUG: Clearing {proxy_key} to prevent conflict...")
                os.environ.pop(proxy_key)
        
        active_config = settings.cloud if settings.mode == "cloud" else settings.local
        print(f"DEBUG: Selected active config base_url: '{active_config.base_url}'")
        
        model_config = ModelConfig(
            base_url=active_config.base_url,
            model_name=active_config.model_name,
            api_key=active_config.api_key
        )
        client = ModelClient(model_config)
        
        # Construct a simple test message context
        # We use the 'cn' system prompt as default for testing
        sys_prompt = get_system_prompt("cn")
        
        # User prompt that aligns with the requested output example
        user_prompt = "帮我比较一下LUMMI MOOD洗发水在京东和淘宝上的价格，然后选择最便宜的平台下单。"
        
        # Determine message format based on what ModelClient expects (list of dicts)
        # We'll construct a text-only message for testing connectivity
        messages = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        print(f"Testing model with URL: {active_config.base_url}, Model: {active_config.model_name}")
        response = client.request(messages)
        
        # Format output as requested
        formatted_output = f"<think>{response.thinking}</think>\n<answer>{response.action}</answer>"
        return {"result": formatted_output}
        
    except Exception as e:
        print(f"Model test failed: {e}")
        # Return error as result so it shows up in the UI
        return {"result": f"Error: {str(e)}\n\nPlease check your Base URL and API Key.\nMake sure the model is deployed and accessible."}

# Chat history management
# Using absolute path defined above
# CHAT_HISTORY_FILE already defined

def load_chat_history():
    if os.path.exists(CHAT_HISTORY_FILE):
        try:
            with history_lock:
                with open(CHAT_HISTORY_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print(f"Error loading chat history: {e}")
    return [{"role": "assistant", "content": "您好！我是 AutoGLM。今天想让我帮您控制手机做些什么？"}]

def save_chat_history(history):
    try:
        with history_lock:
            with open(CHAT_HISTORY_FILE, "w", encoding="utf-8") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving chat history: {e}")

@app.get("/api/history")
def get_history():
    return {"history": load_chat_history()}

@app.delete("/api/history")
def clear_history():
    global agent
    if agent:
        try:
             agent.reset()
        except:
             pass
    initial_history = [{"role": "assistant", "content": "您好！我是 AutoGLM。今天想让我帮您控制手机做些什么？"}]
    save_chat_history(initial_history)
    return {"status": "success", "history": initial_history}

def get_beijing_time():
    """Fetch real-time time from local system."""
    from datetime import datetime
    try:
        return datetime.now().strftime("%H:%M")
    except:
        return "Time Error"

@app.post("/api/stop")
def stop_agent():
    global agent
    if agent:
        try:
            agent.stop()
            return {"status": "success", "message": "Stop signal sent"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
    return {"status": "error", "message": "Agent not running"}

from fastapi.responses import StreamingResponse

@app.get("/api/status")
def get_status():
    global agent
    if agent and agent.is_running:
        return {"running": True, "stopping": agent.is_stopping}
    return {"running": False, "stopping": False}

@app.post("/api/chat")
def chat(request: ChatRequest):
    global agent
    if not agent:
        # Initialize from current settings instead of blank defaults
        print("Initializing agent lazily in chat endpoint...")
        try:
            model_config = ModelConfig(
                base_url=current_settings.base_url,
                model_name=current_settings.model_name,
                api_key=current_settings.api_key
            )
            agent_config = AgentConfig(
                device_id=current_settings.device_id
            )
            agent = PhoneAgent(model_config=model_config, agent_config=agent_config)
        except Exception as e:
            print(f"Lazy agent init failed: {e}")
            return {"error": f"Failed to initialize agent: {str(e)}"}
    
    # Load history
    history = load_chat_history()
    current_time = get_beijing_time()
    
    # Append user message immediately
    history.append({
        "role": "user", 
        "content": request.message,
        "time": current_time
    })
    save_chat_history(history) # Save user message first

    if request.is_new_task:
        agent.reset()

    def generate_response():
        final_content = ""
        response_time = ""
        try:
            # yield initial status
            yield json.dumps({"type": "status", "content": "Initializing..."}) + "\n"
            
            # Since agent.run_stream is synchronous (calls model blocking), 
            # we should technically run it in a threadpool to not block the event loop,
            # but for simple streaming simply yielding from iter is okay if we accept blocking.
            # To allow asyncio loop to breathe (and handling stops?), we might ideally use run_in_executor
            # But let's keep it simple: yielded generator. 
            # NOTE: If run_stream blocks for 10s on network, the loop blocks. 
            # Correct way for blocking IO generator in FastAPI: iterate in thread.
            # However, standard iterator in StreamingResponse works (FastAPI runs it in threadpool).
            
            # Track start time
            import time
            start_ts = time.time()

            for step in agent.run_stream(request.message):
                # Ensure fields are serializable
                action_desc = step.action
                if hasattr(action_desc, 'to_dict'): action_desc = action_desc.to_dict()
                
                yield json.dumps({
                    "type": "step",
                    "thinking": step.thinking,
                    "action": action_desc,
                    "finished": step.finished,
                    "message": step.message
                }) + "\n"
                
                if step.message:
                    final_content = step.message
            
            # If no final message set from steps (e.g. stopped), use last known
            if not final_content:
                 final_content = "Task finished (No output)"

            response_time = get_beijing_time()
            end_ts = time.time()
            duration_sec = int(end_ts - start_ts)
            
            # Format duration
            if duration_sec < 60:
                duration_str = f"{duration_sec}s"
            else:
                m, s = divmod(duration_sec, 60)
                duration_str = f"{m}m {s}s"
            
            # Save Assistant Response
            history.append({
                "role": "assistant", 
                "content": final_content,
                "time": response_time,
                "duration": duration_str
            })
            save_chat_history(history)
            
            yield json.dumps({
                "type": "done", 
                "content": final_content, 
                "time": response_time,
                "duration": duration_str
            }) + "\n"

        except Exception as e:
            error_msg = f"Error: {str(e)}"
            yield json.dumps({"type": "error", "content": error_msg}) + "\n"
            
            history.append({
                "role": "assistant", 
                "content": error_msg,
                "time": get_beijing_time()
            })
            save_chat_history(history)

    return StreamingResponse(generate_response(), media_type="application/x-ndjson")

@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text() # Keep connection open
    except WebSocketDisconnect:
        manager.disconnect(websocket)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
