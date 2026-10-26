import unittest
from unittest.mock import AsyncMock, patch
import sys
import os

backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.api.v1.endpoints.twilio import _normalize_spoken_email_heuristics, _extract_spoken_email


class TestEmailExtraction(unittest.IsolatedAsyncioTestCase):
    """Test suite for spoken email extraction & time disambiguation."""

    def test_appointment_time_not_extracted_as_email(self):
        """Statements with 'tomorrow at 2 p.m.' must NEVER be parsed as email addresses."""
        time_statements = [
            "I want to book an appointment for tomorrow at 2 p.m.",
            "tomorrow at 2 p.m.",
            "appointment at 4 o'clock",
            "can we do it at 10:30 am",
            "at the clinic tomorrow at 3 pm",
            "hello Maya I need an appointment at 5pm",
        ]
        for stmt in time_statements:
            res = _normalize_spoken_email_heuristics(stmt)
            self.assertIsNone(res, f"Time statement '{stmt}' was wrongly extracted as: '{res}'")

    def test_clean_spoken_emails(self):
        """Spoken emails with phonetics must be cleanly extracted."""
        cases = [
            ("my email is nishateli08@gmail.com", "nishateli08@gmail.com"),
            ("my email is Nisha Teli zero eight at the rate gmail dot com", "nishateli08@gmail.com"),
            ("Nisha daily 08 at gmail dot com", "nishateli08@gmail.com"),
            ("send to sia.patel@gmail.com for my daughter", "sia.patel@gmail.com"),
            ("nisha at gmail", "nisha@gmail.com"),
            ("08 at gmail.com", "08@gmail.com"),
        ]
        for stmt, expected in cases:
            res = _normalize_spoken_email_heuristics(stmt, caller_name="Nisha Teli")
            self.assertIsNotNone(res, f"Failed to extract from: '{stmt}'")
            self.assertEqual(res, expected)

    async def test_extract_spoken_email_async(self):
        """Async function must properly delegate and reject time statements."""
        res_time = await _extract_spoken_email("tomorrow at 2 p.m.")
        self.assertIsNone(res_time)

        res_email = await _extract_spoken_email("my email is nishateli08@gmail.com")
        self.assertEqual(res_email, "nishateli08@gmail.com")


if __name__ == "__main__":
    unittest.main()
