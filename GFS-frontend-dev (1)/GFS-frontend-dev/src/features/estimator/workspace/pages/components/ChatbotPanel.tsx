// pages/estimator/workspace/components/ChatbotPanel.tsx

import { useState } from "react";
import {
  FileText,
  Folder,
  Mail,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";
import { chatMessages, chatSourceOptions, type ChatMessage } from "../../mockData";

const Bubble = ({ msg }: { msg: ChatMessage }) => {
  const isUser = msg.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[260px] flex flex-col gap-1.5">
        {/* attachment chips */}
        {msg.attachments && (
          <div className="flex flex-col items-end gap-1.5">
            {msg.attachments.map((a) => (
              <span
                key={a.fileName}
                className="text-xs bg-gray-100 border border-gray-200 px-2 py-1 rounded-md flex items-center gap-1.5 text-gray-700"
              >
                <FileText size={12} className="text-gray-500" />
                {a.fileName}
              </span>
            ))}
          </div>
        )}

        <div
          className={`text-sm rounded-lg px-3 py-2 leading-relaxed ${
            isUser
              ? "bg-gray-900 text-white"
              : "bg-red-500 text-white"
          }`}
        >
          {msg.text}
        </div>

        {!isUser && (
          <Sparkles size={16} className="text-red-500 self-start ml-1" />
        )}
      </div>
    </div>
  );
};

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  docs: <Folder size={14} className="text-red-500" />,
  outlook: <Mail size={14} className="text-red-500" />,
  teams: <MessageSquare size={14} className="text-red-500" />,
};

const ChatbotPanel = () => {
  const [input, setInput] = useState("");
  const [showSources, setShowSources] = useState(false);

  return (
    <aside className="bg-white rounded-lg border border-gray-200 flex flex-col h-full min-h-[600px]">
      <header className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-red-500">Chatbot</h3>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">
        {chatMessages.map((m: any) => (
          <Bubble key={m.id} msg={m} />
        ))}
      </div>

      {/* Input */}
      <div className="relative border-t border-gray-200 p-3">
        {showSources && (
          <div className="absolute bottom-full mb-2 left-3 bg-white border border-gray-200 rounded-md shadow-md w-44">
            {chatSourceOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setShowSources(false)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-red-50"
              >
                {SOURCE_ICONS[opt.value]}
                {opt.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-full pl-1 pr-2 py-1">
          <button
            type="button"
            onClick={() => setShowSources((v) => !v)}
            aria-label="Add source"
            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-600 hover:bg-red-500 hover:text-white transition"
          >
            <Plus size={16} />
          </button>

          <input
            value={input}
            onChange={(e: any) => setInput(e.target.value)}
            placeholder="Ask anything about your project........"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
          />

          <button
            type="button"
            aria-label="Send"
            className="w-8 h-8 rounded-full flex items-center justify-center bg-white border border-gray-200 text-gray-600  hover:bg-red-500 hover:text-white transition"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
};

export default ChatbotPanel;
