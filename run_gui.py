import subprocess
import time
import webbrowser
import os
import sys

import socket

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('localhost', port)) == 0

def run_gui():
    print("Starting AutoGLM GUI...")

    # Check ports
    if is_port_in_use(8000):
        print("Error: Port 8000 is already in use. Is the backend already running?")
        sys.exit(1)
    if is_port_in_use(5173):
        print("Error: Port 5173 is already in use. Is the frontend already running?")
        sys.exit(1)
    
    backend_cmd = [sys.executable, "-m", "uvicorn", "gui.backend.main:app", "--reload", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
    backend_process = subprocess.Popen(backend_cmd, cwd=os.getcwd())
    print(f"Backend started (PID: {backend_process.pid})")

    # 2. Start Frontend
    frontend_cwd = os.path.join(os.getcwd(), "gui", "frontend")
    # Use npm.cmd on Windows
    npm_cmd = "npm.cmd" if os.name == 'nt' else "npm"
    frontend_cmd = [npm_cmd, "run", "dev"]
    frontend_process = subprocess.Popen(frontend_cmd, cwd=frontend_cwd)
    print(f"Frontend started (PID: {frontend_process.pid})")

    print("Waiting for services to initialize...")
    time.sleep(3)
    
    # Open Browser
    # webbrowser.open("http://localhost:5173")
    
    try:
        backend_process.wait()
        frontend_process.wait()
    except KeyboardInterrupt:
        print("\nShutting down services...")
        backend_process.terminate()
        frontend_process.terminate()

if __name__ == "__main__":
    run_gui()
