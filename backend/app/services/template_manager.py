"""Template Manager service for loading, parsing, and resolving robot platform templates and plugins."""

import os
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None  # Fallback handled gracefully

logger = logging.getLogger(__name__)


class TemplateManager:
    """Manages robot platform templates, baseline configurations, and recommended plugins."""

    def __init__(self, templates_dir: Optional[str] = None):
        if templates_dir is None:
            # Default to backend/templates directory relative to workspace
            base_dir = Path(__file__).resolve().parent.parent.parent
            templates_dir = os.path.join(base_dir, "templates")

        self.templates_dir = Path(templates_dir)
        self.baseline_dir = self.templates_dir / "baseline"
        self.platforms_dir = self.templates_dir / "platforms"
        self.plugins_dir = self.templates_dir / "plugins"

    def _read_yaml(self, file_path: Path) -> Dict[str, Any]:
        """Read and parse a YAML file."""
        if not file_path.exists():
            logger.warning(f"Template file not found: {file_path}")
            return {}

        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            if yaml:
                return yaml.safe_load(content) or {}
            else:
                # Basic JSON fallback if content is JSON
                import json
                try:
                    return json.loads(content)
                except Exception:
                    logger.error("PyYAML is required to parse YAML template files")
                    return {}

    def get_baseline(self, baseline_id: str = "default_robot") -> Dict[str, Any]:
        """Retrieve baseline configuration requirements."""
        baseline_file = self.baseline_dir / f"{baseline_id}.yaml"
        return self._read_yaml(baseline_file)

    def list_plugins(self) -> List[Dict[str, Any]]:
        """List all available plugin definitions."""
        plugins = []
        if not self.plugins_dir.exists():
            return plugins

        for file_path in self.plugins_dir.glob("*.yaml"):
            data = self._read_yaml(file_path)
            if data:
                plugins.append(data)
        return plugins

    def get_plugin(self, plugin_id: str) -> Optional[Dict[str, Any]]:
        """Get specific plugin definition by ID."""
        plugin_file = self.plugins_dir / f"{plugin_id}.yaml"
        return self._read_yaml(plugin_file) if plugin_file.exists() else None

    def list_platform_templates(self) -> List[Dict[str, Any]]:
        """List all registered platform templates with merged metadata."""
        templates = []
        if not self.platforms_dir.exists():
            return templates

        for file_path in self.platforms_dir.glob("*.yaml"):
            data = self._read_yaml(file_path)
            if data:
                # Attach resolved plugins
                rec_plugins = data.get("recommended_plugins", [])
                resolved_plugins = []
                for p_id in rec_plugins:
                    p_data = self.get_plugin(p_id)
                    if p_data:
                        resolved_plugins.append(p_data)
                data["resolved_plugins"] = resolved_plugins
                templates.append(data)
        return templates

    def get_platform_template(self, template_id: str) -> Optional[Dict[str, Any]]:
        """Get full platform template specification by ID."""
        file_path = self.platforms_dir / f"{template_id}.yaml"
        if not file_path.exists():
            return None

        template_data = self._read_yaml(file_path)
        if not template_data:
            return None

        # Resolve baseline reference
        baseline_id = template_data.get("baseline_ref", "default_robot")
        baseline_data = self.get_baseline(baseline_id)
        template_data["resolved_baseline"] = baseline_data

        # Resolve plugin specs
        rec_plugins = template_data.get("recommended_plugins", [])
        resolved_plugins = []
        for p_id in rec_plugins:
            p_data = self.get_plugin(p_id)
            if p_data:
                resolved_plugins.append(p_data)
        template_data["resolved_plugins"] = resolved_plugins

        return template_data

    def generate_robot_config(
        self,
        template_id: str,
        robot_id: str,
        robot_name: str,
        host: str,
        port: int = 9090,
        selected_plugins: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Synthesize a complete runtime configuration for a new robot instance based on a template."""
        template = self.get_platform_template(template_id)
        if not template:
            raise ValueError(f"Unknown template ID: {template_id}")

        active_plugins = selected_plugins if selected_plugins is not None else template.get("recommended_plugins", [])
        
        # Build composite config
        config = {
            "robot_id": robot_id,
            "robot_name": robot_name,
            "platform_type": template.get("id"),
            "host": host,
            "port": port,
            "baseline": template.get("resolved_baseline", {}),
            "capabilities": template.get("capabilities", {}),
            "camera_specs": template.get("camera_specs", {}),
            "enabled_plugins": active_plugins,
            "topics": template.get("default_topics", []),
        }

        # Add plugin-specific settings
        plugin_configs = {}
        for p_id in active_plugins:
            p_spec = self.get_plugin(p_id)
            if p_spec:
                plugin_configs[p_id] = p_spec

        config["plugin_configs"] = plugin_configs
        return config
