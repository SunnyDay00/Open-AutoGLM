"""
Profile and Device Data Management for Multi-Device Support.

This module provides:
- ProfileManager: CRUD operations for configuration profiles
- DeviceDataManager: Device-specific data isolation (history, logs, screenshots)
- GlobalSettings: Simplified global settings management
"""

import os
import json
import hashlib
import random
import string
from datetime import datetime
from typing import Optional, Dict, List, Any
from dataclasses import dataclass, asdict

# Base directory for all data
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, "../../"))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
PROFILES_DIR = os.path.join(DATA_DIR, "profiles")
DEVICES_DIR = os.path.join(DATA_DIR, "devices")
GLOBAL_SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")


def ensure_directories():
    """Ensure all required directories exist."""
    os.makedirs(PROFILES_DIR, exist_ok=True)
    os.makedirs(DEVICES_DIR, exist_ok=True)


# ============================================================================
# Profile Management
# ============================================================================

@dataclass
class ModelConfig:
    """Model configuration for cloud or local."""
    base_url: str = ""
    model_name: str = ""
    api_key: str = ""


@dataclass
class AgentConfig:
    """Agent behavior configuration."""
    max_steps: int = 100
    screenshot_path: str = ""
    verbose: bool = False


@dataclass
class Profile:
    """Complete profile configuration."""
    name: str
    created_at: str
    mode: str = "cloud"  # "cloud" or "local"
    cloud: Optional[ModelConfig] = None
    local: Optional[ModelConfig] = None
    agent: Optional[AgentConfig] = None
    conversation_prefix: str = ""

    def __post_init__(self):
        if self.cloud is None:
            self.cloud = ModelConfig()
        if self.local is None:
            self.local = ModelConfig()
        if self.agent is None:
            self.agent = AgentConfig()
        
        # Convert dicts to dataclasses if needed
        if isinstance(self.cloud, dict):
            self.cloud = ModelConfig(**self.cloud)
        if isinstance(self.local, dict):
            self.local = ModelConfig(**self.local)
        if isinstance(self.agent, dict):
            self.agent = AgentConfig(**self.agent)

    def to_dict(self) -> dict:
        """Convert profile to dictionary for JSON serialization."""
        return {
            "name": self.name,
            "created_at": self.created_at,
            "mode": self.mode,
            "cloud": asdict(self.cloud) if self.cloud else {},
            "local": asdict(self.local) if self.local else {},
            "agent": asdict(self.agent) if self.agent else {},
            "conversation_prefix": self.conversation_prefix
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Profile":
        """Create profile from dictionary."""
        return cls(
            name=data.get("name", "Unnamed"),
            created_at=data.get("created_at", datetime.now().isoformat()),
            mode=data.get("mode", "cloud"),
            cloud=data.get("cloud"),
            local=data.get("local"),
            agent=data.get("agent"),
            conversation_prefix=data.get("conversation_prefix", "")
        )


class ProfileManager:
    """Manage configuration profiles."""

    def __init__(self):
        ensure_directories()
        self._ensure_default_profile()

    def _ensure_default_profile(self):
        """Create default profile if none exists."""
        if not self.list_profiles():
            self.create_profile("默认配置")

    def _get_profile_path(self, name: str) -> str:
        """Get file path for a profile."""
        # Sanitize name for filesystem
        safe_name = "".join(c if c.isalnum() or c in "_ -" else "_" for c in name)
        return os.path.join(PROFILES_DIR, f"{safe_name}.json")

    def list_profiles(self) -> List[str]:
        """List all profile names."""
        profiles = []
        if os.path.exists(PROFILES_DIR):
            for f in os.listdir(PROFILES_DIR):
                if f.endswith(".json"):
                    try:
                        with open(os.path.join(PROFILES_DIR, f), "r", encoding="utf-8") as file:
                            data = json.load(file)
                            profiles.append(data.get("name", f[:-5]))
                    except (json.JSONDecodeError, IOError) as e:
                        # Fallback to filename if JSON is corrupted
                        profiles.append(f[:-5])
        return profiles

    def get_profile(self, name: str) -> Optional[Profile]:
        """Get a profile by name."""
        # Search for profile by name in all files
        if os.path.exists(PROFILES_DIR):
            for f in os.listdir(PROFILES_DIR):
                if f.endswith(".json"):
                    path = os.path.join(PROFILES_DIR, f)
                    try:
                        with open(path, "r", encoding="utf-8") as file:
                            data = json.load(file)
                            if data.get("name") == name:
                                return Profile.from_dict(data)
                    except (json.JSONDecodeError, IOError):
                        continue
        return None

    def create_profile(self, name: str) -> Profile:
        """Create a new profile with given name."""
        if self.get_profile(name):
            raise ValueError(f"Profile '{name}' already exists")

        profile = Profile(
            name=name,
            created_at=datetime.now().isoformat(),
            mode="cloud",
            cloud=ModelConfig(
                base_url="https://open.bigmodel.cn/api/paas/v4",
                model_name="autoglm-phone",
                api_key=""
            ),
            local=ModelConfig(
                base_url="http://localhost:8080/v1",
                model_name="local-model",
                api_key=""
            ),
            agent=AgentConfig(
                max_steps=100,
                screenshot_path=os.path.join(PROJECT_ROOT, "截图"),
                verbose=False
            ),
            conversation_prefix=""
        )

        self.save_profile(profile)
        return profile

    def save_profile(self, profile: Profile) -> None:
        """Save a profile to disk."""
        path = self._get_profile_path(profile.name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(profile.to_dict(), f, ensure_ascii=False, indent=2)

    def delete_profile(self, name: str) -> bool:
        """Delete a profile by name."""
        target_path = None
        
        # Find the profile file
        if os.path.exists(PROFILES_DIR):
            for f in os.listdir(PROFILES_DIR):
                if f.endswith(".json"):
                    path = os.path.join(PROFILES_DIR, f)
                    try:
                        with open(path, "r", encoding="utf-8") as file:
                            data = json.load(file)
                            if data.get("name") == name:
                                target_path = path
                                break
                    except (json.JSONDecodeError, IOError):
                        continue
        
        # Delete file if found (outside resource context to avoid lock issues)
        if target_path:
            try:
                os.remove(target_path)
                return True
            except Exception as e:
                print(f"Error deleting profile file {target_path}: {e}")
                
        return False

    def rename_profile(self, old_name: str, new_name: str) -> bool:
        """Rename a profile."""
        profile = self.get_profile(old_name)
        if not profile:
            return False
        if self.get_profile(new_name):
            raise ValueError(f"Profile '{new_name}' already exists")

        # Delete old file and save with new name
        self.delete_profile(old_name)
        profile.name = new_name
        self.save_profile(profile)
        return True


# ============================================================================
# Device Data Management
# ============================================================================

@dataclass
class DeviceInfo:
    """Device information retrieved from ADB."""
    device_id: str  # IP or Serial
    android_id: str = "Unknown" # UNIQUE IDENTIFIER
    model: str = "Unknown"
    brand: str = "Unknown"
    android_version: str = "Unknown"
    sdk_version: str = "Unknown"
    serial_number: str = "Unknown"
    resolution: str = "Unknown"
    density: str = "Unknown"
    connected: bool = False
    error_message: str = ""
    last_seen: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


class DeviceDataManager:
    """Manage device-specific data storage using Android ID as unique key."""

    def __init__(self):
        ensure_directories()

    def _sanitize_for_folder(self, text: str) -> str:
        """Convert text to safe folder name."""
        # Replace special characters
        safe = text.replace(":", "_").replace("/", "_").replace("\\", "_")
        safe = safe.replace(" ", "_").replace(".", "_")
        # Remove any remaining unsafe characters
        safe = "".join(c if c.isalnum() or c == "_" else "" for c in safe)
        return safe[:50]  # Limit length

    def get_device_folder_name(self, android_id: str) -> str:
        """
        Get folder name for a device based on Android ID.
        Folder name IS the sanitized Android ID.
        """
        return self._sanitize_for_folder(android_id)

    def ensure_device_folder(self, android_id: str) -> str:
        """Ensure folder exists for the given Android ID."""
        folder_name = self.get_device_folder_name(android_id)
        folder_path = os.path.join(DEVICES_DIR, folder_name)
        
        os.makedirs(folder_path, exist_ok=True)
        os.makedirs(os.path.join(folder_path, "screenshots"), exist_ok=True)
        os.makedirs(os.path.join(folder_path, "logs"), exist_ok=True)
        return folder_name

    def save_device_metadata(self, android_id: str, info: DeviceInfo) -> None:
        """Save device metadata to .device file."""
        folder_name = self.ensure_device_folder(android_id)
        path = os.path.join(DEVICES_DIR, folder_name, ".device")
        
        # Update last seen
        info.last_seen = datetime.now().isoformat()
        
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(info.to_dict(), f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Error saving device metadata: {e}")

    def load_device_metadata(self, android_id: str) -> Optional[DeviceInfo]:
        """Load device metadata by Android ID directly into DeviceInfo object."""
        folder = self.get_device_folder_name(android_id)
        data = self.get_device_metadata(folder)
        if data:
            # Filter keys to match DeviceInfo fields
            valid_keys = DeviceInfo.__annotations__.keys()
            filtered_data = {k: v for k, v in data.items() if k in valid_keys}
            return DeviceInfo(**filtered_data)
        return None

    def get_device_metadata(self, folder_name: str) -> Optional[dict]:
        """Load device metadata from folder."""
        path = os.path.join(DEVICES_DIR, folder_name, ".device")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Failed to load device metadata: {e}")
                return None
        return None

    def list_known_devices(self) -> List[dict]:
        """List all known devices from disk."""
        devices = []
        if not os.path.exists(DEVICES_DIR):
            return []
            
        for folder in os.listdir(DEVICES_DIR):
            if os.path.isdir(os.path.join(DEVICES_DIR, folder)):
                meta = self.get_device_metadata(folder)
                if meta:
                    devices.append(meta)
        return devices

    def get_profile_name(self, android_id: str) -> Optional[str]:
        """Get assigned profile name."""
        try:
            folder = self.get_device_folder_name(android_id)
            path = os.path.join(DEVICES_DIR, folder, "profile_name.txt")
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return f.read().strip()
        except (IOError, OSError) as e:
            print(f"Warning: Failed to read profile name: {e}")
            pass
        return None

    def set_profile_name(self, android_id: str, profile_name: str) -> None:
        """Set assigned profile name."""
        folder = self.ensure_device_folder(android_id)
        path = os.path.join(DEVICES_DIR, folder, "profile_name.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(profile_name)

    # Path Helpers (Require Android ID now)
    def get_chat_history_path(self, android_id: str) -> str:
        folder = self.get_device_folder_name(android_id)
        return os.path.join(DEVICES_DIR, folder, "chat_history.json")


# ============================================================================
# Global Settings Management
# ============================================================================

@dataclass
class GlobalSettings:
    """Simplified global settings."""
    last_selected_device: str = ""
    check_device_on_startup: bool = True
    language: str = "cn"
    manual_screenshot_path: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "GlobalSettings":
        return cls(
            last_selected_device=data.get("last_selected_device", ""),
            check_device_on_startup=data.get("check_device_on_startup", True),
            language=data.get("language", "cn"),
            manual_screenshot_path=data.get("manual_screenshot_path", "")
        )


class GlobalSettingsManager:
    """Manage global application settings."""

    def __init__(self):
        ensure_directories()
        self._settings: Optional[GlobalSettings] = None

    def load(self) -> GlobalSettings:
        """Load global settings from file."""
        if os.path.exists(GLOBAL_SETTINGS_FILE):
            try:
                with open(GLOBAL_SETTINGS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self._settings = GlobalSettings.from_dict(data)
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Failed to load global settings: {e}")
                self._settings = GlobalSettings()
        else:
            self._settings = GlobalSettings()
        return self._settings

    def save(self, settings: GlobalSettings) -> None:
        """Save global settings to file."""
        self._settings = settings
        with open(GLOBAL_SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings.to_dict(), f, ensure_ascii=False, indent=2)

    def get(self) -> GlobalSettings:
        """Get current settings, loading if needed."""
        if self._settings is None:
            self.load()
        return self._settings

    def update_last_device(self, device_id: str) -> None:
        """Update the last selected device."""
        settings = self.get()
        settings.last_selected_device = device_id
        self.save(settings)


# ============================================================================
# Singleton Instances
# ============================================================================

_profile_manager: Optional[ProfileManager] = None
_device_data_manager: Optional[DeviceDataManager] = None
_global_settings_manager: Optional[GlobalSettingsManager] = None


def get_profile_manager() -> ProfileManager:
    global _profile_manager
    if _profile_manager is None:
        _profile_manager = ProfileManager()
    return _profile_manager


def get_device_data_manager() -> DeviceDataManager:
    global _device_data_manager
    if _device_data_manager is None:
        _device_data_manager = DeviceDataManager()
    return _device_data_manager


def get_global_settings_manager() -> GlobalSettingsManager:
    global _global_settings_manager
    if _global_settings_manager is None:
        _global_settings_manager = GlobalSettingsManager()
    return _global_settings_manager
