import os, json
from dotenv import load_dotenv
from azure.servicebus import ServiceBusClient, ServiceBusMessage

load_dotenv()

client = ServiceBusClient.from_connection_string(os.getenv("AZURE_SERVICE_BUS_CONNECTION_STRING"))
with client:
    sender = client.get_queue_sender(queue_name="ai-ocr-ingestion")
    with sender:
        # Use a real email id from MongoDB!
        email_id = "6acb64d26cc8f47c7d3ee9d2"
        payload = {
            "jobType": "EMAIL_PROPOSAL",
            "correlationId": f"outlookEmail:{email_id}",
            "payload": {
                "subject": "Storefront glass replacement quote",
                "sender": "architect@example.com",
                "bodyText": "Hello, we need a quote for replacing storefront glass panels at 123 Main St.",
                "documents": []
            }
        }
        sender.send_messages(ServiceBusMessage(json.dumps(payload)))
        print(f"Sent message for email {email_id} to ai-ocr-ingestion!")
