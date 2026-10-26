import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

import sys
import os

# Ensure backend and agent are in python path
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from app.api.v1.endpoints.vobiz import _lookup_returning_caller_profile


class TestCallerMemory(unittest.IsolatedAsyncioTestCase):
    """Unit tests for Returning Caller Memory & Recognition."""

    async def test_virtual_did_not_looked_up(self):
        """Virtual DID numbers (+918065354620) must be skipped as returning callers."""
        db = AsyncMock()
        profile = await _lookup_returning_caller_profile(db, "+918065354620")
        self.assertIsNone(profile)
        db.execute.assert_not_called()

    async def test_empty_or_unknown_phone_skipped(self):
        """Empty, Unknown, or short phone numbers must return None immediately."""
        db = AsyncMock()
        self.assertIsNone(await _lookup_returning_caller_profile(db, "Unknown"))
        self.assertIsNone(await _lookup_returning_caller_profile(db, ""))
        self.assertIsNone(await _lookup_returning_caller_profile(db, "123"))

    async def test_returning_caller_profile_extracted_from_db(self):
        """Past call with name and email must be parsed into returning profile."""
        mock_past_call = MagicMock()
        mock_past_call.id = "call_past_123"
        mock_past_call.from_number = "+918830631380"
        mock_past_call.to_number = "+918065354620"
        mock_past_call.call_meta = {
            "customer_name": "Nisha Teli",
            "captured_email": "nishateli08@gmail.com",
            "specialty": "Dental Care",
            "conversation_history": [
                {"role": "user", "content": "my name is Nisha Teli"},
                {"role": "assistant", "content": "Hello Nisha Teli"}
            ]
        }

        mock_db = AsyncMock()
        mock_res = MagicMock()
        mock_res.scalars.return_value.all.return_value = [mock_past_call]
        mock_db.execute.return_value = mock_res

        profile = await _lookup_returning_caller_profile(
            db=mock_db,
            customer_phone="+918830631380",
            current_call_id="call_current_456"
        )

        self.assertIsNotNone(profile)
        self.assertEqual(profile["customer_name"], "Nisha Teli")
        self.assertEqual(profile["first_name"], "Nisha")
        self.assertEqual(profile["customer_email"], "nishateli08@gmail.com")
        self.assertEqual(profile["last_service"], "Dental Care")
        self.assertEqual(profile["call_count"], 1)

    async def test_name_extracted_from_dialogue_fallback(self):
        """If customer_name key is missing, extracts name from dialogue heuristics."""
        mock_past_call = MagicMock()
        mock_past_call.id = "call_past_789"
        mock_past_call.from_number = "+919988776655"
        mock_past_call.to_number = "+918065354620"
        mock_past_call.call_meta = {
            "conversation_history": [
                {"role": "user", "content": "I want to book an appointment"},
                {"role": "assistant", "content": "Thank you, I have noted your name as Karan Mehta"}
            ],
            "sync_results": {
                "recipient": "karan.mehta@example.in"
            }
        }

        mock_db = AsyncMock()
        mock_res = MagicMock()
        mock_res.scalars.return_value.all.return_value = [mock_past_call]
        mock_db.execute.return_value = mock_res

        profile = await _lookup_returning_caller_profile(
            db=mock_db,
            customer_phone="+919988776655",
            current_call_id="call_new_999"
        )

        self.assertIsNotNone(profile)
        self.assertEqual(profile["customer_name"], "Karan Mehta")
        self.assertEqual(profile["first_name"], "Karan")
        self.assertEqual(profile["customer_email"], "karan.mehta@example.in")

    async def test_phonetic_misha_to_nisha_normalization(self):
        """If ASR transcribed Misha but email is nishateli08@gmail.com, corrects name to Nisha."""
        mock_past_call = MagicMock()
        mock_past_call.id = "call_past_phonetic"
        mock_past_call.from_number = "+918830631380"
        mock_past_call.to_number = "+918065354620"
        mock_past_call.call_meta = {
            "customer_name": "Misha Teli",
            "captured_email": "nishateli08@gmail.com",
        }

        mock_db = AsyncMock()
        mock_res = MagicMock()
        mock_res.scalars.return_value.all.return_value = [mock_past_call]
        mock_db.execute.return_value = mock_res

        profile = await _lookup_returning_caller_profile(
            db=mock_db,
            customer_phone="+918830631380",
            current_call_id="call_new_current"
        )

        self.assertIsNotNone(profile)
        self.assertEqual(profile["first_name"], "Nisha")
        self.assertEqual(profile["customer_name"], "Nisha Teli")


if __name__ == "__main__":
    unittest.main()
