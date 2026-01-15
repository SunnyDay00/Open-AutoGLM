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
from fastapi.staticfiles import StaticFiles

# Setup paths (Must be defined before usage)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, "../../"))

# Add project root to sys.path
sys.path.append(PROJECT_ROOT)

from phone_agent.device_factory import DeviceType
from phone_agent.config.apps import list_supported_apps
from phone_agent.config.apps_harmonyos import list_supported_apps as list_harmonyos_apps
from phone_agent.config.apps_ios import list_supported_apps as list_ios_apps
from phone_agent.agent import PhoneAgent, AgentConfig, StepResult
from phone_agent.model import ModelConfig

app = FastAPI()

# Mount device data directory for static access (screenshots)
device_data_root = os.path.join(PROJECT_ROOT, "data", "devices")
os.makedirs(device_data_root, exist_ok=True)
app.mount("/devices_data", StaticFiles(directory=device_data_root), name="devices_data")

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
    device_id: Optional[str] = None

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

# Global State
agent: Optional[PhoneAgent] = None
log_queue = queue.Queue()

# Cache for IP -> Android ID mapping (for fast resolution)
DEVICE_IP_TO_ANDROID_ID = {}

def resolve_android_id(device_identifier: str) -> Optional[str]:
    """
    Resolve a device identifier (IP, Serial, or Android ID) to the canonical Android ID.
    """
    if not device_identifier: return None
    
    # 1. Try Cache (IP/Serial -> Android ID)
    aid = DEVICE_IP_TO_ANDROID_ID.get(device_identifier)
    if aid: return aid
    
    # 2. Check if the identifier itself is a known Android ID (folder exists)
    try:
        from gui.backend.data_manager import get_device_data_manager, PROJECT_ROOT
        dm = get_device_data_manager()
        potential_folder = dm.get_device_folder_name(device_identifier)
        if os.path.exists(os.path.join(PROJECT_ROOT, "data", "devices", potential_folder)):
            return device_identifier
    except:
        pass

    # 3. NEW: Reverse lookup from saved device metadata (.device files)
    # This handles the case where device was previously connected but cache is empty
    try:
        from gui.backend.data_manager import get_device_data_manager, PROJECT_ROOT
        devices_dir = os.path.join(PROJECT_ROOT, "data", "devices")
        if os.path.exists(devices_dir):
            for folder in os.listdir(devices_dir):
                device_file = os.path.join(devices_dir, folder, ".device")
                if os.path.exists(device_file):
                    try:
                        with open(device_file, "r", encoding="utf-8") as f:
                            meta = json.load(f)
                            # Check if device_id matches
                            if meta.get("device_id") == device_identifier:
                                aid = meta.get("android_id")
                                if aid:
                                    # Update cache for future lookups
                                    DEVICE_IP_TO_ANDROID_ID[device_identifier] = aid
                                    return aid
                    except:
                        continue
    except Exception as e:
        print(f"DEBUG: Metadata lookup failed: {e}")

    # 4. Active Resolution: Try via ADB
    # This covers cases where device is online but not yet polled/cached
    print(f"DEBUG: Attempting to resolve Android ID for '{device_identifier}' via ADB...")
    info = get_device_info_via_adb(device_identifier)
    aid = info.get("android_id")
    if aid and aid != "Unknown" and not aid.startswith("Error"):
        # Update Cache
        DEVICE_IP_TO_ANDROID_ID[device_identifier] = aid
        return aid
        
    return None


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
            except Exception:
                pass  # Skip if websocket send fails

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
            except Exception:
                pass  # Connection may have closed

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
# (Paths moved to top of file)


# DEPRECATED: Global chat history file, no longer used
# Chat history is now stored per-device at data/devices/{android_id}/chat_history.json
CHAT_HISTORY_FILE = os.path.join(PROJECT_ROOT, "chat_history.json")  # Keep for any legacy references

# Note: Legacy TEMP_SCREENSHOT_DIR removed. Screenshots are now saved to
# data/devices/{android_id}/temp_screenshots/ by agent.py

# File Locks
history_lock = threading.Lock()

def _perform_model_test(settings: Settings) -> dict:
    global model_status
    try:
        from phone_agent.model import ModelClient, ModelConfig
        from phone_agent.config import get_system_prompt
        import traceback
        
        # Use config from the request settings, respecting the mode
        print(f"DEBUG: Testing with mode: '{settings.mode}'")
        
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
            # Format output with success prefix for frontend color check
            formatted_output = f"测试成功！\n\n<think>{response.thinking}</think>\n<answer>{response.action}</answer>"
            return {"status": "success", "result": formatted_output}
        else:
            model_status = "error"
            formatted_output = f"测试失败: {response.action}"
            return {"status": "error", "result": formatted_output}
        
    except Exception as e:
        print(f"Model test failed: {e}")
        model_status = "error"
        traceback.print_exc()
        # Return error as result so it shows up in the UI
        return {"status": "error", "message": str(e), "result": f"测试失败: {str(e)}"}

@app.post("/api/test_model")
def test_model(settings: Settings):
    return _perform_model_test(settings)

@app.post("/api/test_connection")
def test_connection():
    global agent
    
    # Determine target device (fallback to Global Settings)
    gsm = get_global_settings_manager()
    global_settings = gsm.get()
    target_device = global_settings.last_selected_device

    if not target_device:
        return {"status": "error", "result": "测试失败: 未选择设备，无法确定要测试的配置。"}

    # Resolve Profile
    dm = get_device_data_manager()
    
    # Resolve Android ID for storage lookup
    android_id = resolve_android_id(target_device)
    if not android_id:
         # Failed to resolve. If it's not in cache and not an offline folder, we can't find the profile.
         # Unless we allow legacy IP folders, but we want to migrate away.
         # We'll fail if we can't identify it.
         return {"status": "error", "result": f"测试失败: 无法识别设备身份 (Android ID)。请确保设备已连接。"}
         
    assigned_profile_name = dm.get_profile_name(android_id)
    
    if not assigned_profile_name:
         return {"status": "error", "result": f"测试失败: 设备 {target_device} 未绑定配置文件。"}

    pm = get_profile_manager()
    profile = pm.get_profile(assigned_profile_name)
    if not profile:
        return {"status": "error", "result": f"测试失败: 绑定配置 {assigned_profile_name} 不存在。"}

    print(f"Testing connection using profile '{assigned_profile_name}' for device '{target_device}'...")
    
    # We need to construct a 'Settings' object for _perform_model_test
    # Convert dataclasses to dicts for Pydantic validation
    from dataclasses import asdict
    
    return _perform_model_test(Settings(
        mode=profile.mode,
        cloud=asdict(profile.cloud),
        local=asdict(profile.local),
        device_id=target_device
    ))

# Chat history management
# Device-specific history only (global history deprecated)

def load_chat_history(device_id: Optional[str] = None):
    """Load chat history for a specific device. Global history is deprecated."""
    if not device_id:
        # No device specified - prompt user to select one
        return [{"role": "assistant", "content": "您好！我是 AutoGLM。请先在设备页面选择一个设备。"}]
    
    dm = get_device_data_manager()
    android_id = resolve_android_id(device_id)
    if not android_id:
        # Can't resolve device, return error
        return [{"role": "assistant", "content": f"您好！我是 AutoGLM。无法加载设备 {device_id} 的历史记录 (未识别)。请刷新设备列表。"}]
         
    path = dm.get_chat_history_path(android_id)
    if os.path.exists(path):
        try:
            with history_lock:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print(f"Error loading device history ({device_id}): {e}")
    return [{"role": "assistant", "content": f"您好！我是 AutoGLM。已连接到设备。今天想让我帮您做些什么？"}]

def save_chat_history(history, device_id: Optional[str] = None):
    """Save chat history for a specific device. Global history is deprecated."""
    if not device_id:
        print("Warning: save_chat_history called without device_id, skipping save.")
        return
        
    try:
        with history_lock:
            dm = get_device_data_manager()
            android_id = resolve_android_id(device_id)
            if not android_id:
                print(f"Warning: Skipping history save for unidentified device '{device_id}'")
                return
                
            path = dm.get_chat_history_path(android_id)
            # Ensure directory exists
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving chat history: {e}")

@app.get("/api/history")
def get_history(device_id: Optional[str] = None):
    return {"history": load_chat_history(device_id)}

@app.delete("/api/history")
def clear_history(device_id: Optional[str] = None):
    global agent
    # TODO: Reset specific agent if we have multi-agent support
    if not device_id and agent:
        try:
             agent.reset()
        except Exception as e:
             print(f"Warning: Failed to reset agent: {e}")
    
    initial_history = [{"role": "assistant", "content": 
        f"您好！我是 AutoGLM。已连接到设备 {device_id}。" if device_id else "您好！我是 AutoGLM。今天想让我帮您控制手机做些什么？"
    }]
    save_chat_history(initial_history, device_id)
    return {"status": "success", "history": initial_history}

def get_beijing_time():
    """Fetch real-time time from local system."""
    from datetime import datetime
    try:
        return datetime.now().strftime("%H:%M")
    except Exception:
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
            # Wait before checking (initial delay or interval)
            await asyncio.sleep(60)

            # Optimization: Skip check if agent is currently running
            if agent and agent.is_running:
                continue
            
            # Resolve dependencies to check current config
            # We check the 'last_selected_device'
            gsm = get_global_settings_manager()
            target_device = gsm.get().last_selected_device
            
            if target_device:
                dm = get_device_data_manager()
                # Fix: Resolve Android ID before looking up profile
                aid = resolve_android_id(target_device) or target_device
                pname = dm.get_profile_name(aid)
                if pname:
                    pm = get_profile_manager()
                    profile = pm.get_profile(pname)
                    if profile:
                        active_config = profile.cloud if profile.mode == "cloud" else profile.local
                        
                        if active_config.base_url:
                            # Perform a lightweight check
                            try:
                                mc = ModelConfig(
                                    base_url=active_config.base_url,
                                    model_name=active_config.model_name,
                                    api_key=active_config.api_key,
                                    max_tokens=5 # Optimization: limit response length
                                )
                                client = ModelClient(mc)
                                # Minimal inference to verify connectivity
                                messages = [{"role": "user", "content": "Ping"}]
                                
                                # Run in thread to avoid blocking loop, SILENTLY
                                await asyncio.to_thread(client.request, messages, verbose=False)
                                
                                model_status = "ok"
                                last_health_check = time.time()
                            except Exception as e:
                                # Only set error if we actually tried and failed
                                print(f"Health check failed: {e}")
                                model_status = "error"

        except Exception as e:
             print(f"Health checker loop error: {e}")
            
        # Ensure we don't loop too tight on error
        await asyncio.sleep(5)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(log_broadcaster())
    asyncio.create_task(health_checker())

@app.get("/api/status")
def get_status(device_id: Optional[str] = None):
    global agent, model_status
    
    # Determine target device
    gsm = get_global_settings_manager()
    global_settings = gsm.get()
    
    # Determine target device
    target_device = device_id or global_settings.last_selected_device
    
    # Determine model status based on agent state or recent success
    # If agent is running, model is effectively 'ok' (or at least was)
    if agent and agent.is_running:
        m_status = "ok"
    else:
        # Fallback to the global tracker (updated by test_model or errors)
        m_status = model_status
    
    # Check device connection status
    device_connected = False
    try:
        from phone_agent.device_factory import get_device_factory
        device_factory = get_device_factory()
        device_info_list = device_factory.list_devices()
        
        # Extract device_id strings from DeviceInfo objects
        device_ids = [d.device_id if hasattr(d, 'device_id') else str(d) for d in device_info_list]
        
        if target_device:
            device_connected = target_device in device_ids
        else:
            device_connected = len(device_ids) > 0
    except Exception as e:
        print(f"Error checking device connection: {e}")
        device_connected = False
        
    # Check if agent is running for this specific device
    is_running = False
    is_stopping = False
    
    if agent:
        # If querying specific device, only return true if agent is bound to that device
        if device_id:
            if agent.agent_config.device_id == device_id:
                is_running = agent.is_running
                is_stopping = agent.is_stopping and is_running
        else:
            # Global query returns true if agent is running on any device
            is_running = agent.is_running
            is_stopping = agent.is_stopping and is_running

        
    # Resolve Profile for UI display
    max_steps = 100
    verbose = False
    mode = "unknown"
    
    if target_device:
        dm = get_device_data_manager()
        # Resolve Android ID first
        aid = resolve_android_id(target_device) or target_device
        p_name = dm.get_profile_name(aid)
        if p_name:
            pm = get_profile_manager()
            profile = pm.get_profile(p_name)
            if profile:
                mode = profile.mode
                if profile.agent:
                    max_steps = profile.agent.max_steps
                    verbose = profile.agent.verbose

    return {
        "running": is_running, 
        "stopping": is_stopping,
        "model_status": m_status,
        "mode": mode,
        "device_id": target_device or "Auto-Detect",
        "device_connected": device_connected,
        "max_steps": max_steps,
        "verbose": verbose
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
    dt = "adb" # Default to Android/ADB for now
    # TODO: Detect device platform dynamically
    
    if dt == "hdc":
        apps = list_harmonyos_apps()
    elif dt == "ios":
        apps = list_ios_apps()
    else:
        apps = list_supported_apps()
        
    return {"apps": sorted(apps), "device_type": dt}

# ============================================================================
# Device Info APIs
# ============================================================================

def get_device_info_via_adb(device_id: str) -> dict:
    """Get detailed device info via ADB commands."""
    import subprocess
    
    def run_adb_command(cmd_suffix: str) -> str:
        try:
            device_arg = f"-s {device_id} " if device_id else ""
            result = subprocess.run(
                f"adb {device_arg}{cmd_suffix}",
                shell=True, capture_output=True, text=True, timeout=5
            )
            return result.stdout.strip()
        except (subprocess.TimeoutExpired, OSError) as e:
            return ""
    
    try:
        info = {
            "device_id": device_id,
            "model": run_adb_command("shell getprop ro.product.model") or "Unknown",
            "brand": run_adb_command("shell getprop ro.product.brand") or "Unknown",
            "android_version": run_adb_command("shell getprop ro.build.version.release") or "Unknown",
            "sdk_version": run_adb_command("shell getprop ro.build.version.sdk") or "Unknown",
            "android_id": run_adb_command("shell settings get secure android_id") or "Unknown",
            "connected": True,
            "error_message": ""
        }
        
        # Get resolution
        wm_size = run_adb_command("shell wm size")
        if "Physical size:" in wm_size:
            info["resolution"] = wm_size.split("Physical size:")[-1].strip()
        elif "x" in wm_size:
            info["resolution"] = wm_size.strip()
            info["resolution"] = "Unknown"
        
        # Get density
        wm_density = run_adb_command(f"-s {device_id} shell wm density")
        if "Physical density:" in wm_density:
            info["density"] = wm_density.split("Physical density:")[-1].strip()
        else:
            info["density"] = wm_density.strip() or "Unknown"

        # Get Android ID (Secure) - CRITICAL for Storage
        android_id = run_adb_command(f"-s {device_id} shell settings get secure android_id")
        if android_id and not android_id.startswith("Error"):
            info["android_id"] = android_id.strip()
        else:
            info["android_id"] = "Unknown"
            
        return info
    except Exception as e:
        return {
            "device_id": device_id,
            "android_id": "Unknown",
            "model": "Unknown",
            "brand": "Unknown",
            "android_version": "Unknown",
            "sdk_version": "Unknown",
            "android_id": "Unknown",
            "resolution": "Unknown",
            "density": "Unknown",
            "connected": False,
            "error_message": str(e)
        }

@app.get("/api/device/{device_id}/info")
def get_device_info(device_id: str):
    """Get detailed info for a specific device."""
    return get_device_info_via_adb(device_id)


class SetDeviceProfileRequest(BaseModel):
    profile_name: str

@app.post("/api/devices/{device_id}/profile")
def set_device_profile(device_id: str, request: SetDeviceProfileRequest):
    """Assign a profile to a device."""
    dm = get_device_data_manager()
    pm = get_profile_manager()
    
    # Verify profile exists
    if not pm.get_profile(request.profile_name):
        raise HTTPException(status_code=404, detail=f"Profile '{request.profile_name}' not found")
        
    android_id = resolve_android_id(device_id)
    if not android_id:
        raise HTTPException(status_code=400, detail=f"Cannot resolve Android ID for device '{device_id}'. Please ensure device is connected.")
        
    dm.set_profile_name(android_id, request.profile_name)
    return {"status": "success", "message": f"Profile '{request.profile_name}' assigned to device '{device_id}' (ID: {android_id})"}

@app.get("/api/devices/detailed")
def get_all_devices_detailed():
    """Get list of all connected devices with detailed info."""
    try:
        from phone_agent.device_factory import get_device_factory
        from gui.backend.data_manager import DeviceInfo
        
        device_factory = get_device_factory()
        device_info_list = device_factory.list_devices()
        dm = get_device_data_manager()
        
        # Map: Android ID -> Device Info
        all_devices_map = {}
        
        # 1. Load Known Devices (Offline baseline)
        for meta in dm.list_known_devices():
            # meta is a dict from .device JSON
            aid = meta.get("android_id")
            if aid and aid != "Unknown":
                # Mark as offline initially
                meta['connected'] = False
                meta['error_message'] = "离线 (Device offline)"
                all_devices_map[aid] = meta

        # 2. Process Online Devices (Update/Add)
        for dev_obj in device_info_list:
            dev_id = dev_obj.device_id if hasattr(dev_obj, 'device_id') else str(dev_obj)
            
            # Fetch fresh info (including Android ID)
            info = get_device_info_via_adb(dev_id)
            aid = info.get("android_id")
            
            if aid and aid != "Unknown":
                # Update Global Cache
                DEVICE_IP_TO_ANDROID_ID[dev_id] = aid
                
                # Update/Overwrite offline entry
                info['connected'] = True
                info['error_message'] = ""
                
                # Persist to disk (.device file)
                # Convert dict to DeviceInfo object for saving
                di = DeviceInfo(**{k: v for k, v in info.items() if k in DeviceInfo.__annotations__})
                dm.save_device_metadata(aid, di)
                
                # Update map
                all_devices_map[aid] = info
                
                # Inject assigned profile
                info['assigned_profile'] = dm.get_profile_name(aid)
            else:
                # Fallback for devices where we can't get Android ID (e.g. Unauthorized)
                # We can't save them reliably without Android ID
                info['assigned_profile'] = None # Cannot bind profile without persistent ID
                # Use device_id as temporary key if needed, or just append
                # For UI consistency, we might skip or show as ephemeral
                pass
            
        
        # 3. Convert map to list
        final_list = []
        for aid, info in all_devices_map.items():
             # If offline, check if we need to inject profile name
             if not info.get('connected'):
                 info['assigned_profile'] = dm.get_profile_name(aid)
             final_list.append(info)
             
        return {"devices": final_list}
    except Exception as e:
        import traceback
        return {"devices": [], "error": str(e), "traceback": traceback.format_exc()}


# ============================================================================
# Profile Management APIs
# ============================================================================

from gui.backend.data_manager import (
    get_profile_manager, get_device_data_manager, get_global_settings_manager,
    Profile, GlobalSettings
)

@app.get("/api/profiles")
def list_profiles():
    """List all configuration profiles."""
    pm = get_profile_manager()
    profiles = []
    for name in pm.list_profiles():
        profile = pm.get_profile(name)
        if profile:
            profiles.append(profile.to_dict())
    return {"profiles": profiles}

@app.get("/api/profiles/{name}")
def get_profile(name: str):
    """Get a specific profile by name."""
    pm = get_profile_manager()
    profile = pm.get_profile(name)
    if profile:
        return profile.to_dict()
    raise HTTPException(status_code=404, detail=f"Profile '{name}' not found")

class CreateProfileRequest(BaseModel):
    name: str

@app.post("/api/profiles")
def create_profile(request: CreateProfileRequest):
    """Create a new profile."""
    pm = get_profile_manager()
    try:
        profile = pm.create_profile(request.name)
        return {"status": "success", "profile": profile.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

class UpdateProfileRequest(BaseModel):
    mode: str = "cloud"
    cloud: dict = {}
    local: dict = {}
    agent: dict = {}
    conversation_prefix: str = ""

@app.put("/api/profiles/{name}")
def update_profile(name: str, request: UpdateProfileRequest):
    """Update an existing profile."""
    pm = get_profile_manager()
    profile = pm.get_profile(name)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile '{name}' not found")
    
    # Update fields
    profile.mode = request.mode
    if request.cloud:
        profile.cloud.base_url = request.cloud.get("base_url", profile.cloud.base_url)
        profile.cloud.model_name = request.cloud.get("model_name", profile.cloud.model_name)
        profile.cloud.api_key = request.cloud.get("api_key", profile.cloud.api_key)
    if request.local:
        profile.local.base_url = request.local.get("base_url", profile.local.base_url)
        profile.local.model_name = request.local.get("model_name", profile.local.model_name)
        profile.local.api_key = request.local.get("api_key", profile.local.api_key)
    if request.agent:
        profile.agent.max_steps = request.agent.get("max_steps", profile.agent.max_steps)
        profile.agent.screenshot_path = request.agent.get("screenshot_path", profile.agent.screenshot_path)
        profile.agent.verbose = request.agent.get("verbose", profile.agent.verbose)
    profile.conversation_prefix = request.conversation_prefix
    
    pm.save_profile(profile)
    return {"status": "success", "profile": profile.to_dict()}

@app.delete("/api/profiles/{name}")
def delete_profile(name: str):
    """Delete a profile."""
    pm = get_profile_manager()
    if pm.delete_profile(name):
        return {"status": "success"}
    raise HTTPException(status_code=404, detail=f"Profile '{name}' not found")

class RenameProfileRequest(BaseModel):
    new_name: str

@app.put("/api/profiles/{name}/rename")
def rename_profile(name: str, request: RenameProfileRequest):
    """Rename a profile."""
    pm = get_profile_manager()
    try:
        if pm.rename_profile(name, request.new_name):
            return {"status": "success", "new_name": request.new_name}
        raise HTTPException(status_code=404, detail=f"Profile '{name}' not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

# ============================================================================
# Global Settings APIs
# ============================================================================

@app.get("/api/global-settings")
def get_global_settings():
    """Get global application settings."""
    gsm = get_global_settings_manager()
    return gsm.get().to_dict()

class UpdateGlobalSettingsRequest(BaseModel):
    last_selected_device: str = ""
    check_device_on_startup: bool = True
    language: str = "cn"
    manual_screenshot_path: str = ""

@app.put("/api/global-settings")
def update_global_settings(request: UpdateGlobalSettingsRequest):
    """Update global settings."""
    gsm = get_global_settings_manager()
    settings = GlobalSettings(
        last_selected_device=request.last_selected_device,
        check_device_on_startup=request.check_device_on_startup,
        language=request.language,
        manual_screenshot_path=request.manual_screenshot_path
    )
    gsm.save(settings)
    

    
    return {"status": "success", "settings": settings.to_dict()}

# ADB Control APIs
def get_active_device_id() -> str:
    """Get the currently active device ID from global settings or current_settings."""
    gsm = get_global_settings_manager()
    global_settings = gsm.get()

    return global_settings.last_selected_device or ""

@app.post("/api/adb/reboot")
def adb_reboot():
    """Reboot device via ADB in CMD window."""
    try:
        device_id = get_active_device_id()
        if not device_id:
            return {"status": "error", "message": "未选择设备"}
        
        device_arg = f"-s {device_id} "
        command = f"adb {device_arg}reboot"
        
        import subprocess
        cmd = f'start cmd /k "{command} && echo. && echo Device will reboot. Press any key to close... && pause >nul"'
        subprocess.Popen(cmd, shell=True)
        
        return {"status": "success", "command": command}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/adb/install")
def adb_install():
    """Install APK via ADB."""
    try:
        ps_cmd = """
        Add-Type -AssemblyName System.Windows.Forms
        $f = New-Object System.Windows.Forms.OpenFileDialog
        $f.Filter = "APK Files (*.apk)|*.apk|All Files (*.*)|*.*"
        $f.Title = "Select APK File"
        $result = $f.ShowDialog()
        if ($result -eq 'OK') { Write-Output $f.FileName }
        """
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_cmd],
            capture_output=True, text=True, timeout=60
        )
        
        apk_path = result.stdout.strip()
        if not apk_path:
            return {"status": "cancelled"}
        
        device_id = get_active_device_id()
        if not device_id:
            return {"status": "error", "message": "未选择设备"}
        
        device_arg = f"-s {device_id} "
        command = f'adb {device_arg}install "{apk_path}"'
        
        cmd = f'start cmd /k "{command} && echo. && echo Installation completed. Press any key to close... && pause >nul"'
        subprocess.Popen(cmd, shell=True)
        
        return {"status": "success", "command": command, "apk_path": apk_path}
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Timeout"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/adb/screenshot")
def adb_screenshot_save():
    """Take screenshot and save to local path (from global settings)."""
    try:
        from phone_agent.device_factory import get_device_factory
        import base64
        from datetime import datetime
        
        # Get save path from global settings
        gsm = get_global_settings_manager()
        global_settings = gsm.get()
        save_path = global_settings.manual_screenshot_path
        
        if not save_path:
            # Default path
            save_path = os.path.join(PROJECT_ROOT, "截图")
        
        # Ensure directory exists
        os.makedirs(save_path, exist_ok=True)
        
        device_id = get_active_device_id()
        if not device_id:
            return {"status": "error", "message": "未选择设备"}
        
        device_factory = get_device_factory()
        screenshot = device_factory.get_screenshot(device_id)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"screenshot_{timestamp}.png"
        file_path = os.path.join(save_path, filename)
        
        with open(file_path, 'wb') as f:
            f.write(base64.b64decode(screenshot.base64_data))
        
        return {
            "status": "success", 
            "message": f"截图已保存",
            "path": file_path
        }
    except Exception as e:
        import traceback
        return {"status": "error", "message": str(e), "traceback": traceback.format_exc()}

@app.get("/api/screenshot/latest")
def get_latest_screenshot(device_id: Optional[str] = None):
    """Get the latest screenshot info for monitoring."""
    
    # If no device specified, use the globally selected device
    if not device_id:
        gsm = get_global_settings_manager()
        device_id = gsm.get().last_selected_device

    if device_id:
        dm = get_device_data_manager()
        
        # Resolve Folder Name
        # 1. Try Cache (IP/Serial -> Android ID)
        android_id = DEVICE_IP_TO_ANDROID_ID.get(device_id)
        
        # 2. If not in cache, maybe device_id IS the android_id? (Offline view)
        # Check if a folder exists with this name (sanitized)
        if not android_id:
             potential_folder = dm.get_device_folder_name(device_id)
             if os.path.exists(os.path.join(PROJECT_ROOT, "data", "devices", potential_folder)):
                 android_id = device_id
        
        # 3. If we successfully resolved an Android ID (or passed one), use it
        if android_id:
            folder = dm.get_device_folder_name(android_id)
            dev_path = os.path.join(PROJECT_ROOT, "data", "devices", folder, "temp_screenshots", "latest_screenshot.png")
            
            if os.path.exists(dev_path):
                mtime = os.path.getmtime(dev_path)
                return {
                    "exists": True,
                    "url": f"/devices_data/{folder}/temp_screenshots/latest_screenshot.png",
                    "timestamp": mtime
                }
        
        return {
            "exists": False,
            "url": None,
            "timestamp": None
        }
        
    # Only fallback if NO device is selected globally either
    return {
        "exists": False,
        "url": None,
        "timestamp": None
    }

# Note: Legacy /temp_screenshots/{filename} route removed.
# Screenshots are now served via /devices_data/{folder}/temp_screenshots/


@app.post("/api/chat")
def chat(request: ChatRequest):
    global agent
    
    # Determine target device
    gsm = get_global_settings_manager()
    global_settings = gsm.get()
    target_device = request.device_id or global_settings.last_selected_device
    
    # Resolve Configuration: Device Profile -> Global Settings
    dm = get_device_data_manager()
    pm = get_profile_manager()
    
    active_settings_source = None
    
    # Resolve Android ID
    android_id = resolve_android_id(target_device) or target_device
    assigned_profile_name = dm.get_profile_name(android_id) if target_device else None
    
    if not assigned_profile_name:
        print(f"Error: No profile assigned to device '{target_device}' (AndroidID: {android_id}).")
        return {"error": f"设备 '{target_device}' 未绑定任何配置文件。请先在设备管理页面选择配置。"}

    profile = pm.get_profile(assigned_profile_name)
    if not profile:
        print(f"Error: Assigned profile '{assigned_profile_name}' not found.")
        return {"error": f"设备已绑定配置 '{assigned_profile_name}'，但该配置不存在。请重新选择。"}
    
    print(f"Using assigned profile '{assigned_profile_name}' for device '{target_device}'")
    active_settings_source = profile
            
    # Check if we need to re-initialize agent
    reinit_agent = False
    if not agent:
        reinit_agent = True
    elif agent.agent_config.device_id != target_device:
        if agent.is_running:
            # Cannot switch while running
            return {"error": f"Agent is currently busy with device {agent.agent_config.device_id}. Please wait or stop the current task."}
        reinit_agent = True
    # NOTE: We partially support re-init on profile change if user stops agent manually. 
    # Logic to detect config difference vs running agent is complex, so we rely on explicit device switch or restart.
        
    if reinit_agent:
        # Initialize from resolved settings source
        print(f"Initializing agent for device {target_device}...")
        try:
            # Determine active config based on mode
            active_config = active_settings_source.cloud if active_settings_source.mode == "cloud" else active_settings_source.local
            
            model_config = ModelConfig(
                base_url=active_config.base_url,
                model_name=active_config.model_name,
                api_key=active_config.api_key
            )
            # Agent Config
            # Build custom system prompt with conversation prefix if set
            base_system_prompt = None
            if active_settings_source.conversation_prefix and active_settings_source.conversation_prefix.strip():
                # Import the default system prompt constant
                from phone_agent.config.prompts import SYSTEM_PROMPT
                # Prepend the custom prefix as additional instructions
                base_system_prompt = f"{active_settings_source.conversation_prefix.strip()}\n\n{SYSTEM_PROMPT}"
                print(f"\n{'='*60}")
                print(f"✅ 已将对话前置内容注入到系统提示词:")
                # User custom prefix
                print(f"{active_settings_source.conversation_prefix.strip()}")
                print(f"{'='*60}\n")
            
            # Determine screenshot path: data/devices/{folder}/temp_screenshots
            # Use DeviceDataManager to get safe folder via Android ID
            dm = get_device_data_manager()
            # android_id resolved above
            folder = dm.get_device_folder_name(android_id)
            dev_data_dir = os.path.join(PROJECT_ROOT, "data", "devices", folder, "temp_screenshots")
            os.makedirs(dev_data_dir, exist_ok=True)

            agent_conf = AgentConfig(
                max_steps=active_settings_source.agent.max_steps if active_settings_source.agent else 100,
                device_id=target_device, # Agent still connects via IP
                verbose=active_settings_source.agent.verbose if active_settings_source.agent else False,
                screenshot_save_path=dev_data_dir,
                system_prompt=base_system_prompt  # Use custom prompt if prefix is set
            )
            agent = PhoneAgent(model_config=model_config, agent_config=agent_conf)
        except Exception as e:
            print(f"Agent init failed: {e}")
            return {"error": f"Failed to initialize agent: {str(e)}"}
    
    # Load history
    # Load history for specific device
    history = load_chat_history(target_device)
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
            save_chat_history(history, target_device)
            
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
            save_chat_history(history, target_device)

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
