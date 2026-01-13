import sys
import os
import asyncio
import io
import contextlib
import logging
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

from phone_agent.device_factory import DeviceType
from phone_agent.config.apps import list_supported_apps
from phone_agent.config.apps_harmonyos import list_supported_apps as list_harmonyos_apps
from phone_agent.config.apps_ios import list_supported_apps as list_ios_apps
from phone_agent.agent import PhoneAgent, AgentConfig, StepResult
from phone_agent.model import ModelConfig
# from phone_agent.adb import list_devices # Assuming this exists or similar

app = FastAPI()

# Filter out successful access logs to reduce noise
class EndpointFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        # Filter out healthy status checks
        if "/api/status" in message:
            return False
        # Filter out screenshot polling requests
        if "/api/screenshot/latest" in message:
            return False
        # Filter out any 200 OK responses to keep console clean
        if " 200 OK" in message:
            return False
        return True

# Apply filter to uvicorn access logger
logging.getLogger("uvicorn.access").addFilter(EndpointFilter())

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
    loop_count: int = 1

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
    max_steps: int = 100
    verbose: bool = True
    screenshot_save_path: Optional[str] = None
    conversation_prefix: Optional[str] = None

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
TEMP_SCREENSHOT_DIR = os.path.join(PROJECT_ROOT, "gui", "frontend", "temp_screenshots")
LATEST_SCREENSHOT_NAME = "latest_screenshot.png"

# Ensure temp screenshot directory exists
os.makedirs(TEMP_SCREENSHOT_DIR, exist_ok=True)

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
    global model_status
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

        # Update status logic
        # User requires strict check: ONLY if we get valid think/answer content is it OK.
        # If we got an "InternalError" from the client wrapper, it's NOT OK.
        if response.action and "InternalError" not in response.action and not response.action.startswith("Error"):
            model_status = "ok"
        else:
            model_status = "error"

        # Format output as requested
        formatted_output = f"<think>{response.thinking}</think>\n<answer>{response.action}</answer>"
        return {"result": formatted_output}
        
    except Exception as e:
        print(f"Model test failed: {e}")
        model_status = "error"
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
def stop_agent(force: bool = False):
    global agent
    if agent:
        try:
            agent.stop()
            if force:
                # Force reset agent state to allow new tasks immediately
                # This might cause the background thread to crash/exit uncleanly, which is expected.
                agent.reset()
            return {"status": "success", "message": "Stop signal sent"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
    return {"status": "error", "message": "Agent not running"}

from fastapi.responses import StreamingResponse

# Health Check Service
model_status = "unknown" # unknown, ok, error
last_health_check = 0

async def health_checker():
    global model_status, last_health_check
    import time
    from phone_agent.model import ModelClient, ModelConfig
    
    while True:
        try:
            # Use current settings to verify model
            active_config = current_settings.cloud if current_settings.mode == "cloud" else current_settings.local
            
            # Simple ping/test
            # We don't want to use real tokens if expensive, but list_models is often free or cheap. 
            # If not available, we can try a 1-token generation.
            # For simplicity and safety, we will just assume "check_connection" if possible, 
            # but usually we have to make a request.
            # Let's skip heavy check if settings are empty
            if not active_config.base_url:
                model_status = "error"
            else:
                # We can't easily "ping" without model specific API.
                # Just mark as 'unknown' until user tries?
                # The user asked for it to be CHECKED.
                # So we will try a very minimal request.
                pass 
                # Actually, let's just mark it 'ok' if we successfully created the agent previously?
                # No, user said "through test".
                # Let's rely on success of 'test_model' calls? 
                # Or run a dummy request every 60s?
                # Dummy request:
                if time.time() - last_health_check > 60:
                     try:
                        mc = ModelConfig(
                            base_url=active_config.base_url,
                            model_name=active_config.model_name,
                            api_key=active_config.api_key
                        )
                        client = ModelClient(mc)
                        # We don't have a lightweight 'ping'. 
                        # We will skip automatic health check to avoid cost/latency and 
                        # instead rely on 'test_model' updates or just initial state.
                        # Wait, user explicitly asked for "Check status... (through test view if available)".
                        # Parsing: "Through test" might mean "Via a test request".
                        # Let's implementation a "Passive" status that defaults to unknown, 
                        # and updates to 'ok'/'error' whenever 'test_model' is called or a chat happens.
                        pass
                     except:
                        pass
            
            # For now, we will NOT auto-ping to avoid costs. 
            # We will default to 'unknown' and let the user click 'Test' to update it?
            # Or simpler: Update status whenever we successfully talk to the agent.
            
        except Exception:
            model_status = "error"
            
        await asyncio.sleep(5)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(log_broadcaster())
    # asyncio.create_task(health_checker()) # Disabled auto-check for now to prevent spam

@app.get("/api/status")
def get_status():
    global agent, model_status
    
    # Determine model status based on agent state or recent success
    # If agent is running, model is effectively 'ok' (or at least was)
    if agent and agent.is_running:
        m_status = "ok"
    else:
        # Fallback to the global tracker (updated by test_model or errors)
        m_status = model_status
        
    return {
        "running": agent.is_running if agent else False, 
        "stopping": (agent.is_stopping and agent.is_running) if agent else False,
        "model_status": m_status,
        "mode": current_settings.mode,
        "device_id": current_settings.device_id or "Auto-Detect",
        "max_steps": current_settings.max_steps,
        "verbose": current_settings.verbose
    }

@app.post("/api/tools/select_folder")
def select_folder():
    """Open a native folder selection dialog on the server (Windows)."""
    try:
        # distinct powershell command to open folder picker
        ps_cmd = """
        Add-Type -AssemblyName System.Windows.Forms
        $f = New-Object System.Windows.Forms.FolderBrowserDialog
        $f.ShowNewFolderButton = $true
        $result = $f.ShowDialog()
        if ($result -eq 'OK') {
            Write-Output $f.SelectedPath
        }
        """
        # Run powershell command
        result = subprocess.run(
            ["powershell", "-Command", ps_cmd], 
            capture_output=True, 
            text=True, 
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        path = result.stdout.strip()
        if path:
            return {"status": "success", "path": path}
        return {"status": "cancelled", "path": ""}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/apps")
def get_supported_apps():
    """List supported apps based on current device type."""
    dt = current_settings.device_type
    
    if dt == "hdc":
        apps = list_harmonyos_apps()
    elif dt == "ios":
        apps = list_ios_apps()
    else:
        apps = list_supported_apps()
        
    return {"apps": sorted(apps), "device_type": dt}

@app.get("/api/screenshot/latest")
def get_latest_screenshot():
    """Get the latest screenshot info for monitoring."""
    latest_path = os.path.join(TEMP_SCREENSHOT_DIR, LATEST_SCREENSHOT_NAME)
    
    if os.path.exists(latest_path):
        # Get file modification time
        mtime = os.path.getmtime(latest_path)
        return {
            "exists": True,
            "url": f"/temp_screenshots/{LATEST_SCREENSHOT_NAME}",
            "timestamp": mtime
        }
    else:
        return {
            "exists": False,
            "url": None,
            "timestamp": None
        }

@app.get("/temp_screenshots/{filename}")
def get_screenshot_file(filename: str):
    """Serve screenshot files from temp directory."""
    file_path = os.path.join(TEMP_SCREENSHOT_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type="image/png")
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="File not found")


@app.post("/api/chat")
def chat(request: ChatRequest):
    global agent
    if not agent:
        # Initialize from current settings instead of blank defaults
        print("Initializing agent lazily in chat endpoint...")
        try:
            # Determine active config based on mode
            active_config = current_settings.cloud if current_settings.mode == "cloud" else current_settings.local
            
            model_config = ModelConfig(
                base_url=active_config.base_url,
                model_name=active_config.model_name,
                api_key=active_config.api_key
            )
            # Agent Config
            # Build custom system prompt with conversation prefix if set
            base_system_prompt = None
            if current_settings.conversation_prefix and current_settings.conversation_prefix.strip():
                # Import the default system prompt constant
                from phone_agent.config.prompts import SYSTEM_PROMPT
                # Prepend the custom prefix as additional instructions
                base_system_prompt = f"{current_settings.conversation_prefix.strip()}\n\n{SYSTEM_PROMPT}"
                print(f"\n{'='*60}")
                print(f"✅ 已将对话前置内容注入到系统提示词:")
                print(f"{current_settings.conversation_prefix.strip()}")
                print(f"{'='*60}\n")
            
            agent_conf = AgentConfig(
                max_steps=current_settings.max_steps,
                device_id=current_settings.device_id,
                verbose=current_settings.verbose,
                screenshot_save_path=current_settings.screenshot_save_path,
                system_prompt=base_system_prompt  # Use custom prompt if prefix is set
            )
            agent = PhoneAgent(model_config=model_config, agent_config=agent_conf)
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
            # Check for batch tasks (split by newline)
            # Filter out empty lines
            tasks = [line.strip() for line in request.message.split('\n') if line.strip()]
            
            if not tasks:
                tasks = [request.message] # Fallback
            
            total_tasks = len(tasks)
            is_batch = total_tasks > 1
            
            if is_batch or request.loop_count > 1:
                loop_info = f" (Loop {request.loop_count} times)" if request.loop_count > 1 else ""
                yield json.dumps({"type": "status", "content": f"Batch Mode: {total_tasks} tasks queued{loop_info}..."}) + "\n"
            else:
                yield json.dumps({"type": "status", "content": "Initializing..."}) + "\n"
            
            # Track start time
            import time
            start_ts = time.time()
            all_task_outputs = []

            for loop_idx in range(request.loop_count):
                if agent.is_stopping:
                    break
                
                loop_prefix = f"[Loop {loop_idx+1}/{request.loop_count}] " if request.loop_count > 1 else ""
                
                if request.loop_count > 1:
                     yield json.dumps({"type": "status", "content": f"Starting Loop {loop_idx+1}/{request.loop_count}..."}) + "\n"

                for i, task in enumerate(tasks):
                    if agent.is_stopping:
                        break
                    
                    if is_batch or request.loop_count > 1:
                        task_label = f"Task {i+1}/{total_tasks}" if is_batch else "Task"
                        yield json.dumps({"type": "status", "content": f"{loop_prefix}Running {task_label}: {task[:20]}..."}) + "\n"
                    
                    step_output = ""
                    for step in agent.run_stream(task):
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
                            step_output = step.message
                    
                    # Collect output
                    if not step_output:
                        step_output = "Done"
                    
                    output_label = f"Loop {loop_idx+1} Task {i+1}" if request.loop_count > 1 and is_batch else \
                                   f"Loop {loop_idx+1}" if request.loop_count > 1 else \
                                   f"Task {i+1}" if is_batch else None
                                   
                    if output_label:
                        all_task_outputs.append(f"{output_label}: {step_output}")
                    else:
                        all_task_outputs.append(step_output)
            
            # Combine all outputs
            final_content = "\n".join(all_task_outputs)
            
            # If stopped early
            if agent.is_stopping:
                 final_content += "\n(Batch stopped by user)"

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
