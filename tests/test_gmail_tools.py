"""
tests/test_gmail_tools.py

Unit tests for agent/tools/gmail.py covering:
  1. Spoken email pre-cleaning (_clean_email)
  2. Multi-template HTML generation (_build_templated_html)
  3. LiveKit function tool generation (build_gmail_tools)
  4. Execution of all 3 universal Gmail functions with mocked HTTP calls
"""

import unittest
from unittest.mock import patch, AsyncMock
from agent.tools.gmail import (
    _clean_email,
    _build_templated_html,
    send_email,
    send_templated_email,
    send_internal_staff_alert,
    check_recent_email,
    create_email_draft,
    build_gmail_tools,
)


class TestGmailTools(unittest.IsolatedAsyncioTestCase):

    def test_clean_email(self):
        # Normal emails
        self.assertEqual(_clean_email("user@example.com"), "user@example.com")
        self.assertEqual(_clean_email("  User.Name+Tag@domain.co.uk  "), "user.name+tag@domain.co.uk")

        # Spoken / spaced emails
        self.assertEqual(_clean_email("misha dot ty at gmail dot com"), "misha.ty@gmail.com")
        self.assertEqual(_clean_email("sia . patel @ clinic . org"), "sia.patel@clinic.org")
        self.assertEqual(_clean_email("john at the rate yahoo dot com"), "john@yahoo.com")
        self.assertEqual(_clean_email("lead added company dot com"), "lead@company.com")

    def test_build_templated_html(self):
        # 1. Confirmation template
        conf_html = _build_templated_html(
            template_type="confirmation",
            title="Consultation Confirmation",
            customer_name="Sia Patel",
            service_or_item="Dental Consultation",
            scheduled_time_or_slot="Tomorrow at 2:00 PM",
            location_or_address="Clinic Center, MG Road",
            notes_or_message="Please arrive 10 minutes early.",
        )
        self.assertIn("CONFIRMED", conf_html)
        self.assertIn("Sia Patel", conf_html)
        self.assertIn("Dental Consultation", conf_html)
        self.assertIn("Tomorrow at 2:00 PM", conf_html)
        self.assertIn("Clinic Center, MG Road", conf_html)
        self.assertIn("Please arrive 10 minutes early.", conf_html)

        # 2. Brochure template
        brochure_html = _build_templated_html(
            template_type="brochure",
            title="Luxury 3BHK Brochure",
            customer_name="Rahul Sharma",
            service_or_item="Skyline Heights 3BHK",
            scheduled_time_or_slot="",
            location_or_address="",
            notes_or_message="Includes complete floor plan and pricing.",
            resource_url="https://example.com/brochure.pdf",
        )
        self.assertIn("INFORMATION PACK", brochure_html)
        self.assertIn("https://example.com/brochure.pdf", brochure_html)

        # 3. Directions template
        dir_html = _build_templated_html(
            template_type="directions",
            title="Site Office Route",
            customer_name="Karan Mehta",
            service_or_item="",
            scheduled_time_or_slot="",
            location_or_address="Sector 45, Gurgaon",
            notes_or_message="Visitor parking is available in basement 1.",
        )
        self.assertTrue("LOCATION &amp; DIRECTIONS" in dir_html or "LOCATION & DIRECTIONS" in dir_html)
        self.assertIn("google.com/maps", dir_html)
        self.assertIn("Sector 45", dir_html)

        # 4. Quote template
        quote_html = _build_templated_html(
            template_type="quote",
            title="Cardiac Package Estimate",
            customer_name="Sunil Rao",
            service_or_item="Full Cardiac Checkup",
            scheduled_time_or_slot="",
            location_or_address="",
            notes_or_message="Valid for 14 days.",
        )
        self.assertTrue("QUOTATION &amp; PRICING" in quote_html or "QUOTATION & PRICING" in quote_html)
        self.assertIn("Full Cardiac Checkup", quote_html)

    def test_build_gmail_tools_expansion(self):
        t_cfg = {
            "name": "gmail_suite",
            "apiKey": "mock_google_oauth_token_123",
            "config": {"staff_email": "manager@company.com"},
        }
        tools = build_gmail_tools(t_cfg, "gmail", "Google Gmail tool")
        
        # Must expand into 5 function tools
        self.assertEqual(len(tools), 5)
        tool_names = [t.info.name if hasattr(t, "info") else getattr(t, "name") for t in tools]
        
        self.assertIn("gmail_send_email", tool_names)
        self.assertIn("gmail_send_templated_email", tool_names)
        self.assertIn("gmail_send_internal_staff_alert", tool_names)
        self.assertIn("gmail_check_recent_email", tool_names)
        self.assertIn("gmail_create_email_draft", tool_names)

    async def test_send_templated_email_mocked(self):
        with patch("agent.tools.gmail.request_json", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = (200, {"id": "18e12345"})
            
            result = await send_templated_email(
                token="valid_token",
                recipient="test@example.com",
                template_type="confirmation",
                title="Appointment Confirmation",
                customer_name="Sia Patel",
                service_or_item="Dental Care",
                scheduled_time_or_slot="2026-10-25 14:00",
                location_or_address="City Clinic",
            )
            self.assertIn("Email sent successfully to test@example.com", result)
            self.assertEqual(mock_req.call_count, 1)

    async def test_send_internal_staff_alert_mocked(self):
        with patch("agent.tools.gmail.request_json", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = (200, {"id": "18e67890"})
            
            result = await send_internal_staff_alert(
                token="valid_token",
                alert_type="urgent_callback",
                caller_name="Vikram Malhotra",
                caller_phone="+919876543210",
                reason="Caller wants immediate consultation regarding chest pain.",
                urgency_level="critical",
                staff_email="doctor_on_call@clinic.com",
            )
            self.assertIn("Urgent alert successfully dispatched to staff (doctor_on_call@clinic.com)", result)
            self.assertIn("Vikram Malhotra", result)

    async def test_check_recent_email_mocked(self):
        with patch("agent.tools.gmail.request_json", new_callable=AsyncMock) as mock_req:
            # 1st call: list messages
            # 2nd call: fetch message metadata
            mock_req.side_effect = [
                (200, {"messages": [{"id": "msg_001"}]}),
                (200, {
                    "id": "msg_001",
                    "snippet": "Hello doctor, attaching my dental x-ray for tomorrow's visit.",
                    "payload": {
                        "headers": [
                            {"name": "Subject", "value": "Dental X-Ray Report"},
                            {"name": "From", "value": "Sia Patel <sia@example.com>"},
                            {"name": "Date", "value": "Sat, 24 Oct 2026 10:15:00 +0530"}
                        ]
                    }
                })
            ]

            result = await check_recent_email(
                token="valid_token",
                sender_email="sia@example.com",
                search_query="x-ray",
            )
            self.assertIn("Found 1 matching email", result)
            self.assertIn("Dental X-Ray Report", result)
            self.assertIn("Sia Patel", result)
            self.assertIn("dental x-ray", result)

    async def test_create_email_draft_mocked(self):
        with patch("agent.tools.gmail.request_json", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = (200, {"id": "draft_abc123"})

            result = await create_email_draft(
                token="valid_token",
                recipient_email="client@example.com",
                subject="Special 10% Discount Quotation",
                draft_body="Proposed 3BHK pricing with 10% spot booking discount.",
                customer_name="Karan Mehta",
                review_notes="Approved for today's call only",
            )
            self.assertIn("Draft email successfully created in Gmail Drafts folder", result)
            self.assertIn("client@example.com", result)


if __name__ == "__main__":
    unittest.main()
