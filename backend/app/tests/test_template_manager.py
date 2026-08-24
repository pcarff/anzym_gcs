import unittest

from app.services.template_manager import TemplateManager


class TestTemplateManager(unittest.TestCase):
    def setUp(self):
        self.tm = TemplateManager()

    def test_real_template_discovery(self):
        """Test that TemplateManager discovers real platform templates including anzym_x3_plus."""
        templates = self.tm.list_platform_templates()
        ids = [t["id"] for t in templates]
        self.assertIn("anzym_x3_plus", ids)
        self.assertIn("anzym_rosorin", ids)
        self.assertIn("anzym_zumo", ids)

    def test_get_x3_plus_template(self):
        """Test retrieving and resolving anzym_x3_plus platform template."""
        template = self.tm.get_platform_template("anzym_x3_plus")
        self.assertIsNotNone(template)
        self.assertEqual(template["id"], "anzym_x3_plus")
        self.assertEqual(template["capabilities"]["drive_type"], "mecanum")
        self.assertTrue(template["capabilities"]["has_arm"])
        self.assertEqual(template["capabilities"]["arm_dof"], 6)
        self.assertEqual(template["camera_specs"]["video_method"], "webrtc")
        self.assertEqual(template["camera_specs"]["webrtc_port"], 8889)

    def test_get_template_not_found(self):
        """Test querying a non-existent template returns None."""
        template = self.tm.get_platform_template("non_existent_template")
        self.assertIsNone(template)

    def test_generate_x3_robot_config(self):
        """Test generating synthesized runtime config for an x3 robot instance."""
        config = self.tm.generate_robot_config(
            template_id="anzym_x3_plus",
            robot_id="x3-01",
            robot_name="AnZym-Green-X3",
            host="192.168.8.246",
            port=9090,
            selected_plugins=["video_webrtc", "foxglove_visualizer", "lidar_2d_3d", "gamepad_teleop"],
        )
        self.assertEqual(config["robot_id"], "x3-01")
        self.assertEqual(config["robot_name"], "AnZym-Green-X3")
        self.assertEqual(config["platform_type"], "anzym_x3_plus")
        self.assertEqual(config["host"], "192.168.8.246")
        self.assertEqual(config["port"], 9090)
        self.assertTrue(config["capabilities"]["has_camera"])
        self.assertTrue(config["capabilities"]["has_arm"])
        self.assertIn("video_webrtc", config["enabled_plugins"])
        self.assertIn("video_webrtc", config["plugin_configs"])
        self.assertIn("foxglove_visualizer", config["plugin_configs"])


if __name__ == "__main__":
    unittest.main()

if __name__ == "__main__":
    unittest.main()
