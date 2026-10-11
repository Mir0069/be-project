// pages/estimator/workspace/tabs/communications/Teams.tsx

import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import RowMenu from "@/features/estimator/workspace/pages/components/RowMenu";
import { chatThreadMessages, chatThreads } from "@/features/estimator/workspace/mockData";

const Teams = () => {
  const [activeThreadId, setActiveThreadId] = useState("t-3");
  const [search, setSearch] = useState("");

  const activeThread = chatThreads.find((t: any) => t.id === activeThreadId);
  const messages = chatThreadMessages.filter((m: any) => m.threadId === activeThreadId);

  const filtered = chatThreads.filter((t: any) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 h-full">
      {/* Thread list */}
      <section className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col">
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-gray-800">
            Communications Hub - Teams
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Access your Teams chat</p>
        </header>

        <div className="relative mb-3">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            placeholder="Search Chats..."
            className="w-full bg-gray-50 border border-gray-200 rounded-md pl-8 pr-3 py-2 text-sm outline-none focus:border-red-500"
          />
        </div>

        <ul className="space-y-2 flex-1 overflow-y-auto no-scrollbar">
          {filtered.map((t: any) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setActiveThreadId(t.id)}
                className={`w-full text-left rounded-md p-2.5 border transition ${activeThreadId === t.id
                    ? "bg-blue-50 border-blue-200"
                    : "border-transparent hover:bg-gray-50"
                  }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800">
                    {t.name}
                  </p>
                  <span className="text-[10px] text-gray-500">{t.lastTime}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-gray-600 truncate pr-2">
                    {t.lastMessage}
                  </p>
                  {t.unread && (
                    <span className="text-[10px] bg-blue-500 text-white rounded-full w-4 h-4 flex items-center justify-center">
                      {t.unread}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition"
        >
          See More
          <ChevronDown size={12} />
        </button>
      </section>

      {/* Active thread */}
      <section className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col">
        {activeThread ? (
          <>
            <header className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <h3 className="text-sm font-semibold text-gray-800">
                {activeThread.name}
              </h3>
              {/* RowMenu */}
            </header>

            <div className="flex-1 overflow-y-auto no-scrollbar space-y-3 pr-1">
              {messages.map((m: any) => (
                <div
                  key={m.id}
                  className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}
                >
                  <div className="max-w-[75%]">
                    <div
                      className={`text-sm rounded-lg px-3 py-2 leading-relaxed ${m.fromMe
                          ? "bg-gray-900 text-white"
                          : "bg-[#3F3FB0] text-white"
                        }`}
                    >
                      {m.text}
                    </div>
                    <p
                      className={`text-[10px] text-gray-500 mt-1 ${m.fromMe ? "text-right" : "text-left"
                        }`}
                    >
                      {m.timestamp}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
            Select a chat to view
          </div>
        )}
      </section>
    </div>
  );
};

export default Teams;
