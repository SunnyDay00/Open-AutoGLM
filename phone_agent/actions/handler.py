"""Action handler for processing AI model outputs."""

import ast
import re
import subprocess
import time
from dataclasses import dataclass
from typing import Any, Callable

from phone_agent.config.timing import TIMING_CONFIG
from phone_agent.device_factory import get_device_factory


@dataclass
class ActionResult:
    """Result of an action execution."""

    success: bool
    should_finish: bool
    message: str | None = None
    requires_confirmation: bool = False


class ActionHandler:
    """
    Handles execution of actions from AI model output.

    Args:
        device_id: Optional ADB device ID for multi-device setups.
        confirmation_callback: Optional callback for sensitive action confirmation.
            Should return True to proceed, False to cancel.
        takeover_callback: Optional callback for takeover requests (login, captcha).
    """

    def __init__(
        self,
        device_id: str | None = None,
        confirmation_callback: Callable[[str], bool] | None = None,
        takeover_callback: Callable[[str], None] | None = None,
    ):
        self.device_id = device_id
        self.confirmation_callback = confirmation_callback or self._default_confirmation
        self.takeover_callback = takeover_callback or self._default_takeover
        self.notes = []

    def get_notes(self) -> list[str]:
        """Get all recorded notes."""
        return self.notes

    def clear_notes(self) -> None:
        """Clear all recorded notes."""
        self.notes = []

    def execute(
        self, action: dict[str, Any], screen_width: int, screen_height: int
    ) -> ActionResult:
        """
        Execute an action from the AI model.

        Args:
            action: The action dictionary from the model.
            screen_width: Current screen width in pixels.
            screen_height: Current screen height in pixels.

        Returns:
            ActionResult indicating success and whether to finish.
        """
        action_type = action.get("_metadata")

        if action_type == "finish":
            return ActionResult(
                success=True, should_finish=True, message=action.get("message")
            )

        if action_type != "do":
            return ActionResult(
                success=False,
                should_finish=True,
                message=f"Unknown action type: {action_type}",
            )

        action_name = action.get("action")
        handler_method = self._get_handler(action_name)

        if handler_method is None:
            return ActionResult(
                success=False,
                should_finish=False,
                message=f"Unknown action: {action_name}",
            )

        try:
            return handler_method(action, screen_width, screen_height)
        except Exception as e:
            return ActionResult(
                success=False, should_finish=False, message=f"Action failed: {e}"
            )

    def _get_handler(self, action_name: str) -> Callable | None:
        """Get the handler method for an action."""
        handlers = {
            "Launch": self._handle_launch,
            "Tap": self._handle_tap,
            "Type": self._handle_type,
            "Type_Name": self._handle_type,
            "Swipe": self._handle_swipe,
            "Back": self._handle_back,
            "Home": self._handle_home,
            "Double Tap": self._handle_double_tap,
            "Long Press": self._handle_long_press,
            "Wait": self._handle_wait,
            "Take_over": self._handle_takeover,
            "Note": self._handle_note,
            "Call_API": self._handle_call_api,
            "Interact": self._handle_interact,
        }
        return handlers.get(action_name)

    def _convert_relative_to_absolute(
        self, element: list[int], screen_width: int, screen_height: int
    ) -> tuple[int, int]:
        """Convert relative coordinates (0-1000) to absolute pixels."""
        x = int(element[0] / 1000 * screen_width)
        y = int(element[1] / 1000 * screen_height)
        return x, y

    def _handle_launch(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle app launch action."""
        app_name = action.get("app")
        if not app_name:
            return ActionResult(False, False, "No app name specified")

        device_factory = get_device_factory()
        success = device_factory.launch_app(app_name, self.device_id)
        if success:
            return ActionResult(True, False)
        return ActionResult(False, False, f"App not found: {app_name}")

    def _handle_tap(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle tap action."""
        element = action.get("element")
        if not element:
            return ActionResult(False, False, "No element coordinates")

        x, y = self._convert_relative_to_absolute(element, width, height)

        # Check for sensitive operation
        if "message" in action:
            if not self.confirmation_callback(action["message"]):
                return ActionResult(
                    success=False,
                    should_finish=True,
                    message="User cancelled sensitive operation",
                )

        device_factory = get_device_factory()
        device_factory.tap(x, y, self.device_id)
        return ActionResult(True, False)

    def _handle_type(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle text input action."""
        text = action.get("text", "")

        device_factory = get_device_factory()

        # Switch to ADB keyboard
        original_ime = device_factory.detect_and_set_adb_keyboard(self.device_id)
        time.sleep(TIMING_CONFIG.action.keyboard_switch_delay)

        # Clear existing text and type new text
        device_factory.clear_text(self.device_id)
        time.sleep(TIMING_CONFIG.action.text_clear_delay)

        # Handle multiline text by splitting on newlines
        device_factory.type_text(text, self.device_id)
        time.sleep(TIMING_CONFIG.action.text_input_delay)

        # Restore original keyboard
        device_factory.restore_keyboard(original_ime, self.device_id)
        time.sleep(TIMING_CONFIG.action.keyboard_restore_delay)

        return ActionResult(True, False)

    def _handle_swipe(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle swipe action."""
        start = action.get("start")
        end = action.get("end")

        if not start or not end:
            return ActionResult(False, False, "Missing swipe coordinates")

        start_x, start_y = self._convert_relative_to_absolute(start, width, height)
        end_x, end_y = self._convert_relative_to_absolute(end, width, height)

        device_factory = get_device_factory()
        device_factory.swipe(start_x, start_y, end_x, end_y, device_id=self.device_id)
        return ActionResult(True, False)

    def _handle_back(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle back button action."""
        device_factory = get_device_factory()
        device_factory.back(self.device_id)
        return ActionResult(True, False)

    def _handle_home(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle home button action."""
        device_factory = get_device_factory()
        device_factory.home(self.device_id)
        return ActionResult(True, False)

    def _handle_double_tap(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle double tap action."""
        element = action.get("element")
        if not element:
            return ActionResult(False, False, "No element coordinates")

        x, y = self._convert_relative_to_absolute(element, width, height)
        device_factory = get_device_factory()
        device_factory.double_tap(x, y, self.device_id)
        return ActionResult(True, False)

    def _handle_long_press(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle long press action."""
        element = action.get("element")
        if not element:
            return ActionResult(False, False, "No element coordinates")

        x, y = self._convert_relative_to_absolute(element, width, height)
        device_factory = get_device_factory()
        device_factory.long_press(x, y, device_id=self.device_id)
        return ActionResult(True, False)

    def _handle_wait(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle wait action."""
        duration_str = action.get("duration", "1 seconds")
        try:
            duration = float(duration_str.replace("seconds", "").strip())
        except ValueError:
            duration = 1.0

        time.sleep(duration)
        return ActionResult(True, False)

    def _handle_takeover(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle takeover request (login, captcha, etc.)."""
        message = action.get("message", "User intervention required")
        self.takeover_callback(message)
        return ActionResult(True, False)

    def _handle_note(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle note action (placeholder for content recording)."""
        content = action.get("content")
        if content:
            self.notes.append(content)
            return ActionResult(True, False, message=f"Note saved: {content[:50]}...")
        return ActionResult(False, False, "Missing note content")

    def _handle_call_api(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle API call action (placeholder for summarization)."""
        # This action is typically used for content summarization
        # Implementation depends on specific requirements
        return ActionResult(True, False)

    def _handle_interact(self, action: dict, width: int, height: int) -> ActionResult:
        """Handle interaction request (user choice needed)."""
        # This action signals that user input is needed
        return ActionResult(True, False, message="User interaction required")

    def _send_keyevent(self, keycode: str) -> None:
        """Send a keyevent to the device."""
        from phone_agent.device_factory import DeviceType, get_device_factory
        from phone_agent.hdc.connection import _run_hdc_command

        device_factory = get_device_factory()

        # Handle HDC devices with HarmonyOS-specific keyEvent command
        if device_factory.device_type == DeviceType.HDC:
            hdc_prefix = ["hdc", "-t", self.device_id] if self.device_id else ["hdc"]
            
            # Map common keycodes to HarmonyOS keyEvent codes
            # KEYCODE_ENTER (66) -> 2054 (HarmonyOS Enter key code)
            if keycode == "KEYCODE_ENTER" or keycode == "66":
                _run_hdc_command(
                    hdc_prefix + ["shell", "uitest", "uiInput", "keyEvent", "2054"],
                    capture_output=True,
                    text=True,
                )
            else:
                # For other keys, try to use the numeric code directly
                # If keycode is a string like "KEYCODE_ENTER", convert it
                try:
                    # Try to extract numeric code from string or use as-is
                    if keycode.startswith("KEYCODE_"):
                        # For now, only handle ENTER, other keys may need mapping
                        if "ENTER" in keycode:
                            _run_hdc_command(
                                hdc_prefix + ["shell", "uitest", "uiInput", "keyEvent", "2054"],
                                capture_output=True,
                                text=True,
                            )
                        else:
                            # Fallback to ADB-style command for unsupported keys
                            subprocess.run(
                                hdc_prefix + ["shell", "input", "keyevent", keycode],
                                capture_output=True,
                                text=True,
                            )
                    else:
                        # Assume it's a numeric code
                        _run_hdc_command(
                            hdc_prefix + ["shell", "uitest", "uiInput", "keyEvent", str(keycode)],
                            capture_output=True,
                            text=True,
                        )
                except Exception:
                    # Fallback to ADB-style command
                    subprocess.run(
                        hdc_prefix + ["shell", "input", "keyevent", keycode],
                        capture_output=True,
                        text=True,
                    )
        else:
            # ADB devices use standard input keyevent command
            cmd_prefix = ["adb", "-s", self.device_id] if self.device_id else ["adb"]
            subprocess.run(
                cmd_prefix + ["shell", "input", "keyevent", keycode],
                capture_output=True,
                text=True,
            )

    @staticmethod
    def _default_confirmation(message: str) -> bool:
        """Default confirmation callback using console input."""
        response = input(f"Sensitive operation: {message}\nConfirm? (Y/N): ")
        return response.upper() == "Y"

    @staticmethod
    def _default_takeover(message: str) -> None:
        """Default takeover callback using console input."""
        input(f"{message}\nPress Enter after completing manual operation...")


def parse_action(response: str) -> dict[str, Any]:
    """
    Parse action from model response.

    Args:
        response: Raw response string from the model.

    Returns:
        Parsed action dictionary.

    Raises:
        ValueError: If the response cannot be parsed.
    """
    original_response = response  # Keep original for error logging
    
    try:
        response = response.strip()
        
        # === Handle Type/Type_Name actions ===
        # These need special handling due to text content that may contain special chars
        if response.startswith('do(action="Type"') or response.startswith('do(action="Type_Name"'):
            try:
                # Try AST parsing first (safer)
                escaped = response.replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
                tree = ast.parse(escaped, mode="eval")
                if isinstance(tree.body, ast.Call):
                    action = {"_metadata": "do"}
                    for keyword in tree.body.keywords:
                        action[keyword.arg] = ast.literal_eval(keyword.value)
                    return action
            except (SyntaxError, ValueError) as ast_err:
                # Fallback to string extraction for Type actions
                print(f"[parse_action] AST failed for Type, using fallback: {ast_err}")
                try:
                    if 'text="' in response:
                        # Extract text between text=" and the closing ")
                        text_start = response.index('text="') + 6
                        # Find matching closing quote (handle escaped quotes)
                        text_end = len(response) - 2  # Assume ends with ")
                        text = response[text_start:text_end]
                        action = {"_metadata": "do", "action": "Type", "text": text}
                        return action
                    elif "text='" in response:
                        text_start = response.index("text='") + 6
                        text_end = len(response) - 2
                        text = response[text_start:text_end]
                        action = {"_metadata": "do", "action": "Type", "text": text}
                        return action
                except Exception as fallback_err:
                    print(f"[parse_action] ERROR: Type action fallback failed: {fallback_err}")
                    raise ValueError(f"Failed to parse Type action: {fallback_err}")
        
        # === Handle other do() actions ===
        elif response.startswith("do"):
            try:
                # Escape special characters for valid Python syntax
                escaped = response.replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
                tree = ast.parse(escaped, mode="eval")
                
                if not isinstance(tree.body, ast.Call):
                    raise ValueError("Expected a function call")

                action = {"_metadata": "do"}
                for keyword in tree.body.keywords:
                    key = keyword.arg
                    value = ast.literal_eval(keyword.value)
                    action[key] = value

                return action
            except (SyntaxError, ValueError) as e:
                # Fallback: Try regex extraction for actions with message (Take_over, Note, etc.)
                print(f"[parse_action] WARNING: AST failed for do(), using fallback: {e}")
                try:
                    # Extract action name
                    action_match = re.search(r'action\s*=\s*["\']([^"\']+)["\']', response)
                    if action_match:
                        action_name = action_match.group(1)
                        action = {"_metadata": "do", "action": action_name}
                        
                        # Extract message if present (greedy match to end)
                        msg_match = re.search(r'message\s*=\s*["\'](.+)["\']?\s*\)?$', response, re.DOTALL)
                        if msg_match:
                            message = msg_match.group(1)
                            # Clean up trailing quote and parenthesis
                            if message.endswith('")') or message.endswith("')"):
                                message = message[:-2]
                            elif message.endswith('"') or message.endswith("'"):
                                message = message[:-1]
                            action["message"] = message
                        
                        # Extract element if present (for Tap, Swipe, etc.)
                        elem_match = re.search(r'element\s*=\s*\[([^\]]+)\]', response)
                        if elem_match:
                            coords = elem_match.group(1).split(',')
                            action["element"] = [int(c.strip()) for c in coords]
                        
                        # Extract other common parameters
                        app_match = re.search(r'app\s*=\s*["\']([^"\']+)["\']', response)
                        if app_match:
                            action["app"] = app_match.group(1)
                        
                        duration_match = re.search(r'duration\s*=\s*["\']([^"\']+)["\']', response)
                        if duration_match:
                            action["duration"] = duration_match.group(1)
                        
                        return action
                    else:
                        raise ValueError("Could not extract action name")
                except Exception as fallback_err:
                    print(f"[parse_action] ERROR: do() fallback also failed: {fallback_err}")
                    print(f"[parse_action] ERROR: Original response: {original_response}")
                    raise ValueError(f"Failed to parse do() action: {e}")

        # === Handle finish() actions ===
        elif response.startswith("finish"):
            try:
                escaped = response.replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
                tree = ast.parse(escaped, mode="eval")
                
                if not isinstance(tree.body, ast.Call):
                    raise ValueError("Expected a function call")
                
                call = tree.body
                action = {"_metadata": "finish"}
                
                # Handle finish(message="...") keyword argument
                if call.keywords:
                    for keyword in call.keywords:
                        if keyword.arg == "message":
                            action["message"] = ast.literal_eval(keyword.value)
                # Handle finish("...") positional argument
                elif call.args:
                    if isinstance(call.args[0], (ast.Str, ast.Constant)):
                        action["message"] = ast.literal_eval(call.args[0]) if hasattr(ast, 'Constant') else call.args[0].s
                
                # If no message found, extract from string as fallback
                if "message" not in action:
                    if 'message="' in response:
                        msg_start = response.index('message="') + 9
                        msg_end = response.rindex('"')
                        action["message"] = response[msg_start:msg_end]
                    elif "message='" in response:
                        msg_start = response.index("message='") + 9
                        msg_end = response.rindex("'")
                        action["message"] = response[msg_start:msg_end]
                    else:
                        action["message"] = "Task completed"
                
                return action
                
            except (SyntaxError, ValueError) as e:
                # Fallback for malformed finish()
                print(f"[parse_action] WARNING: AST parse failed for finish, using fallback: {e}")
                try:
                    if 'message="' in response:
                        msg_start = response.index('message="') + 9
                        msg_end = response.rindex('"')
                        message = response[msg_start:msg_end]
                    elif "message='" in response:
                        msg_start = response.index("message='") + 9
                        msg_end = response.rindex("'")
                        message = response[msg_start:msg_end]
                    else:
                        message = response.replace("finish(", "").rstrip(")")
                    
                    action = {"_metadata": "finish", "message": message}
                    return action
                except Exception as fallback_err:
                    print(f"[parse_action] ERROR: finish() fallback failed: {fallback_err}")
                    raise ValueError(f"Failed to parse finish action: {fallback_err}")
        else:
            print(f"[parse_action] ERROR: Unknown action format: {response[:100]}")
            raise ValueError(f"Unknown action format, expected 'do(...)' or 'finish(...)': {response[:100]}")
            
    except ValueError:
        # Re-raise ValueError as-is (already logged)
        raise
    except Exception as e:
        print(f"[parse_action] ERROR: Unexpected error: {type(e).__name__}: {e}")
        print(f"[parse_action] ERROR: Original response: {original_response}")
        raise ValueError(f"Failed to parse action: {type(e).__name__}: {e}")


def do(**kwargs) -> dict[str, Any]:
    """Helper function for creating 'do' actions."""
    kwargs["_metadata"] = "do"
    return kwargs


def finish(**kwargs) -> dict[str, Any]:
    """Helper function for creating 'finish' actions."""
    kwargs["_metadata"] = "finish"
    return kwargs
