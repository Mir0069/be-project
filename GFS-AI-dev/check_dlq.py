import os
from dotenv import load_dotenv

load_dotenv()

from azure.servicebus import ServiceBusClient, ServiceBusSubQueue

conn_str = os.getenv("AZURE_SERVICE_BUS_CONNECTION_STRING", "")
queue_name = os.getenv("AZURE_SERVICE_BUS_QUEUE_NAME", "ai-ocr-ingestion")

with ServiceBusClient.from_connection_string(conn_str, logging_enable=False) as client:
    with client.get_queue_receiver(queue_name=queue_name, sub_queue=ServiceBusSubQueue.DEAD_LETTER) as receiver:
        dlq_msgs = receiver.peek_messages(max_message_count=20)
        print(f"Dead-letter messages count in '{queue_name}': {len(dlq_msgs)}")
        for m in dlq_msgs:
            print(f"  DLQ Msg: ID={m.message_id}, Reason={m.dead_letter_reason}, Error={m.dead_letter_error_description}")

    with client.get_queue_receiver(queue_name=queue_name) as receiver:
        active_msgs = receiver.peek_messages(max_message_count=20)
        print(f"Active messages count in '{queue_name}': {len(active_msgs)}")
        for m in active_msgs:
            print(f"  Active Msg: ID={m.message_id}, Subject={m.subject}")
