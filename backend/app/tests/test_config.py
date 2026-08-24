import unittest

from app.config import settings


class TestConfig(unittest.TestCase):
    def test_settings_initialization(self):
        """Test default application settings and ports."""
        self.assertEqual(settings.APP_NAME, "GCS Backend")
        self.assertEqual(settings.PORT, 8000)
        self.assertEqual(settings.ROSBRIDGE_DEFAULT_PORT, 9090)

    def test_allowed_topics(self):
        """Test that essential fleet topics are in the allowed topics list."""
        self.assertIn("/battery_state", settings.ALLOWED_TOPICS)
        self.assertIn("/teleop_mode_status", settings.ALLOWED_TOPICS)
        self.assertIn("/cmd_vel", settings.ALLOWED_TOPICS)
        self.assertIn("/gcs/cmd_vel", settings.ALLOWED_TOPICS)
        self.assertIn("/odom", settings.ALLOWED_TOPICS)
        self.assertIn("/scan", settings.ALLOWED_TOPICS)

    def test_blocked_patterns(self):
        """Test that heavy streaming topics are blocked from json rosbridge routing."""
        self.assertIn("image", settings.BLOCKED_PATTERNS)
        self.assertIn("depth", settings.BLOCKED_PATTERNS)
        self.assertIn("points", settings.BLOCKED_PATTERNS)

    def test_topic_throttle_rates(self):
        """Test throttle rates for high frequency topics."""
        self.assertEqual(settings.TOPIC_THROTTLE_RATES.get("/scan"), 200)
        self.assertEqual(settings.TOPIC_THROTTLE_RATES.get("/odom"), 100)


if __name__ == "__main__":
    unittest.main()
